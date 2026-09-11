# codestring

Structural pattern matching and source-preserving transformation for **any** language, in TypeScript.

Written in TypeScript end to end: every package ships its own declarations, the whole workspace typechecks
under `strict` plus `noUncheckedIndexedAccess`, and the types know how many times each capture can bind — so
`match.get(handle)` on a repeated capture is a compile error, not a runtime surprise.

The core knows no grammar. Small adapters wrap parsers that already exist — parse5, acorn, a hand-written Twig
parser, anything that can expose source-backed syntax nodes — and everything else (captures, repetition,
matching, edits, cross-language composition) lives in one language-agnostic core.

```ts
import { capture, code, createLanguage } from "@codestring/core";
import { twigAdapter } from "@codestring/twig";
import { htmlAdapter } from "@codestring/html";

const twig = createLanguage(twigAdapter);
const html = createLanguage(htmlAdapter);

const name = capture();
const body = capture();
const inner = capture();

const block = code`{% block ${name} %}${body}{% endblock %}`;
const template = code`<template${any()}>${inner}</template>`;

export function transform(sourceCode: string): string {
  return twig
    .parse(sourceCode)
    .replace(block, (match) => {
      // the block body, re-read as HTML
      const [found] = html.parse(match.get(body)).matchAll(template);
      return found
        ? found.replace(inner)`<sw-block name="${match.get(name)}">${inner}</sw-block>`
        : match.replace(body)`<sw-block name="${name}">${body}</sw-block>`;
    })
    .text();
}
```

Run it: `pnpm example:twig`.

## Why not a regex

A text matcher has no idea what a balanced call expression is:

| | `js.pattern\`foo(${arg})\`` against `foo(bar(1, 2))` |
|---|---|
| lazy regex | captures `bar(1, 2` — it stopped at the first `)` |
| structural | captures `bar(1, 2)` — one `CallExpression`, source range 4–13 |

The hole sits in a grammar position, so the parser decides where the capture ends.

## Install

The core has **no parser dependencies** and never will. Adapters are separate packages so you only install the
parsers you actually use:

```bash
pnpm add @codestring/core @codestring/twig      # Twig only, no parse5, no acorn
```

If you would rather have everything in one install, the umbrella package re-exports the core and all
first-party adapters:

```bash
pnpm add codestring
```

```js
import { createLanguage, capture, twigAdapter, htmlAdapter } from "codestring";
// or, to keep the tree shakeable:
import { htmlAdapter } from "codestring/html";
```

| package | what it is | dependencies |
|---|---|---|
| `@codestring/core` | patterns, matching, captures, slices, edits | none |
| `@codestring/adapter-utils` | helpers for adapter authors | none |
| `@codestring/twig` | Twig adapter | its own parser, no runtime deps |
| `@codestring/html` | HTML adapter | `parse5` |
| `@codestring/javascript` | JavaScript adapter | `acorn` |
| `@codestring/css` | CSS adapter | its own parser, no runtime deps |
| `@codestring/testing` | the adapter contract suite | `vitest` (peer) |
| `@codestring/codemod` | rewrite rules + file runners | core, `node:fs` |
| `@codestring/eslint` | ESLint rules written as patterns | core, JS adapter, `eslint` (peer) |
| `@codestring/cli` | `cs` — structural grep and rewrite | the three adapters, loaded lazily |
| `codestring` | umbrella: core + first-party adapters | all of the above |

Adapters declare `@codestring/core` as a **peer** dependency, so a project can never end up with two
copies of the core and two incompatible `SourceSlice` classes.

## One tag: `code`

There is a single way to write source with holes in it, and it is not bound to a language:

```ts
const call = code`console.log(${arg})`;
```

What it *is* depends on where it lands. First argument of `replace`, or anything asking a question — it is a
pattern, and its holes are slots. Second argument — it is replacement source, and its holes are the source
that match captured:

```ts
js.parse(file).replaceAll(code`console.log(${arg})`, code`logger.debug(${arg})`);
//                        └── pattern: arg is a hole   └── replacement: arg is what was captured
```

The same fragment can be both. A fragment compiles lazily, once per language it meets — a template literal's
`strings` array is created once per call site, so the compiled pattern is cached there and a rule in a loop
pays for compilation once.

```ts
code({ trivia: "ignore" })`console.log(${arg})`   // per-fragment policies, same as before
```

## The document is a String that reads syntax

`language.parse()` gives you the object you actually work with. It answers the questions a string answers,
except every question is asked in syntax:

```ts
const file = js.parse(sourceCode);

file.includes(code`console.log(${any()})`);   // true — and false for "console.log" inside a string literal
file.count(code`console.log(${any()})`);      // 2
file.indexOf(code`debugger;`);                // offset, or -1
file.match(code`foo(${arg})`);                // Match | null
file.matchAll(code`foo(${arg})`);             // Match[]
file.equals(code`foo(${arg})`);               // does the pattern cover the whole file?
file.nodeAt(120);                             // innermost node at an offset
```

Rewrites answer with a **new document**, so they chain and never mutate:

```ts
js.parse(sourceCode)
  .replaceAll(code`console.log(${args})`, code`logger.debug(${args})`)
  .replaceAll(code`legacyFetch(${url})`, code`fetchJson(${url})`)
  .removeAll(code`debugger;`)
  .text();
```

`replace` takes the first match and `replaceAll` takes every one, the way `String.replace` and
`String.replaceAll` do. `remove` / `removeAll`, `insertBefore` / `insertAfter` and `applyEdits` round it out,
and `edits(query, to)` hands back what a rewrite *would* do without doing it.

A nested parse keeps covering its own region as the file around it changes:

```ts
const body = twig.parse(file).match(block)!.get(blockBody);
const rewritten = html.parse(body).replaceAll(code`<b>${x}</b>`, code`<strong>${x}</strong>`);

rewritten.text();            // just the body, rewritten
rewritten.document.text;     // the whole Twig file, rewritten
```

## The types know your captures

`code` reads the values you interpolate and hands back a fragment that remembers what each hole can bind, and
that memory survives into the match. The cardinality rules below are not documentation — they are the type:

```ts
const name = capture("name");
const item = capture("item");
const maybe = capture("maybe");

const match = twig.parse(source).match(code`{% block ${name} %}${oneOrMore(item)}{% endblock %}`)!;

match.get(name);        // CaptureResult — a bare capture always binds
match.get(item);        // compile error: use getAll() for a repeated capture
match.getAll(item);     // CaptureResult[]
match.get("name");      // CaptureResult — names are checked too
match.get("nope");      // compile error: the pattern never declared "nope"

const optionalMatch = js.parse(source).match(code`foo(${optional(maybe)})`)!;
optionalMatch.get(maybe); // CaptureResult | undefined
```

| what you interpolate | `get()` | `getAll()` |
|---|---|---|
| `capture()` | `CaptureResult` | one entry |
| `exactly(1, capture())` | `CaptureResult` | one entry |
| `optional(capture())`, `between(0, 1, …)` | `CaptureResult \| undefined` | zero or one |
| `oneOf(a, b)` | `CaptureResult \| undefined` | zero or one |
| `oneOrMore`, `zeroOrMore`, `exactly(n > 1, …)`, `between(m, n > 1, …)` | **compile error** | `CaptureResult[]` |
| a capture inside an interpolated sub-pattern | inherits its own cardinality | |

The adapter's own node type flows through as well, so `result.nodes[0].raw` is the parser's node — an
`acorn.Node` for JavaScript, a `TwigNode` for Twig — not `any`:

```ts
const argument = js.parse(file).match(code`foo(${arg})`)!.get(arg);
argument.nodes[0]!.raw.type;   // acorn's own field, fully typed
```

Name your captures (`capture("body")`) when you want the strongest checking: two handles declared with
different names have different types, while two anonymous handles do not.

Utility types are exported for wrapping the library in your own helpers: `MatchOf<P>`, `CapturesOfPattern<P>`,
`NodeOfPattern<P>`, `LanguageNodeOf<L>`, `AdapterNodeOf<A>`, `ParsedOf<A>`, `CaptureSet`, `CapturesOf<V>`.

Everything here is covered by type-level tests (`pnpm test:types`), so a regression in inference fails CI the
same way a wrong offset does.

## Pattern semantics

These are decided and tested, not implied.

**Capture handles are declared up front** and hold no state. A handle can be used by several patterns and
matched concurrently; the results live on the `Match`.

```ts
const name = capture();          // an anonymous handle
const body = capture("body");    // the name is for diagnostics and the CLI, never required
match.get(name);                 // one result, or undefined if it did not participate
match.getAll(name);              // every result; get() throws when there is more than one
```

**A hole's shape is inferred from where it lands in the parsed pattern**, and `pattern.debug()` prints what
was inferred:

| position | meaning |
|---|---|
| a container the adapter calls variadic (a body, an argument list, element content) | a run of `0..∞` siblings, captured as **one** slice |
| anywhere else | exactly one node |
| `oneOrMore(x)` / `zeroOrMore(x)` / `optional(x)` / `exactly(n, x)` / `between(min, max, x)` | that many siblings, **one result each** |

`any()` matches the same structural slot as `capture()` and discards it. `oneOf(a, b)` takes the first
alternative that fits. Repetition is greedy over siblings and backtracks only inside that one sibling list —
never across the tree.

**A hole must land on a syntax boundary.** `` twig.pattern`before ${x} after` `` is a compile error, because
the Twig parser folds the whole run into one text node and the hole would silently never match. Put it where
the grammar expects a node of its own.

**Trivia policies** (`code({ trivia })`):

- `whitespace-flexible` (default) — whitespace and separators are ignored, comments are significant
- `ignore` — whitespace, separators and comments are all ignored
- `exact` — trivia must match literally

A **separator** is punctuation that holds a list together — a CSS `;` between declarations, a JavaScript `,`
between arguments, the `;` that terminates a statement. Adapters mark it as trivia of its own, which buys two
things: a pattern does not have to spell it out (`code\`.a { color: red }\`` matches a rule whose last
declaration ends in a semicolon, and the reverse), and a match stays tight, so rewriting `const a = 1` gives
`const a = 9;` rather than eating the terminator.

Removing is the other half. `remove` on a list element takes **one adjacent separator** with it — the one
after it, or the one before it when the element is last:

```ts
js.parse("foo(a, b)")   → remove b   → "foo(a)"
js.parse("[x, y]")      → remove x   → "[ y]"
css.parse(".a { color: red; margin: 0 }") → remove margin → ".a { color: red }"
```

The separator is a range the library chose rather than one you named, so when two removals want the same one
it is simply dropped from the second rather than failing — the only place an overlap resolves silently, and
only ever for a range nobody asked for. Whitespace left behind is not tidied: `[ y]` keeps its space, because
formatting is not ours to change.

**Parse-error policies** (`{ onParseError }`):

- `allow-outside-errors` (default) — match only where the range misses every error node
- `allow-recovery` — match the recovered tree
- `reject` — refuse to match a file with syntax errors

**Anchoring** is explicit: `document.match(code)` is the first match in source order, `document.matchAll(code)`
is all of them (start ascending, outermost first for equal starts), and `document.equals(code)` is true only
when the pattern covers the whole region.

## Rules, not scripts

A rule is a language, the files it applies to, and one function from parsed source to rewritten source.
There is no `from`/`to`/`where`/`whereFile` vocabulary to learn — the function decides everything, and returns
nothing to leave the file alone:

```ts
import { capture, code, createLanguage } from "@codestring/core";
import { createTransformer } from "@codestring/codemod";

const js = createLanguage(javascriptAdapter);
const arg = capture("arg");

export const renameLogger = createTransformer({
  name: "console.log → logger.debug",
  language: js,
  fileGlob: "**/*.js",
  transform: ({ file, source }) =>
    source.replaceAll(code`console.log(${arg})`, code`logger.debug(${arg})`),
});

renameLogger.transformString("console.log(  'a', b  );", "src/a.js");    // → "logger.debug('a', b);"
await renameLogger.transformFiles(["src/"], { write: true });
```

Everything the old option bag did, the function does with less ceremony:

```ts
transform: ({ source }) => (source.includes(code`@generated`) ? null : rewrite(source)),        // skip a file
transform: ({ file, source }) => (file?.startsWith("src/") ? rewrite(source) : null),           // gate by path
transform: ({ source }) =>                                                                     // gate a match
  source.replaceAll(code`console.log(${arg})`, (match) =>
    match.get(arg).isEmpty() ? null : match.replace`logger.debug(${arg})`),
transform: ({ source }) => source.replaceAll(a, b).removeAll(c),                               // as many as you like
```

`verify` is the one check that stayed, because a function cannot express it cheaply: it re-reads the finished
file and refuses a rewrite that broke it.

```ts
verify: "parses",
verify: ({ after }) => after.includes("logger") || "logger is not imported here",
```

`createCodemod({ transformers })` runs several in order, each reading what the one before it produced. It
carries no language of its own — each transformer brings its own, so one codemod can sweep `.js`, `.html` and
`.vue` files in a single pass and each file is read by whatever knows how to read it.

```ts
const migrate = createCodemod({ name: "v2 migration", transformers: [renameLogger, renameMarkup, migrateVue] });
await migrate.transformFiles(["src/"], { write: true });
```

## Languages inside languages

A `.vue` file is HTML with JavaScript in one element and CSS in another. `inside()` re-reads a captured region
with another language, rewrites it there, and splices the result back — in one pass, so several embedded
regions can be rewritten without their offsets drifting:

```ts
createTransformer({
  name: "vue: markup, script and style",
  language: html,
  fileGlob: "**/*.vue",
  transform: ({ source }) =>
    source
      // the markup itself, in the language of the file
      .replaceAll(code`<b>${bold}</b>`, code`<strong>${bold}</strong>`)
      // the <script> block, read as JavaScript
      .inside(
        (block) => code`<script${any()}>${block}</script>`,
        js,
        (script) =>
          script
            .replaceAll(code`console.log(${args})`, code`logger.debug(${args})`)
            .removeAll(code`debugger;`),
      )
      // the <style> block, read as CSS
      .inside(
        (block) => code`<style${any()}>${block}</style>`,
        css,
        (style) => style.replaceAll(code`color: red`, code`color: var(--text)`),
      ),
});
```

The first argument is handed the capture that stands for the region, so the pattern and the handle can never
disagree about which hole holds the embedded source — and a pattern that ignores it is refused rather than
silently matching nothing.

`pnpm example:vue` runs it. Three parsers touch one file and none of them sees another's syntax: the HTML
parser never reads the JavaScript, the JavaScript parser never reads the CSS, and the Vue interpolations
(`{{ product.price }}`, `:class="{ active: isActive }"`) survive untouched because nothing claimed them.

Nesting is not limited to two levels — `inside()` returns a document like any other, so an embedded region can
have its own embedded regions, and the rewrite is handed the outer match too when it needs something from it.

This is also why the adapters stay single-grammar: the Twig adapter knows nothing about HTML and the HTML
adapter knows nothing about CSS or JavaScript. Embedding lives in one composition primitive in the core,
which means a new host language costs one adapter, not one adapter per pair.

**Where the boundary actually falls is the host's decision, not ours.** `<script>` and `<style>` are raw text
elements: the HTML tokenizer ends them at the first `</script>` / `</style>` regardless of what the embedded
language thinks it is in the middle of, so

```html
<script>const foo = "bar</script>"; </script>
```

gives a script body of `const foo = "bar` — exactly what a browser would run, and a real bug in that file
rather than a parsing shortcoming. The truncated region does not parse as JavaScript, and under the default
`allow-outside-errors` policy no match may touch a broken region, so nothing is rewritten there and the file
comes back byte for byte. Escape the sequence (`"bar<\/script>"`), as bundlers do, and the region parses and
rewrites normally.

## Editing from a match

Inside a match, the edit constructors are tagged templates that already know what was captured — no `.get()`
and no separate `source` tag:

```ts
match.replace`logger.debug(${arg})`          // rewrite the whole match
match.replace(body)`<sw-block>${body}</sw-block>`   // rewrite one capture
match.insertBefore`// generated\n`
match.remove()                               // or match.remove(handle)
```

Interpolating a handle inserts the exact source that handle bound in **this** match. Interpolating a handle the
pattern never declared is a compile error.

## Transforms are values

```ts
const edits = [wrapWithSwBlock(body, name)];
if (legacyAttribute) edits.push(remove(legacyAttribute));
if (annotate) edits.push(insertBefore(body, twig.source`{# generated #}\n`));

return match.transform(edits);
```

`replace`, `remove`, `insertBefore` and `insertAfter` return plain objects, so a rule is an ordinary function
that returns an edit and a conditional rewrite is an `if` and a `push`. `transform` validates the whole list
once and applies it; `applyEdits(document, edits)` does the same for edits gathered from many matches.

Guaranteed:

- every byte outside an edit range is unchanged — no printer is involved anywhere
- an interpolated slice keeps its exact source
- edits from a nested match target the **root** document
- `transform()` never mutates the match

Refused, loudly:

- partially overlapping or nested edits (`OverlappingEditError`)
- one transform mixing two documents (`SourceRevisionError`)
- one capture handle in two positions of the same pattern (`PatternCompileError`)
- a repetition that could match nothing (`PatternCompileError`)

An insert at the edge of a replaced range is allowed, whichever order the two were listed in. Several inserts
at one position apply in the order you listed them.

## Cross-language composition

A capture is a range in the original document, so handing it to another language is the same pipeline again:

```ts
const body = twig.parse(file).match(block)!.get(blockBody);   // offsets 19..48 in the Twig file
const html = html.parse(body);                                // parsed as HTML, offsets unchanged
html.match(template)!.get(inner).start;                       // 29 — still the Twig file
html.replaceAll(template, ...).document.text;                 // the whole Twig file, rewritten
```

Nesting depth is unbounded: Twig → HTML → JavaScript in a `<script>` → a SQL string works mechanically,
if the adapters involved can parse the fragment they are given.

## ESLint rules as patterns

An ESLint rule is usually a visitor, some `node.parent` walking, and fixer arithmetic. Most of them are really
"this shape is wrong, that shape is right":

```ts
import { capture, code } from "@codestring/core";
import { createRule } from "@codestring/eslint";

const args = capture("args");

export const noConsoleLog = createRule({
  meta: { type: "suggestion", fixable: "code", messages: { useLogger: "Use logger.debug instead." } },
  find: code`console.log(${args})`,
  messageId: "useLogger",
  fix: (match) => match.replace`logger.debug(${args})`,
});
```

`console.log(   'a', b   )` becomes `logger.debug('a', b)` — the arguments keep their own spelling, because
the fix inserts the source they were written with rather than printing them again.

It runs on the AST **ESLint already built**, so nothing is parsed twice, and since the tree is read
structurally rather than by node type, whatever parser ESLint was configured with comes along. `fix` returns
edit values that go through the same validation a codemod does, so a rule cannot emit two fixes that overlap,
and `match.remove()` takes the statement's separator with it.

`where`, `data`, `report` and `suggest` cover narrowing, message placeholders, pointing at one capture, and
offering the fix as a suggestion instead. For anything that needs scope, types or control flow, write the
visitor — `eslintLanguage(sourceCode)` is exported so a hand-written rule can still ask structural questions.

## Command line

```bash
cs find    -l twig       -p '{% block $name %}$$$body{% endblock %}' templates/
cs find    -l javascript -p 'console.log($$$args)' src/ --json
cs replace -l javascript -p 'foo($x)' -r 'bar($x)' --write src/
cs debug   -l javascript -p 'foo($x)'
cs languages
```

`$name` is one node, `$$$name` is a run of siblings, `$_` and `$$$_` are the same without capturing. In a
replacement, `$name` inserts the captured source verbatim. With no paths, `cs` reads stdin. `--adapter
./my-adapter.js` loads any adapter you wrote yourself, so the CLI works with languages that ship nowhere near
this repository.

In this workspace: `pnpm cs find -l twig -p '...' examples/`.

## Writing an adapter

An adapter normalizes five things and implements no matching at all. `defineAdapter` infers your parser's own
types, so every callback is checked against them and `NodeRef.raw` reaches users fully typed:

```ts
import { defineAdapter } from "@codestring/core";

export const myAdapter = defineAdapter<MyParsed, MyNode>({
  id: "mylang",
  parse(source, options) { /* → whatever your parser returns */ },
  root(parsed) { return parsed.root; },
  kind(node) { return node.type; },           // a stable string per node type
  range(node) { return node.span; },          // { start, end } in UTF-16 code units
  children(node) { return node.kids; },       // source order, contained in the parent

  diagnostics(parsed) { return parsed.errors; },  // optional: [{ message, severity, range }]
  triviaClass(node) { return null; },             // optional: "whitespace" | "comment" | null
  isErrorNode(node) { return node.broken; },      // optional
  isVariadic(kind) { return kind === "block"; },  // optional: unbounded child list?
  isPatternWrapper(kind) { return false; },       // optional: a wrapper a pattern should see through
  placeholder(index, context) { return context.fallback; },  // optional: parser-valid hole text
  detectPlaceholder(node, text) { return null; },            // optional: which nodes may be holes
});
```

`LanguageAdapter<TParsed, TNode, TToken>` is exported too if you would rather write the annotation yourself.
Then run the compliance suite:

```ts
import { runAdapterContractSuite } from "@codestring/testing";

runAdapterContractSuite(myAdapter, {
  valid: ["…"],
  malformed: ["…"],
  unicode: ["🎉"],
  placeholderContexts: [{ before: "call(", after: ")" }],
});
```

It checks ranges, ordering, containment, UTF-16 offsets, trivia classes, malformed input and placeholder
round-tripping — around 90 cases per adapter. If an adapter ever needs its own matcher, the abstraction has
failed.

## Not in v1

No universal AST, no type or symbol analysis, no formatting or AST printing, no import management, no
cross-file refactoring, no query language separate from JavaScript, no parser hosting.

Known open questions, all with a current answer in the code and a test pinning it:

- what `match.getAll` should return for a capture under `oneOrMore` (today: one result per iteration)
- whether `remove()` should take the separating comma or newline with it (today: it does not)
- whether `language.source` should validate what it builds (today: it does not parse at all)
- `match()` vs `find()` naming
- comments in the JavaScript adapter are trivia nodes, but comment *attachment* is not modelled

## Development

```bash
pnpm install
pnpm check           # typecheck the whole workspace, then run every test
pnpm typecheck       # tsc over packages, tests, examples and scripts
pnpm test            # 723 tests: 703 runtime + 20 type-level
pnpm test:types      # only the type-level assertions
pnpm build           # tsc per package, in dependency order, into dist/
pnpm bench           # parse / match / transform at 1 KB, 100 KB and 1 MB
pnpm example:twig    # the Twig → HTML migration, before and after
pnpm example:js      # a three-rule JavaScript codemod
pnpm example:vue     # one .vue file rewritten as HTML, JavaScript and CSS
```

Tests run straight from the sources — vitest resolves `@codestring/*` to `packages/*/src`, so no build
stands between an edit and a test run. `pnpm build` is only needed for the examples, the CLI binary and
publishing. Examples and scripts run on Node's own type stripping, with no bundler anywhere.

Compiler settings: `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `isolatedModules`,
`noImplicitReturns`, `noUnusedLocals`/`noUnusedParameters`, `NodeNext` modules, declarations and source maps.

Layout:

```
packages/core            the language-agnostic matcher, no parser dependencies
packages/adapter-utils   trivia splitting, expression tokenizing, placeholder padding
packages/testing         the adapter contract suite
packages/codemod         rewrite rules and the file runners
packages/eslint          ESLint rules as patterns, over ESLint's own AST
packages/twig            Twig adapter + its own parser
packages/html            HTML adapter (parse5)
packages/javascript      JavaScript adapter (acorn)
packages/css             CSS adapter + its own parser
packages/umbrella        the `codestring` convenience package
packages/cli             the `cs` binary
examples/                three runnable end-to-end codemods, including nested languages
```

Every package publishes `dist/` (ESM + `.d.ts` + source maps) and ships `src/` alongside it, so a stack trace
or a go-to-definition lands on real TypeScript.
