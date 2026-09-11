import {
  type AnyCapture,
  type Capture,
  type CaptureSet,
  type Language,
  type Match,
  type Pattern,
  type PatternOptions,
  type PatternValue,
  type SourceTemplate,
  CodeFragment,
  any,
  capture,
  exactly,
} from "@codestring/core";

const HOLE = /\$\$\$([A-Za-z_][A-Za-z0-9_]*|_)|\$([A-Za-z_][A-Za-z0-9_]*|_)/gu;

/** A pattern built at runtime binds handles the type system cannot know up front. */
export type RuntimeCaptures = { one: AnyCapture; optional: AnyCapture; many: AnyCapture };

export interface CompiledCliPattern {
  readonly pattern: Pattern<RuntimeCaptures, unknown>;
  readonly handles: Map<string, Capture<string>>;
}

function templateStrings(parts: readonly string[]): TemplateStringsArray {
  const strings = [...parts] as string[] & { raw: string[] };
  strings.raw = [...parts];
  return strings as unknown as TemplateStringsArray;
}

/**
 * Turn a command-line pattern into a real pattern. `$name` is one node,
 * `$$$name` is a run of siblings, and `_` is the anonymous name.
 */
export function compileCliPattern(
  language: Language<any>,
  text: string,
  options: PatternOptions = {},
): CompiledCliPattern {
  const parts: string[] = [];
  const values: PatternValue[] = [];
  const handles = new Map<string, Capture<string>>();
  let last = 0;

  for (const match of text.matchAll(HOLE)) {
    parts.push(text.slice(last, match.index));
    last = match.index + match[0].length;
    const run = match[1] !== undefined;
    const name = (run ? match[1] : match[2])!;
    if (name === "_") {
      values.push(run ? any() : exactly(1, any()));
      continue;
    }
    let handle = handles.get(name);
    if (!handle) {
      handle = capture(name);
      handles.set(name, handle);
    }
    values.push(run ? handle : exactly(1, handle));
  }
  parts.push(text.slice(last));

  const pattern = language.pattern(options)(templateStrings(parts), ...values) as unknown as Pattern<
    RuntimeCaptures,
    unknown
  >;
  return { pattern, handles };
}

/** Fill `$name` in a replacement string with the exact captured source. */
export function buildReplacement(
  language: Language<any>,
  template: string,
  match: Match<CaptureSet, unknown>,
  handles: ReadonlyMap<string, Capture<string>>,
): SourceTemplate {
  const parts: string[] = [];
  const values: unknown[] = [];
  let last = 0;

  for (const found of template.matchAll(HOLE)) {
    parts.push(template.slice(last, found.index));
    last = found.index + found[0].length;
    const name = (found[1] ?? found[2])!;
    const handle = handles.get(name);
    const results = handle ? match.getAll(handle) : [];
    values.push(results.length === 1 ? results[0] : results.map((result) => result.text()).join(""));
  }
  parts.push(template.slice(last));

  return new CodeFragment(parts, values).toTemplate(language.id, match);
}
