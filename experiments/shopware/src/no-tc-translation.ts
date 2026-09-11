import { capture, code } from "@codestring/core";
import { createRule } from "@codestring/eslint";

const args = capture("args");
const receiver = capture("receiver");

/**
 * Shopware's `core-rules/no-tc-translation`, migrated.
 *
 * The original is 75 lines: two AST shape checks, a shared report helper, and a
 * branch that registers the same visitor twice through eslint-plugin-vue's
 * template-body plumbing.
 */
export const noTcTranslation = createRule({
  meta: {
    type: "suggestion",
    fixable: "code",
    docs: { description: "Disallow $tc() in favor of $t() for translations" },
    messages: {
      noTc: "Use $t() instead of $tc(). $tc is deprecated — $t handles pluralization natively.",
    },
  },
  find: code`$tc(${args})`,
  messageId: "noTc",
  fix: (match) => match.replace`$t(${args})`,
});

/** `this.$tc(...)`, `Shopware.Application.$tc(...)` — any receiver. */
export const noMemberTcTranslation = createRule({
  meta: {
    type: "suggestion",
    fixable: "code",
    docs: { description: "Disallow x.$tc() in favor of x.$t()" },
    messages: { noTc: "Use $t() instead of $tc()." },
  },
  find: code`${receiver}.$tc(${args})`,
  messageId: "noTc",
  fix: (match) => match.replace`${receiver}.$t(${args})`,
});
