import { MatchError } from "./errors.js";
import {
  type CompiledPattern,
  type PatternIR,
  type RepIR,
  type TriviaPolicy,
  comparisonText,
  filterTrivia,
} from "./compile.js";
import { type NodeRef, walk } from "./nodes.js";
import type { ParsedDocument } from "./parsed.js";
import type { AnyCapture } from "./captures.js";
import type { AnyAdapter } from "./adapter.js";
import type { SourceDocument } from "./source.js";

const STEP_BUDGET = 2_000_000;

export interface Binding<TNode> {
  readonly nodes: readonly NodeRef<TNode>[];
  readonly start: number;
  readonly end: number;
}

export type Bindings<TNode> = Map<AnyCapture, Binding<TNode>[]>;

export interface SearchResult<TNode> {
  readonly range: { readonly start: number; readonly end: number };
  readonly nodes: readonly NodeRef<TNode>[];
  readonly bindings: Bindings<TNode>;
}

export interface MatchFailure<TNode> {
  readonly reason: "kind" | "text" | "shape" | "end";
  readonly offset: number;
  readonly expected: string;
  readonly actual: string;
  readonly node: NodeRef<TNode> | null;
}

function normalizeText(text: string, trivia: TriviaPolicy): string {
  if (trivia === "exact") return text;
  return text.trim().replace(/\s+/gu, " ");
}

class MatchContext<TNode> {
  readonly trivia: TriviaPolicy;
  readonly adapter: AnyAdapter;
  readonly document: SourceDocument;
  readonly wantExplanation: boolean;
  bindings: Bindings<TNode> = new Map();
  trail: AnyCapture[] = [];
  steps = 0;
  failure: MatchFailure<TNode> | null = null;
  emptyAnchor = 0;

  constructor(init: {
    trivia: TriviaPolicy;
    adapter: AnyAdapter;
    document: SourceDocument;
    wantExplanation: boolean;
  }) {
    this.trivia = init.trivia;
    this.adapter = init.adapter;
    this.document = init.document;
    this.wantExplanation = init.wantExplanation;
  }

  step(): void {
    if (++this.steps > STEP_BUDGET) {
      throw new MatchError(
        "matching exceeded its step budget; the pattern has too many ambiguous repetitions",
        { steps: this.steps },
      );
    }
  }

  mark(): number {
    return this.trail.length;
  }

  reset(mark: number): void {
    while (this.trail.length > mark) {
      const capture = this.trail.pop()!;
      const list = this.bindings.get(capture)!;
      list.pop();
      if (list.length === 0) this.bindings.delete(capture);
    }
  }

  bind(capture: AnyCapture | null, nodes: readonly NodeRef<TNode>[], start: number, end: number): void {
    if (!capture) return;
    let list = this.bindings.get(capture);
    if (!list) {
      list = [];
      this.bindings.set(capture, list);
    }
    list.push({ nodes, start, end });
    this.trail.push(capture);
  }

  note(failure: MatchFailure<TNode>): void {
    if (!this.wantExplanation) return;
    if (!this.failure || failure.offset >= this.failure.offset) this.failure = failure;
  }
}

function matchNodeIR<TNode>(ir: PatternIR & { t: "node" }, node: NodeRef<TNode>, ctx: MatchContext<TNode>): boolean {
  ctx.step();
  if (ir.kind === null) {
    // The pattern left the kind open, so only what is inside has to agree.
    const children = filterTrivia(node.children, ctx.trivia);
    const previousAnchor = ctx.emptyAnchor;
    ctx.emptyAnchor = children.length > 0 ? children[0]!.start : node.start;
    const matched =
      ir.children.length === 0
        ? true
        : matchSequence(ir.children, 0, children, 0, ctx, (end) => end === children.length);
    ctx.emptyAnchor = previousAnchor;
    if (matched && ir.capture) ctx.bind(ir.capture, [node], node.start, node.end);
    return matched;
  }
  if (ir.kind !== node.kind) {
    // A wrapper the parser adds around a fragment is transparent on the source
    // side too, so a pattern written as an expression still matches where the
    // grammar wrapped it in a statement.
    const inner = transparentChild(node, ctx);
    if (inner) return matchNodeIR(ir, inner, ctx);
    ctx.note({ reason: "kind", offset: node.start, expected: ir.kind, actual: node.kind, node });
    return false;
  }
  if (ir.leaf) {
    // The pattern's own children were trivia-filtered before it was called a
    // leaf, so the source node has to be judged the same way: a tag whose only
    // child is the whitespace inside it is a leaf to both of them.
    const children = filterTrivia(node.children, ctx.trivia);
    if (children.length > 0) {
      ctx.note({
        reason: "shape",
        offset: node.start,
        expected: `${ir.kind} without children`,
        actual: `${ir.kind} with ${children.length} children`,
        node,
      });
      return false;
    }
    const expected = normalizeText(ir.text ?? "", ctx.trivia);
    const actual = normalizeText(comparisonText(ctx.adapter, node as NodeRef<unknown>), ctx.trivia);
    if (expected !== actual) {
      ctx.note({ reason: "text", offset: node.start, expected, actual, node });
      return false;
    }
    return true;
  }
  const children = filterTrivia(node.children, ctx.trivia);
  const previousAnchor = ctx.emptyAnchor;
  ctx.emptyAnchor = children.length > 0 ? children[0]!.start : node.start;
  const matched = matchSequence(ir.children, 0, children, 0, ctx, (end) => end === children.length);
  ctx.emptyAnchor = previousAnchor;
  return matched;
}

/** The single child of a wrapper node the adapter calls transparent. */
function transparentChild<TNode>(node: NodeRef<TNode>, ctx: MatchContext<TNode>): NodeRef<TNode> | null {
  if (!ctx.adapter.isPatternWrapper?.(node.kind)) return null;
  const children = filterTrivia(node.children, ctx.trivia);
  return children.length === 1 ? children[0]! : null;
}

function matchItem<TNode>(item: PatternIR, node: NodeRef<TNode>, ctx: MatchContext<TNode>): boolean {
  switch (item.t) {
    case "node":
      return matchNodeIR(item, node, ctx);
    case "hole1":
      ctx.step();
      ctx.bind(item.capture, [node], node.start, node.end);
      return true;
    case "alt":
      for (const option of item.options) {
        const mark = ctx.mark();
        if (matchItem(option, node, ctx)) return true;
        ctx.reset(mark);
      }
      return false;
    default:
      throw new MatchError(`item ${item.t} cannot match a single node`);
  }
}

/**
 * Match pattern items against a run of sibling nodes. Repetitions are greedy
 * over siblings and backtrack only within this one sibling list, never across
 * the tree, which keeps the search bounded.
 */
function matchSequence<TNode>(
  items: readonly PatternIR[],
  i: number,
  nodes: readonly NodeRef<TNode>[],
  j: number,
  ctx: MatchContext<TNode>,
  done: (end: number) => boolean,
): boolean {
  ctx.step();
  if (i === items.length) return done(j);
  const item = items[i]!;

  if (item.t === "rep") {
    return matchRepetition(item, items, i, nodes, j, ctx, done);
  }

  if (j >= nodes.length) {
    ctx.note({
      reason: "end",
      offset: nodes.length > 0 ? nodes[nodes.length - 1]!.end : 0,
      expected: describeItem(item),
      actual: "end of siblings",
      node: nodes[nodes.length - 1] ?? null,
    });
    return false;
  }

  const mark = ctx.mark();
  if (matchItem(item, nodes[j]!, ctx) && matchSequence(items, i + 1, nodes, j + 1, ctx, done)) {
    return true;
  }
  ctx.reset(mark);
  return false;
}

function matchRepetition<TNode>(
  item: RepIR,
  items: readonly PatternIR[],
  i: number,
  nodes: readonly NodeRef<TNode>[],
  start: number,
  ctx: MatchContext<TNode>,
  done: (end: number) => boolean,
): boolean {
  const take = (pos: number, taken: number): boolean => {
    if (taken < item.max && pos < nodes.length) {
      const mark = ctx.mark();
      if (matchItem(item.item, nodes[pos]!, ctx) && take(pos + 1, taken + 1)) return true;
      ctx.reset(mark);
    }
    if (taken < item.min) return false;
    const mark = ctx.mark();
    if (item.spanCapture) {
      const consumed = nodes.slice(start, pos);
      const bounds = spanBounds(consumed, nodes, start, ctx);
      ctx.bind(item.spanCapture, consumed, bounds.start, bounds.end);
    }
    if (matchSequence(items, i + 1, nodes, pos, ctx, done)) return true;
    ctx.reset(mark);
    return false;
  };
  return take(start, 0);
}

/** A capture that consumed nothing still needs a position: the seam it sat at. */
function spanBounds<TNode>(
  consumed: readonly NodeRef<TNode>[],
  nodes: readonly NodeRef<TNode>[],
  start: number,
  ctx: MatchContext<TNode>,
): { start: number; end: number } {
  if (consumed.length > 0) {
    return { start: consumed[0]!.start, end: consumed[consumed.length - 1]!.end };
  }
  if (nodes.length === 0) return { start: ctx.emptyAnchor, end: ctx.emptyAnchor };
  if (start < nodes.length) return { start: nodes[start]!.start, end: nodes[start]!.start };
  const last = nodes[nodes.length - 1]!;
  return { start: last.end, end: last.end };
}

function describeItem(item: PatternIR): string {
  switch (item.t) {
    case "node":
      return item.kind ?? "any kind";
    case "hole1":
      return item.capture ? item.capture.toString() : "any()";
    case "alt":
      return `oneOf(${item.options.map(describeItem).join(", ")})`;
    case "rep":
      return `${item.label ?? "repeat"}(${describeItem(item.item)})`;
  }
}

/**
 * Try the pattern against every contiguous run of siblings, depth-first in
 * source order. A single-node pattern is just a run of length one.
 */
export function search<TNode>(
  parsedDocument: ParsedDocument<unknown, TNode>,
  compiled: CompiledPattern,
  options: { wantExplanation?: boolean } = {},
): { results: SearchResult<TNode>[]; failure: MatchFailure<TNode> | null } {
  const results: SearchResult<TNode>[] = [];
  const seenRanges = new Set<string>();
  const ctx = new MatchContext<TNode>({
    trivia: compiled.trivia,
    adapter: parsedDocument.adapter,
    document: parsedDocument.document,
    wantExplanation: options.wantExplanation ?? false,
  });
  const firstItem = compiled.items[0]!;
  const requiredKind = firstItem.t === "node" ? firstItem.kind : null;

  for (const node of walk(parsedDocument.root)) {
    const children = filterTrivia(node.children, compiled.trivia);
    if (children.length === 0) continue;
    ctx.emptyAnchor = children[0]!.start;

    for (let start = 0; start < children.length; start++) {
      if (requiredKind !== null && children[start]!.kind !== requiredKind) continue;
      ctx.bindings = new Map();
      ctx.trail = [];
      let end = -1;
      const matched = matchSequence(compiled.items, 0, children, start, ctx, (position) => {
        end = position;
        return true;
      });
      if (!matched || end <= start) continue;

      const nodes = children.slice(start, end);
      const range = { start: nodes[0]!.start, end: nodes[nodes.length - 1]!.end };
      const key = `${range.start}:${range.end}`;
      if (seenRanges.has(key)) continue;
      seenRanges.add(key);
      results.push({ range, nodes, bindings: ctx.bindings });
    }
  }

  // Traversal visits parents before children, so collected results are not yet
  // in source order; callers get start-ascending, outermost-first.
  results.sort((a, b) => a.range.start - b.range.start || b.range.end - a.range.end);
  return { results, failure: ctx.failure };
}
