# @codestring/adapter-utils

Helpers for adapter authors, with no dependencies of their own.

- `splitTextTrivia(text, start)` — split a text run into leading whitespace, body and trailing whitespace, so a
  capture binds the markup rather than the indentation around it
- `tokenizeExpression(text, start)` — names, numbers, strings, operators and whitespace, for template languages
  whose tag arguments the parser hands over as one string
- `isInsideDelimiter(before, open, close)` / `padPlaceholder(...)` — decide whether a pattern hole needs a
  space so it cannot fuse with the literal in front of it
