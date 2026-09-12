import type { AnyAdapter, LanguageAdapter } from "./adapter.js";
import { PatternCompileError } from "./errors.js";
import { SourceDocument } from "./source.js";
import { type NodeRef, normalize, walk } from "./nodes.js";
import { type AnyCapture, type HoleValue, type ItemValue, isHoleValue } from "./captures.js";
import type { PatternOptions } from "./options.js";

const DEFAULT_PLACEHOLDER = /^__sm_hole_(\d+)__$/u;

export type TriviaPolicy = "ignore" | "exact" | "whitespace-flexible";

export const TRIVIA_POLICIES: ReadonlySet<TriviaPolicy> = new Set<TriviaPolicy>([
  "ignore",
  "exact",
  "whitespace-flexible",
]);

export interface NodeIR {
  readonly t: "node";
  readonly kind: string;
  readonly leaf: boolean;
  readonly text: string | null;
  readonly children: readonly PatternIR[];
}

export interface Hole1IR {
  readonly t: "hole1";
  readonly capture: AnyCapture | null;
}

export interface AltIR {
  readonly t: "alt";
  readonly options: readonly PatternIR[];
}

export interface RepIR {
  readonly t: "rep";
  readonly item: PatternIR;
  readonly min: number;
  readonly max: number;
  readonly spanCapture: AnyCapture | null;
  readonly label?: string;
}

export type PatternIR = NodeIR | Hole1IR | AltIR | RepIR;

export interface CompiledPattern {
  readonly items: readonly PatternIR[];
  readonly source: string;
  readonly placeholders: readonly string[];
  readonly trivia: TriviaPolicy;
  readonly patternDocument: SourceDocument;
  readonly captures: readonly AnyCapture[];
}

/** Which children take part in structural matching under a trivia policy. */
export function filterTrivia<TNode>(
  children: readonly NodeRef<TNode>[],
  trivia: TriviaPolicy,
): readonly NodeRef<TNode>[] {
  if (trivia === "exact") return children;
  if (trivia === "ignore") return children.filter((child) => child.trivia === null);
  return children.filter((child) => child.trivia !== "whitespace" && child.trivia !== "separator");
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "object") return (value as object).constructor?.name ?? "an object";
  return typeof value;
}

interface FlatTemplate {
  readonly literals: string[];
  readonly holes: HoleValue[];
}

/**
 * Patterns interpolated into patterns compose at the source level: their
 * literals and holes are spliced into the parent before anything is parsed, so
 * one grammar sees one text.
 */
function flattenTemplate(
  strings: readonly string[],
  values: readonly unknown[],
  adapter: AnyAdapter,
): FlatTemplate {
  const literals = [String(strings[0])];
  const holes: HoleValue[] = [];
  const push = (literal: string) => {
    literals[literals.length - 1] += literal;
  };

  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (isHoleValue(value)) {
      holes.push(value);
      literals.push(String(strings[i + 1]));
      continue;
    }
    if (isFragmentInternals(value)) {
      // A fragment composes into another fragment the way a pattern does:
      // its literals and holes are spliced in before anything is parsed.
      const nested = flattenTemplate(value.strings, value.values, adapter);
      push(nested.literals[0]!);
      for (let n = 0; n < nested.holes.length; n++) {
        holes.push(nested.holes[n]!);
        literals.push(nested.literals[n + 1]!);
      }
      push(String(strings[i + 1]));
      continue;
    }
    if (isPatternInternals(value)) {
      if (value.language.adapter !== adapter) {
        throw new PatternCompileError(
          `cannot interpolate a ${value.language.id} pattern into a ${adapter.id} pattern; ` +
            "cross-language matching goes through a captured source slice instead",
        );
      }
      const nested = flattenTemplate(value.strings, value.values, adapter);
      push(nested.literals[0]!);
      for (let n = 0; n < nested.holes.length; n++) {
        holes.push(nested.holes[n]!);
        literals.push(nested.literals[n + 1]!);
      }
      push(String(strings[i + 1]));
      continue;
    }
    if (typeof value === "string" || typeof value === "number") {
      push(String(value));
      push(String(strings[i + 1]));
      continue;
    }
    throw new PatternCompileError(
      `pattern hole ${i} got ${describe(value)}; interpolate a capture, any(), a combinator, ` +
        "another pattern of the same language, or literal text",
    );
  }
  return { literals, holes };
}

/** The part of a Language the compiler needs, without importing the class. */
interface CompileLanguage {
  readonly id: string;
  readonly adapter: AnyAdapter;
}

/** The part of a Pattern the compiler needs, without importing the class. */
interface PatternInternals {
  readonly isStructuralPattern: true;
  readonly strings: readonly string[];
  readonly values: readonly unknown[];
  readonly language: { readonly id: string; readonly adapter: AnyAdapter };
  readonly compiled: CompiledPattern;
}

interface FragmentInternals {
  readonly isCodeFragment: true;
  readonly strings: readonly string[];
  readonly values: readonly unknown[];
}

function isFragmentInternals(value: unknown): value is FragmentInternals {
  return Boolean(value && typeof value === "object" && (value as FragmentInternals).isCodeFragment === true);
}

function isPatternInternals(value: unknown): value is PatternInternals {
  return Boolean(value && typeof value === "object" && (value as PatternInternals).isStructuralPattern === true);
}

function buildPatternSource(literals: readonly string[], holes: readonly HoleValue[], adapter: AnyAdapter) {
  let source = literals[0]!;
  const placeholders: string[] = [];
  for (let i = 0; i < holes.length; i++) {
    const fallback = `__sm_hole_${i}__`;
    const text = adapter.placeholder
      ? adapter.placeholder(i, { before: source, after: literals[i + 1]!, fallback })
      : fallback;
    placeholders.push(text);
    source += text + literals[i + 1]!;
  }
  return { source, placeholders };
}

function detectPlaceholder(adapter: AnyAdapter, node: NodeRef<unknown>): number | null {
  if (adapter.detectPlaceholder) {
    return adapter.detectPlaceholder(node.raw, node.text()) ?? null;
  }
  const match = DEFAULT_PLACEHOLDER.exec(node.text().trim());
  return match ? Number(match[1]) : null;
}

function isVariadic(adapter: AnyAdapter, kind: string | null): boolean {
  return kind !== null && adapter.isVariadic ? Boolean(adapter.isVariadic(kind)) : false;
}

/** A hole in a variadic container stands for a run of siblings, not one node. */
function holeCardinality(adapter: AnyAdapter, parentKind: string | null) {
  return isVariadic(adapter, parentKind) ? { min: 0, max: Number.POSITIVE_INFINITY } : { min: 1, max: 1 };
}

interface CompileContext {
  readonly language: CompileLanguage;
  readonly adapter: AnyAdapter;
  readonly holes: readonly HoleValue[];
  readonly trivia: TriviaPolicy;
  readonly used: Set<number>;
}

function compileHoleValue(value: HoleValue, parentKind: string | null, context: CompileContext): PatternIR {
  const { adapter } = context;
  switch (value.kind) {
    case "capture": {
      if (value.shape) {
        // A capture given a shape binds what that shape matches, once.
        return {
          t: "rep",
          item: compileItemValue(value.shape as unknown as ItemValue, context),
          min: 1,
          max: 1,
          spanCapture: value,
        };
      }
      const { min, max } = holeCardinality(adapter, parentKind);
      return { t: "rep", item: { t: "hole1", capture: null }, min, max, spanCapture: value };
    }
    case "any": {
      const { min, max } = holeCardinality(adapter, parentKind);
      return { t: "rep", item: { t: "hole1", capture: null }, min, max, spanCapture: null, label: "any" };
    }
    case "repeat":
      return {
        t: "rep",
        item: compileItemValue(value.item, context),
        min: value.min,
        max: value.max,
        spanCapture: null,
        label: value.label,
      };
    case "choice":
      return { t: "alt", options: value.options.map((option) => compileItemValue(option, context)) };
  }
}

/** Everything a repetition or alternative may wrap consumes exactly one node. */
function compileItemValue(value: ItemValue, context: CompileContext): PatternIR {
  if (isFragmentInternals(value)) {
    // A fragment inside a combinator is compiled against the language it has
    // now met, then treated exactly like a sub-pattern.
    return compileItemValue(
      (value as unknown as { compile(language: CompileLanguage): ItemValue }).compile(context.language),
      context,
    );
  }
  if (isPatternInternals(value)) {
    if (value.language.adapter !== context.adapter) {
      throw new PatternCompileError(
        `cannot use a ${value.language.id} pattern inside a ${context.adapter.id} pattern`,
      );
    }
    const items = value.compiled.items;
    if (items.length !== 1 || items[0]!.t !== "node") {
      throw new PatternCompileError(
        "a pattern used inside a combinator must compile to exactly one node; " +
          `this one compiles to ${items.length} top-level items`,
      );
    }
    return items[0]!;
  }
  if (!isHoleValue(value)) {
    throw new PatternCompileError(
      `combinators take a capture, any(), oneOf() or a pattern, not ${describe(value)}`,
    );
  }
  if (value.kind === "capture") return { t: "hole1", capture: value };
  if (value.kind === "any") return { t: "hole1", capture: null };
  if (value.kind === "choice") {
    return { t: "alt", options: value.options.map((option) => compileItemValue(option, context)) };
  }
  throw new PatternCompileError(`${(value as { label: string }).label}() cannot be nested inside another combinator`);
}

/**
 * Some parsers wrap a fragment in a node the author never wrote — acorn turns
 * `foo(x)` into an ExpressionStatement. At a pattern's top level that wrapper
 * would pin the pattern to statement position, so adapters can declare it
 * transparent and the matcher looks for the node inside it instead.
 */
function unwrapPatternRoot<TNode>(node: NodeRef<TNode>, adapter: AnyAdapter, trivia: TriviaPolicy) {
  let current = node;
  let parentKind: string | null = current.parent ? current.parent.kind : null;
  while (adapter.isPatternWrapper && adapter.isPatternWrapper(current.kind)) {
    const children = filterTrivia(current.children, trivia);
    if (children.length !== 1) break;
    parentKind = current.kind;
    current = children[0]!;
  }
  return { node: current, parentKind };
}

/** What a leaf is compared by: the adapter's answer, or its own source. */
export function comparisonText(adapter: AnyAdapter, node: NodeRef<unknown>): string {
  const text = node.text();
  return adapter.compareText ? adapter.compareText(node.raw, text) : text;
}

function toIR<TNode>(node: NodeRef<TNode>, parentKind: string | null, context: CompileContext): PatternIR {
  const index = detectPlaceholder(context.adapter, node as NodeRef<unknown>);
  if (index !== null) {
    context.used.add(index);
    const value = context.holes[index];
    if (value === undefined) {
      throw new PatternCompileError(
        `the ${context.adapter.id} adapter reported placeholder ${index}, ` +
          `but the pattern has ${context.holes.length} holes`,
      );
    }
    return compileHoleValue(value, parentKind, context);
  }

  const children = filterTrivia(node.children, context.trivia).map((child) => toIR(child, node.kind, context));
  return {
    t: "node",
    kind: node.kind,
    leaf: children.length === 0,
    text: children.length === 0 ? comparisonText(context.adapter, node) : null,
    children,
  };
}

/**
 * A hole the parser folded into surrounding text would silently never match,
 * so compilation stops and says where the boundary was missing.
 */
function assertEveryHoleLanded<TNode>(input: {
  holes: readonly HoleValue[];
  used: ReadonlySet<number>;
  placeholders: readonly string[];
  root: NodeRef<TNode>;
  adapter: AnyAdapter;
  source: string;
}): void {
  const { holes, used, placeholders, root, adapter, source } = input;
  for (let index = 0; index < holes.length; index++) {
    if (used.has(index)) continue;
    const placeholder = placeholders[index]!.trim();
    let culprit: NodeRef<TNode> | null = null;
    for (const node of walk(root)) {
      if (node.text().includes(placeholder)) culprit = node;
    }
    const where = culprit
      ? `the ${adapter.id} parser folded it into one ${culprit.kind}: ${JSON.stringify(culprit.text().slice(0, 60))}`
      : "it did not survive parsing";
    throw new PatternCompileError(
      `pattern hole ${index} does not sit on a syntax boundary; ${where}. ` +
        "Put the hole where the grammar expects a node of its own.",
      { source, index },
    );
  }
}

function collectCaptures(item: PatternIR, seen: Set<AnyCapture>, duplicates: Set<AnyCapture>): void {
  const add = (capture: AnyCapture | null) => {
    if (!capture) return;
    if (seen.has(capture)) duplicates.add(capture);
    seen.add(capture);
  };
  switch (item.t) {
    case "hole1":
      add(item.capture);
      break;
    case "rep":
      add(item.spanCapture);
      collectCaptures(item.item, seen, duplicates);
      break;
    case "alt": {
      // Alternatives are exclusive, so the same handle may appear in each branch.
      const branchSeen = new Set<AnyCapture>();
      for (const option of item.options) {
        const optionSeen = new Set<AnyCapture>();
        collectCaptures(option, optionSeen, duplicates);
        for (const capture of optionSeen) branchSeen.add(capture);
      }
      for (const capture of branchSeen) add(capture);
      break;
    }
    case "node":
      for (const child of item.children) collectCaptures(child, seen, duplicates);
      break;
  }
}

export function compilePattern(input: {
  language: CompileLanguage;
  strings: readonly string[];
  values: readonly unknown[];
  options: PatternOptions;
}): CompiledPattern {
  const { language, strings, values, options } = input;
  const adapter = language.adapter as LanguageAdapter<unknown, unknown, unknown>;
  const trivia = options.trivia ?? "whitespace-flexible";
  if (!TRIVIA_POLICIES.has(trivia)) {
    throw new PatternCompileError(
      `unknown trivia policy "${trivia}"; use ignore, exact or whitespace-flexible`,
    );
  }

  const { literals, holes } = flattenTemplate(strings, values, adapter);
  const { source, placeholders } = buildPatternSource(literals, holes, adapter);

  const document = new SourceDocument(source, `<pattern:${adapter.id}>`);
  let parsed: unknown;
  try {
    parsed = adapter.parse(source, { ...options.parseOptions, isPattern: true });
  } catch (cause) {
    throw new PatternCompileError(
      `[${adapter.id}] could not parse the pattern: ${(cause as Error).message}\n` +
        `--- pattern source ---\n${source}`,
      { cause, source },
    );
  }
  const diagnostics = adapter.diagnostics ? adapter.diagnostics(parsed) : [];
  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  if (errors.length > 0) {
    throw new PatternCompileError(
      `[${adapter.id}] the pattern is not valid ${adapter.id}: ${errors[0]!.message}\n` +
        `--- pattern source ---\n${source}`,
      { diagnostics, source },
    );
  }

  const root = normalize({ adapter, parsed, document, origin: 0, localLength: source.length });
  const context: CompileContext = { language, adapter, holes, trivia, used: new Set<number>() };
  const items = filterTrivia(root.children, trivia)
    .map((child) => unwrapPatternRoot(child, adapter, trivia))
    .map(({ node, parentKind }) => toIR(node, parentKind, context));

  assertEveryHoleLanded({ holes, used: context.used, placeholders, root, adapter, source });

  if (items.length === 0) {
    throw new PatternCompileError("the pattern is empty", { source });
  }

  const seen = new Set<AnyCapture>();
  const duplicates = new Set<AnyCapture>();
  for (const item of items) collectCaptures(item, seen, duplicates);
  if (duplicates.size > 0) {
    const names = [...duplicates].map((capture) => capture.toString()).join(", ");
    throw new PatternCompileError(
      `${names} is used in more than one position of the same pattern. ` +
        "v1 has no equality constraint; declare a second handle instead.",
      { source },
    );
  }

  return { items, source, placeholders, trivia, patternDocument: document, captures: [...seen] };
}

export function describeIR(items: readonly PatternIR[], indent = ""): string {
  const lines: string[] = [];
  const cardinality = (item: RepIR) => `${item.min}..${item.max === Number.POSITIVE_INFINITY ? "∞" : item.max}`;
  const render = (item: PatternIR, pad: string): void => {
    switch (item.t) {
      case "node":
        lines.push(`${pad}${item.kind}${item.leaf ? ` ${JSON.stringify(item.text)}` : ""}`);
        for (const child of item.children) render(child, `${pad}  `);
        break;
      case "hole1":
        lines.push(`${pad}${item.capture ? item.capture.toString() : "any()"} → 1 node`);
        break;
      case "rep": {
        const label = item.spanCapture
          ? `${item.spanCapture.toString()} → ${cardinality(item)} nodes as one slice`
          : `${item.label ?? "repeat"} → ${cardinality(item)} nodes, one result each`;
        lines.push(`${pad}${label}`);
        const anonymous = item.item.t === "hole1" && item.item.capture === null;
        if (!anonymous) render(item.item, `${pad}  `);
        break;
      }
      case "alt":
        lines.push(`${pad}oneOf`);
        for (const option of item.options) render(option, `${pad}  `);
        break;
    }
  };
  for (const item of items) render(item, indent);
  return lines.join("\n");
}
