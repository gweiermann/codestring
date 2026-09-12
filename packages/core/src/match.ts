import { CaptureCardinalityError, formatLocation } from "./errors.js";
import { SourceDocument, SourceSlice } from "./source.js";
import { type Edit, type EditTargetInput, applyEdits, insertAfter, insertBefore, remove, replace } from "./edits.js";
import { type SourceTemplate, type SourceValue, buildSourceTemplate } from "./template.js";
import type { AnyCapture, CaptureSet, NamesOf } from "./captures.js";
import type { NodeRef } from "./nodes.js";
import type { ParsedDocument } from "./parsed.js";
import type { Bindings } from "./matcher.js";
import type { PatternHandle } from "./pattern-handle.js";

/**
 * One bound slot of one match: a source slice plus the nodes it covers.
 *
 * Matching steps over trivia, so the slice binds the nodes and stops there. The
 * trivia it stepped over is not lost: `leading` and `trailing` are the runs on
 * either side, and `full()` is the region including them — which is what a
 * rewrite wants when it rebuilds the thing around a body and would otherwise
 * drop the newline the body sat on.
 */
export class CaptureResult<TNode = unknown> extends SourceSlice {
  readonly capture: AnyCapture;
  readonly name: string | undefined;
  readonly nodes: readonly NodeRef<TNode>[];

  constructor(
    document: SourceDocument,
    start: number,
    end: number,
    init: { capture: AnyCapture; nodes: readonly NodeRef<TNode>[] },
  ) {
    super(document, start, end);
    this.capture = init.capture;
    this.name = init.capture.name;
    this.nodes = init.nodes;
  }

  kinds(): string[] {
    return this.nodes.map((node) => node.kind);
  }

  /** The trivia immediately before the first node this bound. */
  get leading(): SourceSlice {
    return new SourceSlice(this.document, triviaEdge(this.nodes[0], -1) ?? this.start, this.start);
  }

  /** The trivia immediately after the last node this bound. */
  get trailing(): SourceSlice {
    const last = this.nodes[this.nodes.length - 1];
    return new SourceSlice(this.document, this.end, triviaEdge(last, 1) ?? this.end);
  }

  /** The capture together with the trivia on either side of it. */
  full(): SourceSlice {
    return new SourceSlice(this.document, this.leading.start, this.trailing.end);
  }
}

/** How far the trivia beside a node runs, in the direction given. */
function triviaEdge<TNode>(node: NodeRef<TNode> | undefined, direction: -1 | 1): number | undefined {
  const siblings = node?.parent?.children;
  if (!node || !siblings) return undefined;
  let index = siblings.indexOf(node);
  let edge = direction === -1 ? node.start : node.end;
  for (index += direction; index >= 0 && index < siblings.length; index += direction) {
    const sibling = siblings[index]!;
    if (sibling.trivia === null) break;
    edge = direction === -1 ? sibling.start : sibling.end;
  }
  return edge;
}

declare const REPEATED_CAPTURE: unique symbol;

/** Marker that makes `get()` on a repeated capture a compile error. */
export type UseGetAllInstead = {
  readonly [REPEATED_CAPTURE]: "this capture can match more than once — call getAll() instead";
};

/** Everything a match's own edit tags accept: its handles, plus plain source. */
export type ReplacementValue<Captures extends CaptureSet> =
  | Captures["one"]
  | Captures["optional"]
  | Captures["many"]
  | SourceSlice
  | SourceTemplate
  | string
  | number
  | null
  | undefined;

/** A tagged template that builds one edit against a match. */
export interface EditTag<Captures extends CaptureSet> {
  (strings: TemplateStringsArray, ...values: ReplacementValue<Captures>[]): Edit;
}

export interface EditFactory<Captures extends CaptureSet> extends EditTag<Captures> {
  /** Aim the same tag at a capture of this match instead of the whole match. */
  (
    target:
      | Captures["one"]
      | Captures["optional"]
      | Captures["many"]
      | NamesOf<Captures["one"] | Captures["optional"] | Captures["many"]>
      | EditTargetInput,
  ): EditTag<Captures>;
}

export type MatchEditTarget<Captures extends CaptureSet> =
  | Captures["one"]
  | Captures["optional"]
  | Captures["many"]
  | NamesOf<Captures["one"] | Captures["optional"] | Captures["many"]>
  | EditTargetInput;

function isTemplateStrings(value: unknown): value is TemplateStringsArray {
  return Array.isArray(value) && Array.isArray((value as unknown as TemplateStringsArray).raw);
}

export class Match<Captures extends CaptureSet = CaptureSet, TNode = unknown> {
  readonly pattern: PatternHandle<Captures, TNode>;
  readonly parsedDocument: ParsedDocument<unknown, TNode>;
  readonly document: SourceDocument;
  readonly range: SourceSlice;
  readonly nodes: readonly NodeRef<TNode>[];
  readonly language: string;
  readonly #bindings = new Map<AnyCapture, CaptureResult<TNode>[]>();

  constructor(init: {
    pattern: PatternHandle<Captures, TNode>;
    parsedDocument: ParsedDocument<unknown, TNode>;
    range: { start: number; end: number };
    nodes: readonly NodeRef<TNode>[];
    bindings: Bindings<TNode>;
  }) {
    this.pattern = init.pattern;
    this.language = init.pattern.language.id;
    this.parsedDocument = init.parsedDocument;
    this.document = init.parsedDocument.document;
    this.range = new SourceSlice(this.document, init.range.start, init.range.end);
    this.nodes = init.nodes;
    for (const [capture, entries] of init.bindings) {
      this.#bindings.set(
        capture,
        entries.map((entry) => new CaptureResult(this.document, entry.start, entry.end, { capture, nodes: entry.nodes })),
      );
    }
  }

  text(): string {
    return this.range.text();
  }

  get start(): number {
    return this.range.start;
  }

  get end(): number {
    return this.range.end;
  }

  position() {
    return this.range.position();
  }

  #resolve(handle: AnyCapture | string): CaptureResult<TNode>[] {
    if (handle && typeof handle === "object") return this.#bindings.get(handle) ?? [];
    if (typeof handle === "string") {
      for (const [capture, results] of this.#bindings) {
        if (capture.name === handle) return results;
      }
      return [];
    }
    throw new TypeError("get() takes a capture handle or a capture name");
  }

  /** The single result for a handle, or undefined when it did not participate. */
  get(handle: Captures["one"]): CaptureResult<TNode>;
  get(handle: Captures["optional"]): CaptureResult<TNode> | undefined;
  get(name: NamesOf<Captures["one"]>): CaptureResult<TNode>;
  get(name: NamesOf<Captures["optional"]>): CaptureResult<TNode> | undefined;
  get(handle: Captures["many"] & UseGetAllInstead): never;
  get(handle: AnyCapture | string): CaptureResult<TNode> | undefined {
    const results = this.#resolve(handle);
    if (results.length > 1) {
      throw new CaptureCardinalityError(
        `${String(handle)} matched ${results.length} times at ${formatLocation(this.document, this.start)}; ` +
          "use getAll() for a repeated capture",
        { count: results.length },
      );
    }
    return results[0];
  }

  /** Every result for a handle, in match order. Empty when it did not participate. */
  getAll(
    handle:
      | Captures["one"]
      | Captures["optional"]
      | Captures["many"]
      | NamesOf<Captures["one"] | Captures["optional"] | Captures["many"]>,
  ): CaptureResult<TNode>[];
  getAll(handle: AnyCapture | string): CaptureResult<TNode>[] {
    return this.#resolve(handle);
  }

  has(
    handle:
      | Captures["one"]
      | Captures["optional"]
      | Captures["many"]
      | NamesOf<Captures["one"] | Captures["optional"] | Captures["many"]>,
  ): boolean;
  has(handle: AnyCapture | string): boolean {
    return this.#resolve(handle).length > 0;
  }

  captures(): CaptureResult<TNode>[] {
    return [...this.#bindings.values()].flat();
  }

  /** Where an edit aimed at `target` lands: a capture of this match, or a range. */
  #resolveTarget(target: unknown): EditTargetInput {
    if (typeof target === "string" || (target && typeof target === "object" && (target as AnyCapture).kind === "capture")) {
      const result = this.#resolve(target as AnyCapture | string)[0];
      if (!result) {
        throw new CaptureCardinalityError(
          `${String(target)} did not bind in this match, so there is nothing to edit`,
        );
      }
      return result;
    }
    return target as EditTargetInput;
  }

  #editTag(
    build: (target: EditTargetInput, replacement: SourceValue) => Edit,
    target: EditTargetInput,
  ): EditTag<Captures> {
    return (strings, ...values) =>
      build(target, buildSourceTemplate(strings as unknown as readonly string[], values, this.language).resolveWith(this));
  }

  #editFactory(build: (target: EditTargetInput, replacement: SourceValue) => Edit): EditFactory<Captures> {
    const factory = (first: unknown, ...rest: unknown[]) => {
      if (isTemplateStrings(first)) {
        return this.#editTag(build, this.range)(first, ...(rest as ReplacementValue<Captures>[]));
      }
      return this.#editTag(build, this.#resolveTarget(first));
    };
    return factory as EditFactory<Captures>;
  }

  /**
   * `match.replace\`…\`` rewrites the whole match; `match.replace(handle)\`…\``
   * rewrites one capture. Interpolated handles insert what this match captured,
   * so no `.get()` is needed to build replacement source.
   */
  get replace(): EditFactory<Captures> {
    return this.#editFactory(replace);
  }

  get insertBefore(): EditFactory<Captures> {
    return this.#editFactory(insertBefore);
  }

  get insertAfter(): EditFactory<Captures> {
    return this.#editFactory(insertAfter);
  }

  /** `match.remove()` drops the whole match; `match.remove(handle)` drops a capture. */
  remove(target?: MatchEditTarget<Captures>): Edit {
    return remove(target === undefined ? this : this.#resolveTarget(target));
  }

  transform(edits: readonly (Edit | null | undefined)[] | Edit): string {
    return applyEdits(this.document, edits);
  }

  /** Apply edits built from this match in one validated pass. */
  rewrite(...edits: readonly Edit[]): string {
    return applyEdits(this.document, edits);
  }

  toString(): string {
    return `Match(${formatLocation(this.document, this.start)} ${JSON.stringify(this.text())})`;
  }
}
