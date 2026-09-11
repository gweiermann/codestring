import type { CaptureSet } from "./captures.js";
import type { Match } from "./match.js";
import type { SourceDocument, SourceSlice } from "./source.js";
import type { ParsedDocument } from "./parsed.js";

/** What a pattern can be asked to match: text, a document, a slice or a match. */
export type MatchInput<TNode = unknown> =
  | string
  | SourceDocument
  | SourceSlice
  | ParsedDocument<unknown, TNode>
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
