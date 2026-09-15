# @codestring/babel

TypeScript, JSX and decorator-aware language adapter, backed by `@babel/parser`.

Same normalized shape as [`@codestring/javascript`](../javascript) — kinds are
ESTree/Babel node types, a list's `,` and a statement's `;` are separator nodes,
comments are trivia in the tree. The difference is the parser: acorn reads
JavaScript, Babel reads the dialects a real codebase is written in.

```ts
import { capture, code, createLanguage, exactly } from '@codestring/core';
import { babelAdapter } from '@codestring/babel';

const ts = createLanguage(babelAdapter);

const name = capture('name');
const registration = code`Shopware.Component.register(${exactly(1, name)}, ${any()})`;

ts.parse(source).matchAll(registration).map((match) => match.get(name).text());
```

## Choosing plugins

The default plugin set reads TypeScript, legacy decorators, class properties,
dynamic `import()`, `import.meta` and top-level `await`. Set your own through
the language's parse options — Babel refuses `jsx` and `typescript` together
outside a `.tsx` file, so a JSX codebase asks for it explicitly:

```ts
const jsx = createLanguage(babelAdapter, { parseOptions: { plugins: ['jsx'] } });
```

## Matching over an AST you already have

A codemod that needs `@babel/traverse` for its scope chain should not parse the
file twice and hold two trees that drift. `fromBabel` wraps the AST it already
built:

```ts
import { parse } from '@babel/parser';
import { fromBabel } from '@codestring/babel';

const file = parse(source, { sourceType: 'module', plugins: ['typescript'] });
const parsed = fromBabel(file, source);
```

Ranges are absolute in `source`, so a node found by matching and a node found by
traversal address the same region.
