# @codestring/eslint

ESLint rules written as patterns: find this, say that, fix it like this.

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

That is the whole rule. No visitor, no `node.parent` walking, no fixer range arithmetic — and the fix keeps
whatever was inside the call exactly as it was written, spacing and comments included.

| option | |
|---|---|
| `find` | the pattern; a `code` fragment, with capture handles for the parts you need |
| `where` | narrow it further than the pattern can say |
| `message` / `messageId` | what to report; `messageId` reads from `meta.messages` |
| `data` | placeholders for the message, built from what the match captured |
| `report` | report one capture instead of the whole match |
| `fix` | an autofix: return an edit, several edits, or nothing |
| `suggest` | offer the fix as a suggestion rather than applying it |
| `meta` | ESLint's own `meta`, passed through untouched |

## It reuses ESLint's AST

`eslintLanguage(sourceCode)` wraps the tree ESLint already built — nothing is parsed twice. Because the tree is
read structurally (kind, range, children) rather than by node type, whatever parser ESLint was configured with
comes along, including the ESTree supersets that typed parsers produce.

```ts
const document = eslintLanguage(context.sourceCode).parse(context.sourceCode.text);
document.matchAll(code`fetch(${url})`);
```

Use it directly when a rule needs more than one pattern, or wants to ask a structural question in a visitor it
already has.

## Fixes are validated

`fix` returns edit values, not fixer calls. They go through the same validation a codemod does, so a rule
cannot hand ESLint two fixes that overlap, and a removal takes its separator with it:

```ts
fix: (match) => match.remove(),                                  // "a();\ndebugger;\nb();" → "a();\n\nb();"
fix: (match) => [match.replace`fetchJson(${url})`, match.insertBefore`/* migrated */ `],
```

## What it does not do

One pattern per rule. A rule that has to reason about scope, types or control flow still wants a hand-written
visitor — this covers the large middle of rules that are really "this shape is wrong, that shape is right".
