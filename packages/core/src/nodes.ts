import type { AnyAdapter, LanguageAdapter, TriviaClass } from "./adapter.js";
import type { CaptureSet } from "./captures.js";
import { isCodeFragment } from "./code.js";
import { AdapterContractError, MatchError } from "./errors.js";
import type { Match } from "./match.js";
import type { ParsedDocument, Query } from "./parsed.js";
import type { Pattern } from "./pattern.js";
import { SourceDocument, SourceSlice } from "./source.js";

/**
 * A parser node normalized to what the matcher needs: a kind, an absolute
 * range in the root document, ordered children, and trivia/error metadata.
 * The original parser node stays reachable through `raw`.
 */
export class NodeRef<TNode = unknown> {
  readonly kind: string;
  readonly start: number;
  readonly end: number;
  readonly raw: TNode;
  readonly document: SourceDocument;
  readonly trivia: TriviaClass;
  readonly error: boolean;
  /** Does this kind hold a list, rather than a fixed set of parts? */
  readonly variadic: boolean;
  /** What separates this list's items, when the adapter says. */
  readonly listSeparator: string | null;
  readonly children: NodeRef<TNode>[] = [];
  parent: NodeRef<TNode> | null = null;
  /** Set on a tree's root by the parse that owns it; every node reaches it by climbing. */
  #parsed: ParsedDocument<unknown, TNode> | null = null;

  constructor(init: {
    kind: string;
    start: number;
    end: number;
    raw: TNode;
    document: SourceDocument;
    trivia?: TriviaClass;
    error?: boolean;
    variadic?: boolean;
    listSeparator?: string | null;
  }) {
    this.kind = init.kind;
    this.start = init.start;
    this.end = init.end;
    this.raw = init.raw;
    this.document = init.document;
    this.trivia = init.trivia ?? null;
    this.error = init.error ?? false;
    this.variadic = init.variadic ?? false;
    this.listSeparator = init.listSeparator ?? null;
  }

  get isLeaf(): boolean {
    return this.children.length === 0;
  }

  /** The parse this node came from, so a node can be asked the same things a document can. */
  get parsed(): ParsedDocument<unknown, TNode> {
    let node: NodeRef<TNode> = this;
    while (node.parent) node = node.parent;
    if (!node.#parsed) {
      throw new MatchError("this node is not attached to a parse, so it cannot be searched");
    }
    return node.#parsed;
  }

  /** @internal — called once by the ParsedDocument that owns this tree. */
  static attach<TNode>(root: NodeRef<TNode>, parsed: ParsedDocument<unknown, TNode>): void {
    root.#parsed = parsed;
  }

  #pattern<Captures extends CaptureSet>(query: Query<Captures, TNode>): Pattern<Captures, TNode> {
    return isCodeFragment(query)
      ? query.compile<TNode>(this.parsed.language)
      : (query as Pattern<Captures, TNode>);
  }

  /**
   * The first match inside this node, or null. The node itself is never a
   * match — only what it contains, as with a document.
   */
  match<Captures extends CaptureSet>(query: Query<Captures, TNode>): Match<Captures, TNode> | null {
    return this.#pattern(query).match(this);
  }

  /** Every match inside this node, outermost first. */
  matchAll<Captures extends CaptureSet>(query: Query<Captures, TNode>): Match<Captures, TNode>[] {
    return this.#pattern(query).findAll(this);
  }

  includes(query: Query<any, TNode>): boolean {
    return this.match(query) !== null;
  }

  count(query: Query<any, TNode>): number {
    return this.matchAll(query).length;
  }

  /** This node and everything below it, depth-first in source order. */
  nodes(): NodeRef<TNode>[] {
    return [...walk(this)];
  }

  text(): string {
    return this.document.text.slice(this.start, this.end);
  }

  /** The first child of this kind — the part of a construct you mean by name. */
  child(kind: string): NodeRef<TNode> | undefined {
    return this.children.find((child) => child.kind === kind);
  }

  /** Every child of this kind, in source order. */
  childrenOf(kind: string): NodeRef<TNode>[] {
    return this.children.filter((child) => child.kind === kind);
  }

  slice(): SourceSlice {
    return new SourceSlice(this.document, this.start, this.end);
  }

  toString(): string {
    return `${this.kind}[${this.start}..${this.end}]`;
  }
}

/** Depth-first, source order, parents before children. */
export function* walk<TNode>(node: NodeRef<TNode>): Generator<NodeRef<TNode>> {
  yield node;
  for (const child of node.children) yield* walk(child);
}

function fail(adapter: AnyAdapter, message: string, details: Record<string, unknown> = {}): never {
  throw new AdapterContractError(`[${adapter.id}] ${message}`, { adapter: adapter.id, ...details });
}

/**
 * Turn one adapter parse result into a validated NodeRef tree whose offsets are
 * absolute in `document`. `origin` is where the parsed text starts inside it,
 * which is what makes a nested parse of a capture addressable in the root file.
 */
export function normalize<TParsed, TNode>(input: {
  adapter: LanguageAdapter<TParsed, TNode, any>;
  parsed: TParsed;
  document: SourceDocument;
  origin: number;
  localLength: number;
}): NodeRef<TNode> {
  const { adapter, parsed, document, origin, localLength } = input;
  const rootNode = adapter.root(parsed);
  if (rootNode == null) fail(adapter, "root() returned nothing");

  const convert = (node: TNode, parentRef: NodeRef<TNode> | null, depth: number): NodeRef<TNode> => {
    if (depth > 2000) fail(adapter, "tree nesting exceeded 2000 levels");
    const range = adapter.range(node);
    if (!range || !Number.isInteger(range.start) || !Number.isInteger(range.end)) {
      fail(adapter, `range() must return integer offsets, got ${JSON.stringify(range)}`);
    }
    if (range.start < 0 || range.end < range.start || range.end > localLength) {
      fail(
        adapter,
        `range ${range.start}..${range.end} is outside 0..${localLength} (node kind ${adapter.kind(node)})`,
        { range },
      );
    }
    const kind = adapter.kind(node);
    if (typeof kind !== "string" || kind.length === 0) {
      fail(adapter, "kind() must return a non-empty string");
    }

    const ref = new NodeRef<TNode>({
      kind,
      start: origin + range.start,
      end: origin + range.end,
      raw: node,
      document,
      trivia: adapter.triviaClass ? adapter.triviaClass(node) ?? null : null,
      error: adapter.isErrorNode ? Boolean(adapter.isErrorNode(node)) : false,
      variadic: adapter.isVariadic ? Boolean(adapter.isVariadic(kind)) : false,
      listSeparator: adapter.listSeparator ? adapter.listSeparator(kind) : null,
    });
    ref.parent = parentRef;

    if (parentRef && (ref.start < parentRef.start || ref.end > parentRef.end)) {
      fail(adapter, `child ${ref} is not contained in parent ${parentRef}`, { child: ref, parent: parentRef });
    }

    let previousEnd = -1;
    for (const rawChild of adapter.children(node) ?? []) {
      const childRef = convert(rawChild, ref, depth + 1);
      if (childRef.start < previousEnd) {
        fail(
          adapter,
          `children of ${ref} are not in source order (${childRef} starts before the previous child ends)`,
        );
      }
      previousEnd = childRef.end;
      ref.children.push(childRef);
    }
    return ref;
  };

  return convert(rootNode, null, 0);
}
