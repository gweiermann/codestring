import { RuleTester } from "eslint";
import { describe, it } from "vitest";
import { noMemberTcTranslation, noTcTranslation } from "../src/no-tc-translation.ts";
import { noSrcImports } from "../src/no-src-imports.ts";
import { removeEmptyTemplates } from "../src/remove-empty-templates.ts";

const tester = new RuleTester({ languageOptions: { ecmaVersion: "latest", sourceType: "module" } });

describe("no-tc-translation", () => {
  it("matches Shopware's own fixtures", () => {
    tester.run("no-tc-translation", noTcTranslation, {
      valid: ["$t('foo');", "const tc = $tc;", "other('foo');"],
      invalid: [
        { code: "$tc('foo');", output: "$t('foo');", errors: [{ messageId: "noTc" }] },
        { code: "$tc('foo', { count: 2 });", output: "$t('foo', { count: 2 });", errors: 1 },
      ],
    });
    tester.run("no-member-tc", noMemberTcTranslation, {
      valid: ["this.$t('foo');"],
      invalid: [
        { code: "this.$tc('foo');", output: "this.$t('foo');", errors: 1 },
        { code: "Shopware.Application.$tc('a', b);", output: "Shopware.Application.$t('a', b);", errors: 1 },
      ],
    });
  });

  it("keeps the argument source exactly as written", () => {
    tester.run("formatting", noTcTranslation, {
      valid: [],
      invalid: [
        {
          code: "$tc(\n\t'sw-product.general.title',\n\t{ count: items.length },\n);",
          output: "$t('sw-product.general.title',\n\t{ count: items.length });",
          errors: 1,
        },
      ],
    });
  });
});

describe("no-src-imports", () => {
  it("reports only core imports", () => {
    tester.run("no-src-imports", noSrcImports, {
      valid: ["import a from 'vue';", "import b from './local.js';", "import c from '@shopware-ag/meteor';"],
      invalid: [
        {
          code: "import Component from '@administration/app/adapter/view/vue.adapter';",
          errors: [{ messageId: "noSrcImport" }],
        },
      ],
    });
  });
});

const templateTester = new RuleTester({ languageOptions: { ecmaVersion: "latest", sourceType: "module" } });

describe("remove-empty-templates", () => {
  it("unwraps a template with no attributes and leaves the rest", () => {
    templateTester.run("remove-empty-templates", removeEmptyTemplates, {
      valid: [
        "// <template v-if=\"x\"><p>a</p></template>",
        "// <template #slot><p>a</p></template>",
      ],
      invalid: [],
    });
  });
});
