import type { CaptureSet, CapturesOf, PatternValue } from "./captures.js";
import type { SourceSlice } from "./source.js";
import { PatternCompileError } from "./errors.js";
import type { PatternOptions } from "./options.js";
import type { Pattern, PatternLanguage } from "./pattern.js";
import { type CaptureLookup, type SourceTemplate, buildSourceTemplate } from "./template.js";

interface CacheEntry {
  readonly values: readonly unknown[];
  readonly languageId: string;
  readonly optionsKey: string;
  readonly pattern: Pattern<any, any>;
}

/**
 * A template literal's `strings` array is created once per call site, so it is
 * the natural cache key: the same `code` literal compiles once per language.
 */
const compiled = new WeakMap<readonly string[], CacheEntry[]>();

function sameValues(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function optionsKey(options: PatternOptions): string {
  return `${options.trivia ?? ""}|${options.onParseError ?? ""}|${JSON.stringify(options.parseOptions ?? null)}`;
}

/**
 * Source with holes in it, not yet tied to a language. Whether it acts as
 * something to find or something to write is decided by where it is used: the
 * first argument of `replace` is a pattern, the second is a replacement.
 */
export class CodeFragment<Captures extends CaptureSet = CaptureSet> {
  readonly isCodeFragment = true as const;
  readonly strings: readonly string[];
  readonly values: readonly unknown[];
  readonly options: PatternOptions;

  constructor(strings: readonly string[], values: readonly unknown[], options: PatternOptions = {}) {
    this.strings = strings;
    this.values = values;
    this.options = options;
  }

  /** Compile for one language, reusing the result across calls at this site. */
  compile<TNode>(language: PatternLanguage<TNode>): Pattern<Captures, TNode> {
    const key = optionsKey(this.options);
    const entries = compiled.get(this.strings);
    const hit = entries?.find(
      (entry) =>
        entry.languageId === language.id && entry.optionsKey === key && sameValues(entry.values, this.values),
    );
    if (hit) return hit.pattern as Pattern<Captures, TNode>;

    const tag = language.pattern(this.options) as unknown as (
      strings: TemplateStringsArray,
      ...values: readonly PatternValue[]
    ) => Pattern<Captures, TNode>;
    const pattern = tag(this.strings as unknown as TemplateStringsArray, ...(this.values as PatternValue[]));
    const entry: CacheEntry = { values: this.values, languageId: language.id, optionsKey: key, pattern };
    if (entries) entries.push(entry);
    else compiled.set(this.strings, [entry]);
    return pattern;
  }

  /** Use the fragment as replacement source, binding its handles to a match. */
  toTemplate(languageId: string, match?: CaptureLookup): SourceTemplate {
    for (const value of this.values) {
      const kind = (value as { kind?: string } | null)?.kind;
      if (kind === "any" || kind === "repeat" || kind === "choice") {
        throw new PatternCompileError(
          `${String(value)} says how to match, so it cannot be written into replacement source`,
        );
      }
    }
    const template = buildSourceTemplate(this.strings, this.values as never[], languageId);
    return match ? template.resolveWith(match) : template;
  }

  /** The literal text, for a fragment whose holes are all resolvable already. */
  text(): string {
    return this.toTemplate("code").text();
  }

  toString(): string {
    return this.strings.join("…");
  }
}

export function isCodeFragment(value: unknown): value is CodeFragment<any> {
  return Boolean(value && typeof value === "object" && (value as CodeFragment).isCodeFragment === true);
}

/** Everything a code fragment may hold: pattern values, plus ready-made source. */
export type CodeValue = PatternValue | SourceSlice | SourceTemplate;

export interface CodeTag {
  <const Values extends readonly CodeValue[]>(
    strings: TemplateStringsArray,
    ...values: Values
  ): CodeFragment<CapturesOf<Values[number]>>;
}

export interface CodeFactory extends CodeTag {
  /** The same tag with the trivia or parse-error policy overridden. */
  (options: PatternOptions): CodeTag;
}

function isTemplateStrings(value: unknown): value is TemplateStringsArray {
  return Array.isArray(value) && Array.isArray((value as unknown as TemplateStringsArray).raw);
}

/**
 * The one authoring tag. `code` fragments are language-agnostic until they meet
 * a parsed document, which is what lets the same literal be a pattern in one
 * place and a replacement in another.
 */
export const code: CodeFactory = ((...args: unknown[]) => {
  if (isTemplateStrings(args[0])) {
    const [strings, ...values] = args as [TemplateStringsArray, ...CodeValue[]];
    return new CodeFragment(strings as unknown as readonly string[], values);
  }
  const options = (args[0] as PatternOptions) ?? {};
  return (strings: TemplateStringsArray, ...values: CodeValue[]) =>
    new CodeFragment(strings as unknown as readonly string[], values, options);
}) as CodeFactory;
