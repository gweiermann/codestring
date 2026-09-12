export interface Range {
  readonly start: number;
  readonly end: number;
}

/**
 * Trivia the matcher may skip. A `separator` is punctuation that holds a list
 * together — a CSS semicolon — which a pattern should not have to spell out.
 */
export type TriviaClass = "whitespace" | "comment" | "separator" | null;

export interface ParseDiagnostic {
  readonly message: string;
  readonly severity?: "error" | "warning";
  readonly range?: Range;
  readonly code?: string;
}

export interface ParseOptions {
  readonly [option: string]: unknown;
}

/** What a pattern hole sits between, so an adapter can pad it to stay parseable. */
export interface PlaceholderContext {
  readonly before: string;
  readonly after: string;
  readonly fallback: string;
}

/**
 * The whole surface a language must implement. An adapter normalizes a parser;
 * it never implements captures, repetition, matching or edits.
 *
 * @typeParam TParsed the parser's own result object
 * @typeParam TNode   the parser's own node type, which reaches users as `NodeRef.raw`
 * @typeParam TToken  the parser's own token type, when it exposes one
 */
export interface LanguageAdapter<TParsed = unknown, TNode = unknown, TToken = unknown> {
  readonly id: string;

  parse(source: string, options?: ParseOptions): TParsed;
  root(parsed: TParsed): TNode;
  kind(node: TNode): string;
  range(node: TNode): Range;
  children(node: TNode): readonly TNode[];

  diagnostics?(parsed: TParsed): readonly ParseDiagnostic[];
  triviaClass?(node: TNode): TriviaClass;
  isErrorNode?(node: TNode): boolean;
  isMissingNode?(node: TNode): boolean;

  /**
   * The text two leaves are compared by, when their source spelling says more
   * than their content does — a string literal's quotes, say. Defaults to the
   * node's own source.
   */
  compareText?(node: TNode, text: string): string;

  /**
   * Make a plain value safe to write into this syntactic context — a quote
   * inside a string literal, a `<` inside markup. Source slices are never
   * passed through this: they are already source, and keeping them byte for
   * byte is the point. Leave it out and values are written as they are.
   */
  escape?(value: string, context: { kind: string }): string;

  /** Does this kind hold an unbounded list of children? Decides whether a bare hole is a run. */
  isVariadic?(kind: string): boolean;
  /** A node the parser adds around a fragment, which a pattern should see through. */
  isPatternWrapper?(kind: string): boolean;

  placeholder?(index: number, context: PlaceholderContext): string;
  detectPlaceholder?(node: TNode, text: string): number | null;

  tokens?(parsed: TParsed): readonly TToken[];
  tokenRange?(token: TToken): Range;
  tokenKind?(token: TToken): string;
}

export type AnyAdapter = LanguageAdapter<any, any, any>;

export type ParsedOf<TAdapter> = TAdapter extends LanguageAdapter<infer TParsed, any, any> ? TParsed : never;
export type AdapterNodeOf<TAdapter> = TAdapter extends LanguageAdapter<any, infer TNode, any> ? TNode : never;
export type TokenOf<TAdapter> = TAdapter extends LanguageAdapter<any, any, infer TToken> ? TToken : never;

/**
 * Identity helper that infers `TParsed` and `TNode` from the implementation, so
 * an adapter gets contract checking without restating its parser's types.
 */
export function defineAdapter<TParsed, TNode, TToken = never>(
  adapter: LanguageAdapter<TParsed, TNode, TToken>,
): LanguageAdapter<TParsed, TNode, TToken> {
  return adapter;
}
