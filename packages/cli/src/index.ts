import { writeFile } from "node:fs/promises";
import { relative } from "node:path";
import {
  type CaptureSet,
  type Capture,
  type Match,
  type ParseErrorPolicy,
  type TriviaPolicy,
  SourceDocument,
  applyEdits,
  replace,
} from "@codestring/core";
import { buildReplacement, compileCliPattern } from "./patterns.js";
import { collectFiles, readSource, readStdin } from "./files.js";
import { defaultExtensions, loadLanguage } from "./languages.js";

export { buildReplacement, compileCliPattern } from "./patterns.js";
export { collectFiles, readSource, readStdin } from "./files.js";
export { defaultExtensions, languageIds, loadLanguage } from "./languages.js";
export type { CompiledCliPattern, RuntimeCaptures } from "./patterns.js";

export interface CliOptions {
  readonly language: string;
  readonly pattern: string;
  readonly replacement?: string;
  readonly paths: readonly string[];
  readonly adapterModule?: string;
  readonly extensions?: readonly string[];
  readonly trivia?: TriviaPolicy;
  readonly onParseError?: ParseErrorPolicy;
  readonly write?: boolean;
}

export interface Finding {
  readonly path: string;
  readonly line?: number;
  readonly column?: number;
  readonly start?: number;
  readonly end?: number;
  readonly text?: string;
  readonly captures?: Record<string, string | string[]>;
  readonly error?: string;
}

export interface Change {
  readonly path: string;
  readonly before: string;
  readonly after: string;
  readonly count: number;
}

interface Input {
  readonly path: string;
  readonly text: string;
}

async function inputs(options: CliOptions): Promise<Input[]> {
  if (options.paths.length === 0) {
    return [{ path: "<stdin>", text: await readStdin() }];
  }
  const files = await collectFiles(options.paths, options.extensions ?? defaultExtensions(options.language));
  return Promise.all(files.map(async (path) => ({ path, text: await readSource(path) })));
}

function captureSummary(
  match: Match<CaptureSet, unknown>,
  handles: ReadonlyMap<string, Capture<string>>,
): Record<string, string | string[]> {
  const summary: Record<string, string | string[]> = {};
  for (const [name, handle] of handles) {
    const results = match.getAll(handle);
    if (results.length === 1) summary[name] = results[0]!.text();
    else if (results.length > 1) summary[name] = results.map((result) => result.text());
  }
  return summary;
}

function documentFor(input: Input): SourceDocument {
  return new SourceDocument(input.text, input.path === "<stdin>" ? input.path : relative(process.cwd(), input.path));
}

export async function find(options: CliOptions): Promise<Finding[]> {
  const language = await loadLanguage(options.language, { adapterModule: options.adapterModule });
  const { pattern, handles } = compileCliPattern(language, options.pattern, {
    trivia: options.trivia,
    onParseError: options.onParseError,
  });
  const found: Finding[] = [];

  for (const input of await inputs(options)) {
    const document = documentFor(input);
    let matches;
    try {
      matches = pattern.findAll(document);
    } catch (error) {
      found.push({ path: input.path, error: (error as Error).message });
      continue;
    }
    for (const match of matches) {
      const { line, column } = match.position();
      found.push({
        path: document.id!,
        line,
        column,
        start: match.start,
        end: match.end,
        text: match.text(),
        captures: captureSummary(match, handles),
      });
    }
  }
  return found;
}

export async function rewrite(options: CliOptions): Promise<Change[]> {
  if (!options.replacement) throw new Error("rewrite() needs a replacement");
  const language = await loadLanguage(options.language, { adapterModule: options.adapterModule });
  const { pattern, handles } = compileCliPattern(language, options.pattern, {
    trivia: options.trivia,
    onParseError: options.onParseError,
  });
  const changes: Change[] = [];

  for (const input of await inputs(options)) {
    const document = documentFor(input);
    const matches = pattern.findAll(document);
    if (matches.length === 0) continue;

    const edits = matches.map((match) =>
      replace(match, buildReplacement(language, options.replacement!, match, handles)),
    );
    const after = applyEdits(document, edits);
    if (after === input.text) continue;
    changes.push({ path: input.path, before: input.text, after, count: matches.length });
    if (options.write && input.path !== "<stdin>") await writeFile(input.path, after, "utf8");
  }
  return changes;
}
