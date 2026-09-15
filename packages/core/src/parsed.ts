import type { LanguageAdapter, ParseDiagnostic } from "./adapter.js";
import type { Capture, CaptureSet } from "./captures.js";
import { capture } from "./captures.js";
import { type CodeFragment, isCodeFragment } from "./code.js";
import { type Edit, applyEdits, insertAfter, insertBefore, remove, replace } from "./edits.js";
import { ParseError } from "./errors.js";
import type { Match } from "./match.js";
import { NodeRef, walk } from "./nodes.js";
import type { PatternOptions } from "./options.js";
import type { Pattern, PatternLanguage } from "./pattern.js";
import { SourceDocument, SourceSlice } from "./source.js";

export type ParseErrorPolicy = "reject" | "allow-recovery" | "allow-outside-errors";

/** Anything that can say what to look for. */
export type Query<Captures extends CaptureSet = CaptureSet, TNode = unknown> =
  | CodeFragment<Captures>
  | Pattern<Captures, TNode>;

/** Rewrites an embedded region, in the language it is actually written in. */
export type EmbeddedRewrite<Captures extends CaptureSet, TNode, TInner> = (
  inner: ParsedDocument<any, TInner>,
  match: Match<Captures, TNode>,
) => ParsedDocument<any, TInner> | string | null | undefined;

/** What to put in a match's place: source, or a function that decides per match. */
export type Rewrite<Captures extends CaptureSet, TNode> =
  | CodeFragment<any>
  | string
  | ((
      match: Match<Captures, TNode>,
    ) => CodeFragment<any> | string | Edit | readonly Edit[] | null | undefined);

/** What a ParsedDocument needs from its language to re-parse itself. */
export interface ParsedLanguage<TParsed, TNode> extends PatternLanguage<TNode> {
  parse(input: SourceDocument | SourceSlice, options?: PatternOptions): ParsedDocument<TParsed, TNode>;
}

/**
 * A parsed region of one source document, and the main thing you work with.
 * It answers the questions a string answers — does it contain this, where, how
 * many — except every question is asked in syntax, not characters. Rewrites
 * return a new document, so they chain and never mutate.
 */
export class ParsedDocument<TParsed = unknown, TNode = unknown> {
  readonly document: SourceDocument;
  readonly root: NodeRef<TNode>;
  readonly adapter: LanguageAdapter<TParsed, TNode, any>;
  readonly diagnostics: readonly ParseDiagnostic[];
  /** Where this region starts in `document`; non-zero for a nested parse. */
  readonly origin: number;
  readonly raw: TParsed;
  readonly language: ParsedLanguage<TParsed, TNode>;

  constructor(init: {
    document: SourceDocument;
    root: NodeRef<TNode>;
    adapter: LanguageAdapter<TParsed, TNode, any>;
    diagnostics: readonly ParseDiagnostic[];
    origin: number;
    raw: TParsed;
    language: ParsedLanguage<TParsed, TNode>;
  }) {
    this.document = init.document;
    this.root = init.root;
    this.adapter = init.adapter;
    this.diagnostics = init.diagnostics;
    this.origin = init.origin;
    this.raw = init.raw;
    this.language = init.language;
    NodeRef.attach(this.root, this);
  }

  get errors(): readonly ParseDiagnostic[] {
    return this.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  }

  hasErrors(): boolean {
    return this.errors.length > 0;
  }

  /** The source this parse covers — the whole file, or one nested region. */
  text(): string {
    return this.document.text.slice(this.root.start, this.root.end);
  }

  get start(): number {
    return this.root.start;
  }

  get end(): number {
    return this.root.end;
  }

  get length(): number {
    return this.root.end - this.root.start;
  }

  slice(): SourceSlice {
    return this.root.slice();
  }

  toString(): string {
    return this.text();
  }

  // ---------------------------------------------------------------- querying

  #pattern<Captures extends CaptureSet>(query: Query<Captures, TNode>): Pattern<Captures, TNode> {
    return isCodeFragment(query) ? query.compile<TNode>(this.language) : (query as Pattern<Captures, TNode>);
  }

  /** The first match in source order, or null. */
  match<Captures extends CaptureSet>(query: Query<Captures, TNode>): Match<Captures, TNode> | null {
    return this.#pattern(query).match(this);
  }

  /** Every match, start ascending, outermost first where two start together. */
  matchAll<Captures extends CaptureSet>(query: Query<Captures, TNode>): Match<Captures, TNode>[] {
    return this.#pattern(query).findAll(this);
  }

  includes(query: Query<any, TNode>): boolean {
    return this.match(query) !== null;
  }

  count(query: Query<any, TNode>): number {
    return this.matchAll(query).length;
  }

  /** Offset of the first match in the root document, or -1. */
  indexOf(query: Query<any, TNode>, from = this.start): number {
    for (const match of this.matchAll(query)) {
      if (match.start >= from) return match.start;
    }
    return -1;
  }

  lastIndexOf(query: Query<any, TNode>): number {
    const matches = this.matchAll(query);
    return matches.length === 0 ? -1 : matches[matches.length - 1]!.start;
  }

  /** True when the pattern covers this whole region, not just part of it. */
  equals(query: Query<any, TNode>): boolean {
    return this.#pattern(query).matches(this);
  }

  /**
   * Why a query found nothing here — the deepest place the matcher got stuck,
   * with what it expected and what it read instead. Reach for this the moment a
   * pattern silently does nothing.
   */
  explain(query: Query<any, TNode>): string {
    return this.#pattern(query).explain(this);
  }

  /** Innermost node containing an offset, for inspecting what is at a position. */
  nodeAt(offset: number): NodeRef<TNode> | undefined {
    let found: NodeRef<TNode> | undefined;
    for (const node of walk(this.root)) {
      if (node.start <= offset && offset < node.end) found = node;
    }
    return found;
  }

  nodes(): NodeRef<TNode>[] {
    return [...walk(this.root)];
  }

  // --------------------------------------------------------------- rewriting

  /**
   * Turn matches into edits the way `replaceAll` would.
   *
   * A pattern can match inside itself — `{% if %}` around another `{% if %}` —
   * and the two rewrites would then want the same range. Matches arrive
   * outermost first, so the outer one wins and the inner is left for a second
   * run; matches whose edits do not collide are all kept, which is what lets a
   * nested element be rewritten alongside the one containing it.
   */
  editsFor<Captures extends CaptureSet>(
    matches: readonly Match<Captures, TNode>[],
    to: Rewrite<Captures, TNode>,
  ): Edit[] {
    const edits: Edit[] = [];
    for (const match of matches) {
      const produced = typeof to === "function" ? to(match) : to;
      if (produced == null) continue;

      let next: Edit[];
      if (Array.isArray(produced)) next = [...(produced as readonly Edit[])];
      else if (typeof produced === "object" && "operation" in produced) next = [produced as Edit];
      else {
        const replacement = isCodeFragment(produced)
          ? produced.toTemplate(this.language as never, match)
          : (produced as string);
        next = [replace(match, replacement)];
      }

      if (next.some((edit) => collides(edit, edits))) continue;
      edits.push(...next);
    }
    return edits;
  }

  /** Rewrite the first match, the way `String.replace` takes the first hit. */
  replace<Captures extends CaptureSet>(
    query: Query<Captures, TNode>,
    to: Rewrite<Captures, TNode>,
  ): ParsedDocument<TParsed, TNode> {
    const match = this.match(query);
    return this.applyEdits(match ? this.editsFor([match], to) : []);
  }

  /** Rewrite every match in one validated pass. */
  replaceAll<Captures extends CaptureSet>(
    query: Query<Captures, TNode>,
    to: Rewrite<Captures, TNode>,
  ): ParsedDocument<TParsed, TNode> {
    return this.applyEdits(this.editsFor(this.matchAll(query), to));
  }

  remove(query: Query<any, TNode>): ParsedDocument<TParsed, TNode> {
    const match = this.match(query);
    return this.applyEdits(match ? [remove(match)] : []);
  }

  removeAll(query: Query<any, TNode>): ParsedDocument<TParsed, TNode> {
    return this.applyEdits(this.matchAll(query).map((match) => remove(match)));
  }

  insertBefore<Captures extends CaptureSet>(
    query: Query<Captures, TNode>,
    to: Rewrite<Captures, TNode>,
  ): ParsedDocument<TParsed, TNode> {
    return this.#insert(query, to, insertBefore);
  }

  insertAfter<Captures extends CaptureSet>(
    query: Query<Captures, TNode>,
    to: Rewrite<Captures, TNode>,
  ): ParsedDocument<TParsed, TNode> {
    return this.#insert(query, to, insertAfter);
  }

  #insert<Captures extends CaptureSet>(
    query: Query<Captures, TNode>,
    to: Rewrite<Captures, TNode>,
    build: typeof insertBefore,
  ): ParsedDocument<TParsed, TNode> {
    const edits: Edit[] = [];
    for (const match of this.matchAll(query)) {
      const produced = typeof to === "function" ? to(match) : to;
      if (produced == null) continue;
      const text = isCodeFragment(produced)
        ? produced.toTemplate(this.language as never, match)
        : (produced as string);
      edits.push(build(match, text));
    }
    return this.applyEdits(edits);
  }

  /**
   * Apply edits and re-parse. A nested document keeps covering the same region
   * of the new root, so `.text()` stays the region and `.document` the file.
   */
  applyEdits(edits: readonly (Edit | null | undefined)[]): ParsedDocument<TParsed, TNode> {
    const list = edits.filter(Boolean) as Edit[];
    if (list.length === 0) return this;
    const before = this.document;
    const after = new SourceDocument(applyEdits(before, list), before.id);
    if (this.origin === 0 && this.length === before.length) {
      return this.language.parse(after);
    }
    const delta = after.length - before.length;
    return this.language.parse(after.slice(this.origin, this.origin + this.length + delta));
  }

  /**
   * Re-read an embedded region with another language, rewrite it there, and
   * splice the result back — in one pass, so several embedded regions can be
   * rewritten without their offsets drifting.
   *
   * The first argument is handed the capture that stands for the region, so the
   * pattern and the handle can never disagree about which hole holds it.
   */
  inside<Captures extends CaptureSet, TInner>(
    region: (block: Capture<"block">) => Query<Captures, TNode>,
    language: ParsedLanguage<any, TInner>,
    rewrite: EmbeddedRewrite<Captures, TNode, TInner>,
  ): ParsedDocument<TParsed, TNode> {
    const block = capture("block");
    const query = region(block);
    assertHolds(query, block, language.id);

    const edits: Edit[] = [];
    for (const match of this.matchAll(query)) {
      const found = match.getAll(block)[0];
      if (!found) continue;
      const inner = language.parse(found);
      const produced = rewrite(inner, match);
      if (produced == null) continue;
      const text = typeof produced === "string" ? produced : produced.text();
      if (text === found.text()) continue;
      edits.push(replace(found, text));
    }
    return this.applyEdits(edits);
  }

  /** The edits a rewrite would make, without making them. */
  edits<Captures extends CaptureSet>(query: Query<Captures, TNode>, to: Rewrite<Captures, TNode>): Edit[] {
    return this.editsFor(this.matchAll(query), to);
  }
}

/** A handle may sit under a combinator, so look through them rather than at the top. */
function usesCapture(value: unknown, block: Capture<"block">): boolean {
  if (value === block) return true;
  if (!value || typeof value !== "object") return false;
  const kind = (value as { kind?: string }).kind;
  if (kind === "repeat") return usesCapture((value as { item: unknown }).item, block);
  if (kind === "choice") return (value as { options: unknown[] }).options.some((o) => usesCapture(o, block));
  if (isCodeFragment(value)) return value.values.some((nested) => usesCapture(nested, block));
  return false;
}

/** Would this edit land on source another edit has already claimed? */
function collides(edit: Edit, taken: readonly Edit[]): boolean {
  return taken.some(
    (other) =>
      other.slice.document === edit.slice.document &&
      other.slice.start < edit.slice.end &&
      edit.slice.start < other.slice.end,
  );
}

/** A region callback that ignores its handle would silently match nothing. */
function assertHolds(query: Query<any, any>, block: Capture<"block">, languageId: string): void {
  const holds = isCodeFragment(query)
    ? query.values.some((value) => usesCapture(value, block))
    : query.compiled.captures.includes(block);
  if (!holds) {
    throw new TypeError(
      `inside(..., ${languageId}, ...) was given a pattern that does not use the capture it was handed; ` +
        "interpolate it where the embedded source sits, e.g. (block) => code`<style>${block}</style>`",
    );
  }
}

export function checkParsePolicy(input: {
  parsedDocument: ParsedDocument<any, any>;
  policy: ParseErrorPolicy;
}): void {
  const { parsedDocument, policy } = input;
  if (policy === "reject" && parsedDocument.hasErrors()) {
    const first = parsedDocument.errors[0]!;
    throw new ParseError(
      `[${parsedDocument.adapter.id}] refusing to match source with parse errors: ${first.message}`,
      { diagnostics: parsedDocument.diagnostics },
    );
  }
}

/** Ranges the parser flagged as broken, used by the allow-outside-errors policy. */
export function errorRanges(parsedDocument: ParsedDocument<any, any>): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  for (const node of walk(parsedDocument.root)) {
    if (node.error) ranges.push({ start: node.start, end: node.end });
  }
  for (const diagnostic of parsedDocument.errors) {
    if (diagnostic.range) {
      ranges.push({
        start: parsedDocument.origin + diagnostic.range.start,
        end: parsedDocument.origin + diagnostic.range.end,
      });
    }
  }
  return ranges;
}
