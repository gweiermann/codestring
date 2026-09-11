import { capture, code, createLanguage } from "@codestring/core";
import { createCodemod, createTransformer } from "@codestring/codemod";
import { javascriptAdapter } from "@codestring/javascript";

const js = createLanguage(javascriptAdapter);

const logArguments = capture("logArguments");
const legacyArgument = capture("legacyArgument");

/** A rule is a language, the files it applies to, and one function. */
export const renameLogger = createTransformer({
  name: "console.log → logger.debug",
  language: js,
  fileGlob: "**/*.js",
  transform: ({ source }) =>
    source.replaceAll(code`console.log(${logArguments})`, (match) =>
      match.get(logArguments).isEmpty() ? null : match.replace`logger.debug(${logArguments})`,
    ),
});

/** Two edits per call site, decided inside the same function. */
export const renameFetch = createTransformer({
  name: "legacyFetch → fetchJson",
  language: js,
  fileGlob: "**/*.js",
  transform: ({ source }) =>
    source.replaceAll(code`legacyFetch(${legacyArgument})`, (match) => [
      match.replace`fetchJson(${legacyArgument})`,
      match.insertBefore`/* migrated */ `,
    ]),
});

export const dropDebugger = createTransformer({
  name: "drop debugger statements",
  language: js,
  fileGlob: "**/*.js",
  transform: ({ source }) => source.removeAll(code`debugger;`),
  verify: "parses",
});

/** All three over the same files, in order: each reads what the last produced. */
export const codemod = createCodemod({
  name: "service migration",
  transformers: [renameLogger, renameFetch, dropDebugger],
});

export function transform(sourceCode: string, path = "input.js"): string {
  return codemod.transformString(sourceCode, path);
}

/** The same three rewrites without the packaging, straight on the document. */
export function transformInline(sourceCode: string): string {
  return js
    .parse(sourceCode)
    .replaceAll(code`console.log(${logArguments})`, code`logger.debug(${logArguments})`)
    .replaceAll(code`legacyFetch(${legacyArgument})`, code`fetchJson(${legacyArgument})`)
    .removeAll(code`debugger;`)
    .text();
}

/** What each rule would touch, without touching it. */
export function report(sourceCode: string): Record<string, number> {
  const document = js.parse(sourceCode);
  return {
    "console.log → logger.debug": document.count(code`console.log(${logArguments})`),
    "legacyFetch → fetchJson": document.count(code`legacyFetch(${legacyArgument})`),
    "drop debugger statements": document.count(code`debugger;`),
  };
}
