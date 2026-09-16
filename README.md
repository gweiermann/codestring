# codestring

**Structural pattern matching and source-preserving rewriting for any language, in TypeScript.**

📖 **[Documentation](https://gweiermann.github.io/codestring/)** — teaser, tutorial, API reference, adapter guide.

> ### ⚠️ Experimental, and not actively maintained
>
> This started as an experiment: *what if structural matching felt like `String.prototype`?* It went further
> than expected — 13 packages, 950+ tests, a real migration of a large Vue/Twig codebase — but it is a
> spike, not a product. There is no release cadence, no support, and no promise the API stays still.
>
> **If you want to take it over, please do.** Fork it, rename it, publish it. Open an issue and I will
> happily hand over the repository or point people at yours. 🙂

---

## The one-minute version

You know what a string can do. `includes`, `indexOf`, `replace`, `replaceAll`, `split`. Now do all of it
without a regex ever being wrong about your syntax:

```ts
import { any, capture, code, createLanguage } from "@codestring/core";
import { javascriptAdapter } from "@codestring/javascript";

const js = createLanguage(javascriptAdapter);
const file = js.parse(source);

file.includes(code`console.log(${any()})`);   // true — but false for "console.log(" inside a string
file.count(code`debugger;`);                  // 2
file.indexOf(code`foo(${any()})`);            // a source offset, or -1
```

The difference shows up the moment a match is not flat:

```ts
const arg = capture("arg");

js.parse("foo(bar(1, 2))").match(code`foo(${arg})`)!.get(arg).text();
//  →  "bar(1, 2)"
//  a lazy regex gives you "bar(1, 2" — it stopped at the first `)`
```

Rewrites answer with a **new document**, so they chain and never mutate, and every byte outside an edit
range comes through untouched — there is no printer anywhere in this library:

```ts
js.parse(source)
  .replaceAll(code`console.log(${arg})`, code`logger.debug(${arg})`)
  .replaceAll(code`legacyFetch(${url})`, code`fetchJson(${url})`)
  .removeAll(code`debugger;`)
  .text();
```

```diff
- console.log(  'a',    b  );
+ logger.debug('a',    b);
```

The arguments come through exactly as written — quote style, spacing between them, a comment in the middle —
because the rewrite inserts the source they were *written* with rather than printing them again. Only the
padding at the capture's own edges is dropped, because the capture binds nodes, not the whitespace around
them.

**The core knows no grammar.** Small adapters wrap parsers that already exist — acorn, Babel,
`@vue/compiler-dom`, parse5, a hand-written Twig parser — and everything else lives in one
language-agnostic core. An adapter normalizes five things and implements no matching at all.

---

## Install

The core has **no parser dependencies** and never will. Adapters are separate packages, so you only install
the parsers you actually use:

```bash
pnpm add @codestring/core @codestring/twig      # Twig only — no parse5, no acorn, no Babel
```

Or take everything in one install:

```bash
pnpm add codestring
```

```ts
import { createLanguage, capture, code, twigAdapter } from "codestring";
import { vueAdapter } from "codestring/vue";   // subpath imports stay tree-shakeable
```

| package | what it is | dependencies |
|---|---|---|
| `@codestring/core` | patterns, matching, captures, slices, edits | none |
| `@codestring/adapter-utils` | helpers for adapter authors | none |
| `@codestring/testing` | the adapter contract suite | `vitest` (peer) |
| `@codestring/codemod` | rewrite rules + file runners | core, `node:fs` |
| `@codestring/eslint` | ESLint rules written as patterns | core, JS adapter, `eslint` (peer) |
| `@codestring/cli` | `cs` — structural grep and rewrite | adapters, loaded lazily |
| `@codestring/javascript` | JavaScript adapter | `acorn` |
| `@codestring/babel` | TypeScript / JSX / decorators adapter | `@babel/parser` |
| `@codestring/vue` | Vue SFC template adapter | `@vue/compiler-dom` |
| `@codestring/html` | HTML adapter | `parse5` |
| `@codestring/twig` | Twig adapter | its own parser, no runtime deps |
| `@codestring/css` | CSS adapter | its own parser, no runtime deps |
| `codestring` | umbrella: core + every first-party adapter | all of the above |

Adapters declare `@codestring/core` as a **peer** dependency, so a project can never end up with two copies
of the core and two incompatible `SourceSlice` classes.

---

## One tag: `code`

There is a single way to write source with holes in it, and it is not bound to a language:

```ts
const call = code`console.log(${arg})`;
```

What it *is* depends on where it lands. As the first argument of `replace`, or anywhere a question is being
asked, it is a **pattern** and its holes are slots. As the second argument it is **replacement source** and
its holes are the source the match captured:

```ts
js.parse(file).replaceAll(code`console.log(${arg})`, code`logger.debug(${arg})`);
//                        └── pattern: arg is a hole  └── replacement: arg is what was captured
```

A fragment compiles lazily, once per language it meets. A template literal's `strings` array is created once
per call site, so the compiled pattern is cached there and a rule inside a loop pays for compilation once.

---

## The document is a String that reads syntax

`language.parse()` gives you the object you actually work with. It answers the questions a string answers,
except every question is asked in syntax:

```ts
const file = js.parse(source);

file.includes(code`console.log(${any()})`);   // boolean
file.count(code`console.log(${any()})`);      // number
file.indexOf(code`debugger;`);                // offset, or -1
file.lastIndexOf(code`debugger;`);            // offset, or -1
file.match(code`foo(${arg})`);                // Match | null
file.matchAll(code`foo(${arg})`);             // Match[]
file.equals(code`foo(${arg})`);               // does the pattern cover the whole document?
file.nodeAt(120);                             // the innermost node at an offset
file.explain(code`foo(${arg})`);              // why it did not match, in words
```

Rewriting is the same vocabulary:

```ts
file.replace(a, b);          // the first match, like String.replace
file.replaceAll(a, b);       // every match, like String.replaceAll
file.remove(a);              // and removeAll
file.insertBefore(a, text);  // and insertAfter
file.applyEdits(edits);      // a list you built yourself
file.edits(a, b);            // what a rewrite *would* do, without doing it
```

### A node answers the same questions

The same surface is on every node, so you can scope a question to one subtree without slicing text out of
its context:

```ts
const method = file.nodes().find((node) => node.kind === "FunctionExpression")!;

method.includes(code`this`);    // is there a `this` in *this* function?
method.matchAll(code`await ${any()}`);
method.count(code`return ${any()}`);
```

This searches the tree the node already belongs to. Handing `node.text()` to a pattern instead would
re-parse that text on its own, where it can mean something else entirely — `{ methods: {} }` is an object
literal inside a file and a block statement standing alone.

---

## The types know your captures

`code` reads the values you interpolate and hands back a fragment that remembers what each hole can bind.
The cardinality rules below are not documentation — they are the type:

```ts
const name = capture("name");
const item = capture("item");

const match = twig.parse(source).match(code`{% block ${name} %}${oneOrMore(item)}{% endblock %}`)!;

match.get(name);        // CaptureResult — a bare capture always binds
match.get(item);        // compile error: use getAll() for a repeated capture
match.getAll(item);     // CaptureResult[]
match.get("nope");      // compile error: the pattern never declared "nope"
```

| what you interpolate | `get()` | `getAll()` |
|---|---|---|
| `capture()`, `exactly(1, …)` | `CaptureResult` | one entry |
| `optional(…)`, `between(0, 1, …)`, `oneOf(a, b)` | `CaptureResult \| undefined` | zero or one |
| `oneOrMore`, `zeroOrMore`, `exactly(n > 1, …)` | **compile error** | `CaptureResult[]` |

The adapter's own node type flows through too, so `result.nodes[0].raw` is the parser's node — an
`acorn.Node`, a `TwigNode`, a `VueNode` — not `any`. Type-level tests (`pnpm test:types`) fail CI on an
inference regression the same way a wrong offset does.

---

## Codemods: rules, not scripts

A rule is a language, the files it applies to, and one function from parsed source to rewritten source.
There is no `from`/`to`/`where`/`whereFile` vocabulary to learn — the function decides everything, and
returns nothing to leave the file alone.

```ts
import { capture, code, createLanguage } from "@codestring/core";
import { javascriptAdapter } from "@codestring/javascript";
import { createTransformer } from "@codestring/codemod";

const js = createLanguage(javascriptAdapter);
const arg = capture("arg");

export const renameLogger = createTransformer({
  name: "console.log → logger.debug",
  language: js,
  fileGlob: "**/*.js",
  transform: ({ file, source }) => source.replaceAll(code`console.log(${arg})`, code`logger.debug(${arg})`),
});

renameLogger.transformString("console.log(  'a', b  );");   // → "logger.debug('a', b);"
await renameLogger.transformFiles(["src/"], { write: true });
```

Everything an option bag would do, the function does with less ceremony:

```ts
// skip a file
transform: ({ source }) => (source.includes(code`@generated`) ? null : rewrite(source)),

// gate by path
transform: ({ file, source }) => (file?.startsWith("src/") ? rewrite(source) : null),

// gate one match, not the file
transform: ({ source }) =>
  source.replaceAll(code`console.log(${arg})`, (match) =>
    match.get(arg).isEmpty() ? null : match.replace`logger.debug(${arg})`),

// as many rewrites as you like, each reading the last
transform: ({ source }) => source.replaceAll(a, b).removeAll(c),
```

### `verify` — refuse your own output

The one check a transform function cannot express cheaply: re-read the finished file and reject a rewrite
that broke it. It runs once per changed file, and is **on by default** (`"parses"`) when writing to disk.

```ts
verify: "parses",
verify: ({ before, after, path }) => after.includes("logger") || "logger is not imported here",
verify: false,        // opt out
```

A refusal throws `TransformVerificationError` carrying `path` and `reason`, so a runner can report which
file was refused and why instead of writing something broken.

### `createCodemod` — several rules, one sweep

```ts
import { createCodemod } from "@codestring/codemod";

const migrate = createCodemod({
  name: "v2 migration",
  transformers: [renameLogger, renameMarkup, migrateVueTemplates],
});

const results = await migrate.transformFiles(["src/"], { write: true });
```

A codemod **carries no language of its own**. Each transformer brings one, so a single sweep can read `.js`
with the JavaScript adapter, `.html` with parse5 and `.vue` with `@vue/compiler-dom`, and every file is read
by whatever knows how to read it. Transformers run in order, each reading what the one before produced.

Each `FileResult` reports `{ path, changed, before, after, written, applied }`, where `applied` names the
transformers whose glob matched *and* which actually changed something — so a dry run (`write: false`) tells
you exactly what a real run would touch.

### Languages inside languages

A `.vue` file is HTML with JavaScript in one element and CSS in another. `inside()` re-reads a captured
region with another language, rewrites it there, and splices the result back — in one pass, so several
embedded regions can be rewritten without their offsets drifting:

```ts
createTransformer({
  name: "vue: markup, script and style",
  language: html,
  fileGlob: "**/*.vue",
  transform: ({ source }) =>
    source
      .replaceAll(code`<b>${x}</b>`, code`<strong>${x}</strong>`)
      .inside((block) => code`<script>${block}</script>`, js, (script) =>
        script.replaceAll(code`console.log(${arg})`, code`logger.debug(${arg})`))
      .inside((block) => code`<style>${block}</style>`, css, (style) =>
        style.replaceAll(code`color: red`, code`color: var(--danger)`)),
});
```

The first argument is handed the capture that stands for the region, so the pattern and the handle can never
disagree about which hole holds it. Nesting depth is unbounded, and a nested match's edits still target the
**root** document.

---

## ESLint rules as patterns

An ESLint rule is usually a visitor, some `node.parent` walking and fixer arithmetic. Most of them are really
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

`console.log(   'a', b   )` becomes `logger.debug('a', b)` — the arguments keep their own spelling.

It runs on the AST **ESLint already built**, so nothing is parsed twice, and because the tree is read
structurally rather than by node type, whatever parser ESLint was configured with comes along —
`@typescript-eslint/parser` included.

The full option set:

| option | what it does |
|---|---|
| `find` | the pattern — the only required option |
| `where` | narrow further than a pattern can say, e.g. by what a capture bound |
| `message` / `messageId` / `data` | the report text, or a `meta.messages` key plus its placeholders |
| `report` | point at one capture instead of the whole match |
| `fix` | return an edit, a list of edits, or replacement text |
| `suggest` | offer the fix as a suggestion rather than applying it automatically |
| `language` | read the file as something else — a Vue or Twig template rather than the script |
| `meta` | ESLint's own `meta`, passed through untouched |

```ts
createRule({
  find: code`t(${key})`,
  where: (match) => match.get(key).text().startsWith("'legacy."),
  report: (match) => match.get(key),                       // squiggle just the key
  message: "Legacy translation key.",
  suggest: "Drop the legacy prefix",
  fix: (match) => match.replace(key)`'${stripped(match)}'`,
});
```

Fixes go through the same validation a codemod does, so a rule cannot emit two fixes that overlap, and
`match.remove()` takes the statement's separator with it rather than stranding a comma.

For anything needing scope, types or control flow, write the visitor — `eslintLanguage(sourceCode)` is
exported so a hand-written rule can still ask structural questions of the tree ESLint gave it.

---

## Editing from a match

Inside a match, the edit constructors are tagged templates that already know what was captured:

```ts
match.replace`logger.debug(${arg})`                  // rewrite the whole match
match.replace(body)`<sw-block>${body}</sw-block>`    // rewrite one capture
match.insertBefore`// generated\n`
match.remove()                                       // or match.remove(handle)
```

They return plain edit objects, so a conditional rewrite is an `if` and a `push`:

```ts
const edits = [wrapWithSwBlock(body, name)];
if (legacyAttribute) edits.push(remove(legacyAttribute));
return match.transform(edits);
```

**Guaranteed:** every byte outside an edit range is unchanged; an interpolated slice keeps its exact source;
edits from a nested match target the root document; `transform()` never mutates the match.

**Refused, loudly:** partially overlapping edits (`OverlappingEditError`), one transform mixing two documents
(`SourceRevisionError`), one capture handle in two positions of the same pattern (`PatternCompileError`), a
repetition that could match nothing (`PatternCompileError`).

---

## Command line

```bash
cs find    -l twig       -p '{% block $name %}$$$body{% endblock %}' templates/
cs find    -l javascript -p 'console.log($$$args)' src/ --json
cs replace -l javascript -p 'foo($x)' -r 'bar($x)' --write src/
cs debug   -l javascript -p 'foo($x)'
cs languages
```

`$name` is one node, `$$$name` is a run of siblings, `$_` and `$$$_` are the same without capturing. In a
replacement, `$name` inserts the captured source verbatim. With no paths, `cs` reads stdin.
`--adapter ./my-adapter.js` loads an adapter you wrote yourself, so the CLI works with languages that ship
nowhere near this repository.

---

## Writing an adapter

An adapter normalizes five things and implements no matching at all:

```ts
import { defineAdapter } from "@codestring/core";

export const myAdapter = defineAdapter<MyParsed, MyNode>({
  id: "mylang",
  parse(source, options) { /* whatever your parser returns */ },
  root(parsed) { return parsed.root; },
  kind(node) { return node.type; },      // a stable string per node type
  range(node) { return node.span; },     // { start, end } in UTF-16 code units
  children(node) { return node.kids; },  // source order, contained in the parent
});
```

Everything else is optional and each option buys one behaviour: `triviaClass` makes whitespace-flexible
matching mean something, `isVariadic` marks unbounded child lists, `placeholder` keeps a hole parseable in
its context, `escape` keeps an interpolated value from breaking out of a literal.

Then run the compliance suite — around 90 cases checking ranges, ordering, containment, UTF-16 offsets,
trivia classes, malformed input and placeholder round-tripping:

```ts
import { runAdapterContractSuite } from "@codestring/testing";

runAdapterContractSuite(myAdapter, {
  valid: ["…"],
  malformed: ["…"],
  placeholderContexts: [{ before: "call(", after: ")" }],
});
```

If an adapter ever needs its own matcher, the abstraction has failed. The
[adapter guide](https://gweiermann.github.io/codestring/adapters.html) walks through building one end to end.

---

## Not in scope

No universal AST, no type or symbol analysis, no formatting or AST printing, no import management, no
cross-file refactoring, no query language separate from JavaScript, no parser hosting.

**Scope resolution is the big one.** Answering "would a bare `name` emitted here resolve to a local
binding?" needs a symbol table, and building one per language is a second product. Reach for your parser's
own tooling there — `@codestring/babel` exists partly so a codemod can hold *one* tree and use
`@babel/traverse` for scope while matching structurally over the same nodes.

---

## Development

```bash
pnpm install
pnpm check           # typecheck the whole workspace, then run every test
pnpm test            # 950+ tests: runtime + type-level
pnpm test:types      # only the type-level assertions
pnpm build           # tsc per package, in dependency order, into dist/
pnpm bench           # parse / match / transform at 1 KB, 100 KB and 1 MB
pnpm example:twig    # the Twig → HTML migration, before and after
pnpm example:js      # a three-rule JavaScript codemod
pnpm example:vue     # one .vue file rewritten as HTML, JavaScript and CSS
```

Tests run straight from the sources — vitest resolves `@codestring/*` to `packages/*/src`, so no build
stands between an edit and a test run. Examples and scripts run on Node's own type stripping, with no
bundler anywhere.

```
packages/core            the language-agnostic matcher, no parser dependencies
packages/adapter-utils   trivia splitting, expression tokenizing, placeholder padding
packages/testing         the adapter contract suite
packages/codemod         rewrite rules and the file runners
packages/eslint          ESLint rules as patterns, over ESLint's own AST
packages/javascript      JavaScript adapter (acorn)
packages/babel           TypeScript / JSX / decorator adapter (@babel/parser)
packages/vue             Vue SFC template adapter (@vue/compiler-dom)
packages/html            HTML adapter (parse5)
packages/twig            Twig adapter + its own parser
packages/css             CSS adapter + its own parser
packages/umbrella        the `codestring` convenience package
packages/cli             the `cs` binary
docs/                    the documentation site
examples/                runnable end-to-end codemods, including nested languages
```

## License

MIT.
