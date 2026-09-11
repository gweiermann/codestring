import type { AdapterNodeOf, AnyAdapter, LanguageAdapter, ParseDiagnostic, ParsedOf } from "./adapter.js";
import { AdapterContractError } from "./errors.js";
import { SourceDocument, SourceSlice, toDocument } from "./source.js";
import { normalize } from "./nodes.js";
import { ParsedDocument, type ParsedLanguage, checkParsePolicy } from "./parsed.js";

import { Pattern, type PatternLanguage } from "./pattern.js";
import type { CaptureSet, CapturesOf, PatternValue } from "./captures.js";
import type { LanguageOptions, ParseInputOptions, PatternOptions } from "./options.js";
import type { MatchInput } from "./pattern-handle.js";

const REQUIRED = ["id", "parse", "root", "kind", "range", "children"] as const;

function assertAdapter(adapter: unknown): asserts adapter is AnyAdapter {
  if (!adapter || typeof adapter !== "object") {
    throw new AdapterContractError("createLanguage() needs a language adapter object");
  }
  for (const key of REQUIRED) {
    if ((adapter as Record<string, unknown>)[key] === undefined) {
      throw new AdapterContractError(`adapter is missing ${key}`, {
        adapter: (adapter as AnyAdapter).id,
      });
    }
  }
}

function isTemplateStrings(value: unknown): value is TemplateStringsArray {
  return Array.isArray(value) && Array.isArray((value as unknown as TemplateStringsArray).raw);
}

const parseCaches = new WeakMap<SourceDocument, Map<string, ParsedDocument<any, any>>>();

function cacheFor(document: SourceDocument) {
  let cache = parseCaches.get(document);
  if (!cache) {
    cache = new Map();
    parseCaches.set(document, cache);
  }
  return cache;
}

/** Compiles a matcher. Holes are capture handles, combinators or sub-patterns. */
export interface PatternTag<TNode> {
  <const Values extends readonly PatternValue[]>(
    strings: TemplateStringsArray,
    ...values: Values
  ): Pattern<CapturesOf<Values[number]>, TNode>;
}

export interface PatternFactory<TNode> extends PatternTag<TNode> {
  /** The same tag, with the trivia and parse-error policies overridden. */
  (options: PatternOptions): PatternTag<TNode>;
}

export interface Language<TAdapter extends AnyAdapter = AnyAdapter> {
  readonly id: string;
  readonly adapter: TAdapter;
  readonly defaults: LanguageOptions;

  document(text: string, id?: string): SourceDocument;
  parse(
    input: MatchInput<AdapterNodeOf<TAdapter>>,
    options?: ParseInputOptions,
  ): ParsedDocument<ParsedOf<TAdapter>, AdapterNodeOf<TAdapter>>;

  readonly pattern: PatternFactory<AdapterNodeOf<TAdapter>>;
}

/**
 * Bind one adapter to the two tagged templates and the parse entry point.
 * `pattern` compiles a matcher; `source` composes replacement text.
 */
export function createLanguage<TAdapter extends AnyAdapter>(
  adapter: TAdapter,
  defaults: LanguageOptions = {},
): Language<TAdapter> {
  assertAdapter(adapter);
  type TParsed = ParsedOf<TAdapter>;
  type TNode = AdapterNodeOf<TAdapter>;
  const typed = adapter as unknown as LanguageAdapter<TParsed, TNode, unknown>;

  const parse = (
    input: MatchInput<TNode>,
    options: ParseInputOptions = {},
  ): ParsedDocument<TParsed, TNode> => {
    let document: SourceDocument;
    let origin: number;
    let text: string;

    if (input instanceof ParsedDocument) {
      if (input.adapter === adapter) return input as ParsedDocument<TParsed, TNode>;
      document = input.document;
      origin = input.origin;
      text = document.text.slice(origin, origin + input.root.end - input.root.start);
    } else if (input instanceof SourceSlice) {
      document = input.document;
      origin = input.start;
      text = input.text();
    } else if (input && typeof input === "object" && (input as { range?: SourceSlice }).range instanceof SourceSlice) {
      const range = (input as { range: SourceSlice }).range;
      document = range.document;
      origin = range.start;
      text = range.text();
    } else {
      document = toDocument(input as string | SourceDocument, options.id);
      origin = 0;
      text = document.text;
    }

    const parseOptions = { ...defaults.parseOptions, ...options.parseOptions };
    const key = `${adapter.id}|${origin}|${text.length}|${JSON.stringify(parseOptions)}`;
    const cache = cacheFor(document);
    const cached = cache.get(key);
    if (cached) return cached as ParsedDocument<TParsed, TNode>;

    const parsed = typed.parse(text, parseOptions);
    const diagnostics: ParseDiagnostic[] = (typed.diagnostics ? typed.diagnostics(parsed) : []).map(
      (diagnostic) => ({ severity: "error", ...diagnostic }),
    );
    const root = normalize({ adapter: typed, parsed, document, origin, localLength: text.length });
    const parsedDocument = new ParsedDocument<TParsed, TNode>({
      document,
      root,
      adapter: typed,
      diagnostics,
      origin,
      raw: parsed,
      language: language as unknown as ParsedLanguage<TParsed, TNode>,
    });

    checkParsePolicy({
      parsedDocument,
      policy: options.onParseError ?? defaults.onParseError ?? "allow-outside-errors",
    });

    cache.set(key, parsedDocument);
    return parsedDocument;
  };

  const language = {
    id: adapter.id,
    adapter,
    defaults,
    document: (text: string, id?: string) => new SourceDocument(text, id),
    parse,
  } as Language<TAdapter> & PatternLanguage<TNode>;

  const makeTag =
    (options: PatternOptions): PatternTag<TNode> =>
    ((strings: TemplateStringsArray, ...values: readonly PatternValue[]) =>
      new Pattern(language as PatternLanguage<TNode>, strings as unknown as readonly string[], values, {
        ...defaults,
        ...options,
      })) as PatternTag<TNode>;

  const patternFactory = ((...args: unknown[]) => {
    if (isTemplateStrings(args[0])) {
      const [strings, ...values] = args as [TemplateStringsArray, ...PatternValue[]];
      return makeTag({})(strings, ...values);
    }
    return makeTag((args[0] as PatternOptions) ?? {});
  }) as PatternFactory<TNode>;

  return Object.assign(language, { pattern: patternFactory });
}

export type CapturesOfPattern<P> = P extends Pattern<infer Captures, any> ? Captures : never;
export type NodeOfPattern<P> = P extends Pattern<any, infer TNode> ? TNode : never;
export type MatchOf<P> = P extends { match(input: any): infer M | null } ? NonNullable<M> : never;
export type LanguageNodeOf<L> = L extends Language<infer TAdapter> ? AdapterNodeOf<TAdapter> : never;
export type { CaptureSet };
