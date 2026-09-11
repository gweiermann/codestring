import { capture, code } from "@codestring/core";
import { createRule } from "@codestring/eslint";

const source = capture("source");

/**
 * Shopware's `plugin-rules/no-src-imports`, migrated. The original walks
 * `ImportDeclaration` nodes and tests `node.source.value.startsWith(...)`.
 */
export const noSrcImports = createRule({
  meta: {
    type: "problem",
    docs: { description: "Plugins must not import from the Administration core" },
    messages: {
      noSrcImport:
        'You can\'t use imports directly from the Shopware Core via {{ source }}. ' +
        "Use the global Shopware object instead.",
    },
  },
  find: code`import ${capture("bindings")} from "${source}"`,
  where: (match) => match.get(source).text().slice(1).startsWith("@administration/"),
  messageId: "noSrcImport",
  data: (match) => ({ source: match.get(source).text() }),
  report: (match) => match.get(source),
});
