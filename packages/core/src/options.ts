import type { ParseOptions } from "./adapter.js";
import type { ParseErrorPolicy } from "./parsed.js";
import type { TriviaPolicy } from "./compile.js";

export interface PatternOptions {
  /** How whitespace and comments take part in matching. Default: whitespace-flexible. */
  readonly trivia?: TriviaPolicy;
  /** What to do about source the parser could not read. Default: allow-outside-errors. */
  readonly onParseError?: ParseErrorPolicy;
  /** Passed through to the adapter's parse(). */
  readonly parseOptions?: ParseOptions;
}

export interface LanguageOptions extends PatternOptions {}

export interface ParseInputOptions extends PatternOptions {
  readonly id?: string;
}
