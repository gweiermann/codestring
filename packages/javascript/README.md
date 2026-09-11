# @codestring/javascript

JavaScript adapter backed by [acorn](https://github.com/acornjs/acorn) (latest ECMA version, module source
type, forgiving about top-level `return`/`await`).

- children come from the ESTree node in source order; shorthand forms that reach the same node twice
  (`{ a }`, `import { a }`) collapse to one child
- comments are spliced back into the tree as trivia, so the trivia policies mean something
- `ExpressionStatement` is declared a pattern wrapper, so `` js.pattern`foo($x)` `` matches an expression
  anywhere, not only in statement position

```ts
const js = createLanguage(javascriptAdapter);
const argument = capture();

js.pattern`foo(${argument})`.match("const x = foo(bar(1, 2));");
// argument → "bar(1, 2)"
```

Kinds are ESTree node types, plus `Comment`, `separator` and `error`.

A statement's terminating `;` and the `,` between list elements are **separators**, not part of the nodes
beside them — ESTree puts the semicolon inside the statement and gives the comma no node at all. Pulling them
out means rewriting `const a = 1` keeps its `;`, removing one argument takes its comma, and a pattern matches
whether or not the statement it describes ends in a semicolon. `JavaScriptNode.raw` is acorn's own `Node`, so a
capture result can be inspected with acorn's types intact.
