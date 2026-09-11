# @codestring/core

Patterns, matching, captures, source slices and edits. **No parser dependencies** — bring an adapter.

```ts
import { capture, code, createLanguage } from "@codestring/core";

const lang = createLanguage(myAdapter);
const value = capture("value");

lang.parse(sourceCode)
  .replaceAll(code`call(${value})`, code`wrapped(${value})`)
  .text();
```

**One tag.** `code\`…\`` is source with holes, not bound to a language. In the first argument of `replace` it
is a pattern and its holes are slots; in the second it is replacement source and its holes are what the match
captured. It compiles lazily, once per language, cached on the template literal's own `strings` array.

**One object.** `language.parse()` returns a `ParsedDocument` that answers the questions a string answers —
`includes`, `count`, `indexOf`, `lastIndexOf`, `match`, `matchAll`, `equals` — in syntax rather than
characters, and rewrites with `replace` / `replaceAll` / `remove` / `removeAll` / `insertBefore` /
`insertAfter`, each returning a **new** document so they chain. `inside(region, language, rewrite)` hands `region` a capture
for the embedded source, re-reads what it matched with another language and splices the result back, which is how a `.vue` file gets its markup,
script and style rewritten in one pass.

The capture handles you interpolate decide the types you get back: a bare `capture()` yields a
`CaptureResult`, `optional(...)` yields `CaptureResult | undefined`, and `oneOrMore(...)` makes `get()` a
compile error that points at `getAll()`. The adapter's own node type reaches you through
`CaptureResult.nodes[n].raw`.

Exported utility types: `MatchOf`, `CapturesOfPattern`, `NodeOfPattern`, `LanguageNodeOf`, `CaptureSet`,
`CapturesOf`, `SingleOf`, `OptionalOf`, `ManyOf`, `NamesOf`, `Query`, `Rewrite`, plus the adapter contract
(`LanguageAdapter`, `AdapterNodeOf`, `ParsedOf`, `TokenOf`) and `defineAdapter`.

See the [workspace README](../../README.md) for pattern semantics, transform rules and the adapter contract.
