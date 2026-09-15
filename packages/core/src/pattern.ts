import { type CompiledPattern, compilePattern, describeIR, filterTrivia } from "./compile.js";
import { type MatchFailure, type SearchResult, search } from "./matcher.js";
import { Match } from "./match.js";
import { type ParsedDocument, errorRanges } from "./parsed.js";
import { formatLocation } from "./errors.js";
import type { CaptureSet } from "./captures.js";
import type { PatternOptions } from "./options.js";
import type { MatchInput, PatternHandle } from "./pattern-handle.js";
import { NodeRef } from "./nodes.js";
import type { AnyAdapter } from "./adapter.js";
import { MatchError } from "./errors.js";

/** The parts of a Language a Pattern needs, without a circular import. */
export interface PatternLanguage<TNode> {
  readonly id: string;
  readonly adapter: AnyAdapter;
  readonly defaults: PatternOptions;
  parse(input: MatchInput<TNode>, options?: PatternOptions): ParsedDocument<unknown, TNode>;
  readonly pattern: (options: PatternOptions) => (
    strings: TemplateStringsArray,
    ...values: readonly never[]
  ) => Pattern<any, TNode>;
}

function intersects(range: { start: number; end: number }, ranges: readonly { start: number; end: number }[]) {
  return ranges.some((other) => range.start < other.end && other.start < range.end);
}

/** The parse a node belongs to, refusing one a pattern of another language cannot read. */
function parseOf<TNode>(node: NodeRef<TNode>, language: string): ParsedDocument<unknown, TNode> {
  const parsed = node.parsed;
  if (parsed.language.id !== language) {
    throw new MatchError(
      `a ${language} pattern cannot search a ${parsed.language.id} node; parse the region with ${language} first`,
    );
  }
  return parsed;
}

export class Pattern<Captures extends CaptureSet = CaptureSet, TNode = unknown>
  implements PatternHandle<Captures, TNode>
{
  readonly isStructuralPattern = true as const;
  readonly language: PatternLanguage<TNode>;
  readonly strings: readonly string[];
  readonly values: readonly unknown[];
  readonly options: PatternOptions;
  #compiled: CompiledPattern | null = null;

  constructor(
    language: PatternLanguage<TNode>,
    strings: readonly string[],
    values: readonly unknown[],
    options: PatternOptions,
  ) {
    this.language = language;
    this.strings = strings;
    this.values = values;
    this.options = options;
  }

  get compiled(): CompiledPattern {
    this.#compiled ??= compilePattern({
      language: this.language,
      strings: this.strings,
      values: this.values,
      options: this.options,
    });
    return this.#compiled;
  }

  #search(
    input: MatchInput<TNode>,
    wantExplanation: boolean,
  ): {
    parsedDocument: ParsedDocument<unknown, TNode>;
    results: SearchResult<TNode>[];
    failure: MatchFailure<TNode> | null;
  } {
    const within = input instanceof NodeRef ? input : undefined;
    const parsedDocument = within ? parseOf(within, this.language.id) : this.language.parse(input, this.options);
    const { results, failure } = search(parsedDocument, this.compiled, { wantExplanation, within });
    const policy = this.options.onParseError ?? this.language.defaults.onParseError ?? "allow-outside-errors";
    let kept = results;
    if (policy === "allow-outside-errors" && parsedDocument.hasErrors()) {
      const broken = errorRanges(parsedDocument);
      kept = results.filter((result) => !intersects(result.range, broken));
    }
    return { parsedDocument, results: kept, failure };
  }

  match(input: MatchInput<TNode>): Match<Captures, TNode> | null {
    const { parsedDocument, results } = this.#search(input, false);
    const first = results[0];
    if (!first) return null;
    return new Match<Captures, TNode>({ pattern: this, parsedDocument, ...first });
  }

  findAll(input: MatchInput<TNode>): Match<Captures, TNode>[] {
    const { parsedDocument, results } = this.#search(input, false);
    return results.map((result) => new Match<Captures, TNode>({ pattern: this, parsedDocument, ...result }));
  }

  /** True when the pattern covers the whole input, not just a region of it. */
  matches(input: MatchInput<TNode>): boolean {
    const { parsedDocument, results } = this.#search(input, false);
    const top = filterTrivia(parsedDocument.root.children, this.compiled.trivia);
    if (top.length === 0) return false;
    const start = top[0]!.start;
    const end = top[top.length - 1]!.end;
    return results.some((result) => result.range.start === start && result.range.end === end);
  }

  debug(): string {
    const compiled = this.compiled;
    return [
      `Pattern<${this.language.id}> trivia=${compiled.trivia}`,
      "--- pattern source ---",
      compiled.source,
      "--- compiled ---",
      describeIR(compiled.items, "  "),
    ].join("\n");
  }

  /** Why a pattern did not match: the deepest place the matcher got stuck. */
  explain(input: MatchInput<TNode>): string {
    const { parsedDocument, results, failure } = this.#search(input, true);
    const first = results[0];
    if (first) {
      return `matched ${results.length} time(s); first at ${formatLocation(parsedDocument.document, first.range.start)}`;
    }
    const firstItem = this.compiled.items[0]!;
    if (!failure) {
      const expected = firstItem.t === "node" ? firstItem.kind : "?";
      return `no match, and no candidate node of kind ${expected} was reached`;
    }
    const lines = [`no match; the closest attempt stopped at ${formatLocation(parsedDocument.document, failure.offset)}`];
    lines.push(`  reason:   ${failure.reason}`);
    lines.push(`  expected: ${failure.expected}`);
    lines.push(`  actual:   ${failure.actual}`);
    if (failure.node) {
      lines.push(`  node:     ${failure.node.kind} ${JSON.stringify(failure.node.text().slice(0, 60))}`);
    }
    return lines.join("\n");
  }

  toString(): string {
    return `Pattern<${this.language.id}>`;
  }
}
