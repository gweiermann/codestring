import type { CaptureSet } from "./captures.js";
import type { Match } from "./match.js";
import type { SourceDocument, SourceSlice } from "./source.js";
import type { ParsedDocument } from "./parsed.js";
import type { NodeRef } from "./nodes.js";

/**
 * What a pattern can be asked to match: text, a document, a slice, a match, or
 * a node.
 *
 * Everything but a node is parsed first. A node is not: it is already part of a
 * tree, so the search runs inside the one it belongs to. That is the difference
 * between asking about a subtree and asking about its text — `{ methods: {} }`
 * is an object in the file it came from and a block statement on its own.
 */
export type MatchInput<TNode = unknown> =
  | string
  | SourceDocument
  | SourceSlice
  | ParsedDocument<unknown, TNode>
  | NodeRef<TNode>
  | { readonly range: SourceSlice };

/**
 * The public shape of a compiled pattern, carrying the capture set its holes
 * declared and the node type of the language it belongs to.
 */
export interface PatternHandle<Captures extends CaptureSet = CaptureSet, TNode = unknown> {
  readonly isStructuralPattern: true;
  readonly language: { readonly id: string };

  match(input: MatchInput<TNode>): Match<Captures, TNode> | null;
  findAll(input: MatchInput<TNode>): Match<Captures, TNode>[];
  matches(input: MatchInput<TNode>): boolean;
  debug(): string;
  explain(input: MatchInput<TNode>): string;
}
