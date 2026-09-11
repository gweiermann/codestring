# @codestring/codemod

A rule is a language, the files it applies to, and one function.

```ts
import { capture, code, createLanguage } from "@codestring/core";
import { createTransformer } from "@codestring/codemod";
import { javascriptAdapter } from "@codestring/javascript";

const js = createLanguage(javascriptAdapter);
const arg = capture("arg");

export const renameLogger = createTransformer({
  name: "console.log → logger.debug",
  language: js,
  fileGlob: "**/*.js",
  transform: ({ file, source }) =>
    source.replaceAll(code`console.log(${arg})`, code`logger.debug(${arg})`),
});

renameLogger.transformString("console.log(  'a', b  );", "src/a.js");   // → "logger.debug('a', b);"
await renameLogger.transformFiles(["src/"], { write: true });
```

`transform` is handed the file it came from and the parsed source, and hands back the rewritten source — a
document, a string, or nothing at all to leave the file exactly as it was. There is no separate vocabulary for
gating, because the function already decides:

```ts
transform: ({ source }) => (source.includes(code`@generated`) ? null : rewrite(source)),
transform: ({ file, source }) => (file?.startsWith("src/") ? rewrite(source) : null),
transform: ({ source }) =>
  source.replaceAll(code`console.log(${arg})`, (match) =>
    match.get(arg).isEmpty() ? null : match.replace`logger.debug(${arg})`),
```

`verify` is the one check that stayed, because a function cannot express it cheaply — it re-reads the finished
file and refuses a rewrite that broke it:

```ts
verify: "parses",
verify: ({ after }) => after.includes("logger") || "logger is not imported here",
```

`createCodemod({ transformers })` runs several in order, each reading what the one before it produced. It
carries no language of its own: each transformer brings its own, so one codemod can sweep `.js`, `.html` and
`.vue` files in a single pass.

| | |
|---|---|
| `transformString(source, path?)` | the rewritten text, or the input unchanged |
| `transformFile(path, { write })` | `{ path, changed, before, after, written, applied }`; dry by default |
| `transformFiles(paths, { write, fileGlob })` | the same per file, walking directories |
| `appliesTo(path)` | does this rule's `fileGlob` match? |
| `transformers` | the rules a codemod is made of, each with its `name` and `globs` |

`fileGlob` uses Node's own `path.matchesGlob`, and `applied` names the transformers that actually changed a
file, so a dry run can say which rules did what.

Everything a rule does is available directly on a parsed document — this package is the packaging (naming,
globbing, verification, file walking), not the mechanism. It is the only one that touches `node:fs`;
`@codestring/core` stays free of I/O.
