# @codestring/css

CSS adapter, with its own dependency-free parser: rules, declarations, at-rules and comments — enough
structure to match and rewrite a stylesheet, not a full CSS grammar.

```ts
const css = createLanguage(cssAdapter);
const value = capture("value");

css.parse(stylesheet)
  .replaceAll(code`color: ${value}`, code`color: var(--text)`)
  .text();
```

Node kinds: `stylesheet`, `rule` (`selector` + `block`), `declaration` (`property` + `value`), `at-rule`
(`prelude` + `block`), `at-statement`, `comment`, `whitespace`, `separator`, `text`.

A semicolon is a **separator**, not part of the declaration before it. That means rewriting `color: red`
cannot swallow the `;` that follows, a pattern matches whether or not the last declaration in a block ends in
one, and removing a declaration takes its separator along.
