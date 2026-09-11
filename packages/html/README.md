# @codestring/html

HTML adapter backed by [parse5](https://github.com/inikulin/parse5), with source locations.

Two deliberate shapes:

- **attributes live in their own `attributes` child**, so a hole in attribute position can never consume
  element content
- **text runs are split** into `whitespace` and `text`, so a capture binds the markup rather than the
  indentation around it

```ts
const html = createLanguage(htmlAdapter);
const inner = capture();

html.pattern`<template${any()}>${inner}</template>`;
```

Exported types: `HtmlNode`, `HtmlParsed`.

Node kinds: `fragment`, `element:<tag>`, `attributes`, `attribute`, `text`, `whitespace`, `comment`, `doctype`.
`<template>` content is read from the parser's template content fragment. Malformed markup is reported through
diagnostics rather than thrown.
