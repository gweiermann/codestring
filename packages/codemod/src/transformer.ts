import { type Language, type ParsedDocument, SourceDocument } from "@codestring/core";
import { collectFiles, matchesAnyGlob, readSource, writeSource } from "./files.js";

export class TransformVerificationError extends Error {
  readonly path: string | undefined;
  readonly reason: string;

  constructor(message: string, details: { path?: string; reason: string }) {
    super(message);
    this.name = "TransformVerificationError";
    this.path = details.path;
    this.reason = details.reason;
  }
}

/** Refuse a rewrite after the fact: "parses" re-parses it, a function decides. */
export type Verifier = "parses" | ((result: { before: string; after: string; path?: string }) => boolean | string);

/** What a transform is handed: where the source came from, and the parsed source. */
export interface TransformContext<TParsed = unknown, TNode = unknown> {
  /** The file this came from, or undefined when transforming a bare string. */
  readonly file: string | undefined;
  readonly source: ParsedDocument<TParsed, TNode>;
}

/** Returning nothing leaves the file exactly as it was. */
export type TransformResult<TParsed = unknown, TNode = unknown> =
  | ParsedDocument<TParsed, TNode>
  | string
  | null
  | undefined;

export interface TransformerOptions<TParsed = any, TNode = any> {
  readonly name?: string;
  /** The language this transformer reads its files as. */
  readonly language: Language<any>;
  /** Which files it applies to. Omitted means every file it is handed. */
  readonly fileGlob?: string | readonly string[];
  /** The whole rule. Return the rewritten source, or nothing to skip the file. */
  readonly transform: (context: TransformContext<TParsed, TNode>) => TransformResult<TParsed, TNode>;
  /** Checked once per rewritten file, before the result is handed back. */
  readonly verify?: Verifier | false;
}

export interface FileResult {
  readonly path: string;
  readonly changed: boolean;
  readonly before: string;
  readonly after: string;
  readonly written: boolean;
  /** Transformers whose glob matched and which actually changed something. */
  readonly applied: readonly string[];
}

export interface RunOptions {
  readonly write?: boolean;
  /** Narrow the files further than the transformers' own globs. */
  readonly fileGlob?: string | readonly string[];
}

export interface Transformer {
  readonly name: string;
  readonly globs: readonly string[];
  /** Every transformer this one is made of; one, unless it is a codemod. */
  readonly transformers: readonly Transformer[];
  appliesTo(path: string): boolean;
  transformString(source: string, path?: string, writing?: boolean): string;
  transformFile(path: string, options?: RunOptions): Promise<FileResult>;
  transformFiles(paths: readonly string[], options?: RunOptions): Promise<FileResult[]>;
}

function toGlobs(fileGlob: string | readonly string[] | undefined): string[] {
  if (!fileGlob) return [];
  return typeof fileGlob === "string" ? [fileGlob] : [...fileGlob];
}

function verifyResult(
  options: { name: string; language: Language<any>; verify: Verifier | false | undefined },
  before: string,
  after: string,
  path?: string,
  writing = false,
): void {
  const verifier = options.verify === undefined && writing ? "parses" : options.verify;
  if (!verifier || before === after) return;

  if (verifier === "parses") {
    const wasBroken = options.language.parse(new SourceDocument(before, path)).hasErrors();
    const isBroken = options.language.parse(new SourceDocument(after, path)).hasErrors();
    if (isBroken && !wasBroken) {
      throw new TransformVerificationError(
        `${options.name} produced ${options.language.id} that no longer parses${path ? ` in ${path}` : ""}`,
        { path, reason: "the rewritten source does not parse" },
      );
    }
    return;
  }

  const verdict = verifier({ before, after, path });
  if (verdict === true) return;
  const reason = typeof verdict === "string" ? verdict : "verify() refused the result";
  throw new TransformVerificationError(
    `${options.name} refused its own output${path ? ` in ${path}` : ""}: ${reason}`,
    { path, reason },
  );
}

/**
 * One rule: a language, the files it applies to, and a function from parsed
 * source to rewritten source. Everything else — which matches, which files, how
 * many edits — is the function's business, and it skips a file by returning
 * nothing.
 */
export function createTransformer<TParsed, TNode>(options: TransformerOptions<TParsed, TNode>): Transformer {
  const name = options.name ?? `${options.language.id} transform`;
  const globs = toGlobs(options.fileGlob);
  const self: Transformer = {
    name,
    globs,
    get transformers() {
      return [self];
    },
    appliesTo: (path) => matchesAnyGlob(path, globs),

    transformString(source, path, writing = false) {
      if (path !== undefined && !self.appliesTo(path)) return source;
      const document = options.language.parse(new SourceDocument(source, path)) as ParsedDocument<TParsed, TNode>;
      const produced = options.transform({ file: path, source: document });
      if (produced == null) return source;
      const after = typeof produced === "string" ? produced : produced.text();
      verifyResult({ name, language: options.language, verify: options.verify }, source, after, path, writing);
      return after;
    },

    async transformFile(path, runOptions = {}) {
      return runFile(self, path, runOptions);
    },

    async transformFiles(paths, runOptions = {}) {
      return runFiles(self, paths, runOptions);
    },
  };
  return self;
}

export interface CodemodOptions {
  readonly name?: string;
  /** Applied in order; each one sees what the previous one produced. */
  readonly transformers: readonly Transformer[];
}

/**
 * Several transformers over the same files, applied in order — each reads what
 * the one before it produced, so a rule never has to reason about another
 * rule's edits.
 */
export function createCodemod(options: CodemodOptions): Transformer {
  const transformers = options.transformers.flatMap((entry) => entry.transformers);
  const name = options.name ?? `${transformers.length} transformers`;
  const globs = transformers.some((entry) => entry.globs.length === 0)
    ? []
    : [...new Set(transformers.flatMap((entry) => entry.globs))];

  const self: Transformer = {
    name,
    globs,
    transformers,
    appliesTo: (path) => transformers.some((entry) => entry.appliesTo(path)),

    transformString(source, path, writing = false) {
      let text = source;
      for (const entry of transformers) {
        if (path !== undefined && !entry.appliesTo(path)) continue;
        text = entry.transformString(text, path, writing);
      }
      return text;
    },

    async transformFile(path, runOptions = {}) {
      return runFile(self, path, runOptions);
    },

    async transformFiles(paths, runOptions = {}) {
      return runFiles(self, paths, runOptions);
    },
  };
  return self;
}

async function runFile(transformer: Transformer, path: string, options: RunOptions): Promise<FileResult> {
  const before = await readSource(path);
  const applied: string[] = [];
  let text = before;
  for (const entry of transformer.transformers) {
    if (!entry.appliesTo(path)) continue;
    const next = entry.transformString(text, path, Boolean(options.write));
    if (next !== text) applied.push(entry.name);
    text = next;
  }
  const changed = text !== before;
  const write = Boolean(options.write) && changed;
  if (write) await writeSource(path, text);
  return { path, changed, before, after: text, written: write, applied };
}

async function runFiles(
  transformer: Transformer,
  paths: readonly string[],
  options: RunOptions,
): Promise<FileResult[]> {
  const globs = options.fileGlob ? toGlobs(options.fileGlob) : transformer.globs;
  const files = await collectFiles(paths, globs);
  const results: FileResult[] = [];
  for (const file of files) results.push(await runFile(transformer, file, options));
  return results;
}
