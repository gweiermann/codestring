import { RuleTester } from "eslint";
import { describe, it } from "vitest";
import { any, capture, code, exactly } from "@codestring/core";
import { createRule } from "@codestring/eslint";

const tester = new RuleTester({ languageOptions: { ecmaVersion: "latest", sourceType: "module" } });

const args = capture("args");

/** The whole rule. No visitor, no node bookkeeping, no fixer arithmetic. */
const noConsoleLog = createRule({
  meta: { type: "suggestion", fixable: "code", messages: { useLogger: "Use logger.debug instead." } },
  find: code`console.log(${args})`,
  messageId: "useLogger",
  fix: (match) => match.replace`logger.debug(${args})`,
});

describe("createRule", () => {
  it("reports and fixes", () => {
    tester.run("no-console-log", noConsoleLog, {
      valid: ["logger.debug('a');", "console.warn('a');", "const log = console.log;"],
      invalid: [
        {
          code: "console.log('a');",
          output: "logger.debug('a');",
          errors: [{ messageId: "useLogger" }],
        },
        {
          code: "function f() {\n\tconsole.log(   'a', b   );\n}",
          output: "function f() {\n\tlogger.debug('a', b);\n}",
          errors: 1,
        },
        {
          code: "console.log(a); console.log(b);",
          output: "logger.debug(a); logger.debug(b);",
          errors: 2,
        },
      ],
    });
  });

  it("points at the right place", () => {
    tester.run("no-console-log-loc", noConsoleLog, {
      valid: [],
      invalid: [
        {
          code: "const x = 1;\nconsole.log('a');",
          output: "const x = 1;\nlogger.debug('a');",
          errors: [{ messageId: "useLogger", line: 2, column: 1, endLine: 2, endColumn: 17 }],
        },
      ],
    });
  });

  it("narrows with where()", () => {
    const rule = createRule({
      meta: { type: "problem", messages: { literal: "Only string literals, please." } },
      find: code`console.log(${args})`,
      messageId: "literal",
      where: (match) => !match.get(args).text().startsWith("'"),
    });
    tester.run("only-literals", rule, {
      valid: ["console.log('a');"],
      invalid: [{ code: "console.log(value);", errors: 1 }],
    });
  });

  it("fills message placeholders from captures", () => {
    const rule = createRule({
      meta: { type: "suggestion", messages: { named: "Do not log {{ what }}." } },
      find: code`console.log(${args})`,
      messageId: "named",
      data: (match) => ({ what: match.get(args).text() }),
    });
    tester.run("named", rule, {
      valid: [],
      invalid: [{ code: "console.log(secret);", errors: [{ message: "Do not log secret." }] }],
    });
  });

  it("reports one capture instead of the whole match", () => {
    const rule = createRule({
      meta: { type: "suggestion", messages: { here: "Right here." } },
      find: code`console.log(${args})`,
      messageId: "here",
      report: (match) => match.get(args),
    });
    tester.run("report-capture", rule, {
      valid: [],
      invalid: [{ code: "console.log(value);", errors: [{ messageId: "here", column: 13, endColumn: 18 }] }],
    });
  });

  it("removes a statement, separator and all", () => {
    const rule = createRule({
      meta: { type: "problem", fixable: "code", messages: { drop: "No debugger." } },
      find: code`debugger;`,
      messageId: "drop",
      fix: (match) => match.remove(),
    });
    tester.run("no-debugger", rule, {
      valid: ["const a = 1;"],
      invalid: [{ code: "a();\ndebugger;\nb();", output: "a();\n\nb();", errors: 1 }],
    });
  });

  it("offers a suggestion instead of an autofix", () => {
    const rule = createRule({
      meta: {
        type: "suggestion",
        hasSuggestions: true,
        messages: { useLogger: "Use logger.debug instead.", swap: "Replace with logger.debug" },
      },
      find: code`console.log(${args})`,
      messageId: "useLogger",
      suggest: "Replace with logger.debug",
      fix: (match) => match.replace`logger.debug(${args})`,
    });
    tester.run("suggest", rule, {
      valid: [],
      invalid: [
        {
          code: "console.log('a');",
          errors: [
            {
              messageId: "useLogger",
              suggestions: [{ desc: "Replace with logger.debug", output: "logger.debug('a');" }],
            },
          ],
        },
      ],
    });
  });

  it("matches structurally, not textually", () => {
    tester.run("structural", noConsoleLog, {
      valid: ["const s = \"console.log('a')\";", "// console.log('a')", "foo.console.log('a');"],
      invalid: [{ code: "console\n\t.log('a');", output: "logger.debug('a');", errors: 1 }],
    });
  });

  it("works with a pattern that spans several arguments", () => {
    const first = capture("first");
    const second = capture("second");
    const rule = createRule({
      meta: { type: "suggestion", fixable: "code", messages: { swap: "Swap them." } },
      find: code`pair(${exactly(1, first)}, ${exactly(1, second)})`,
      messageId: "swap",
      fix: (match) => match.replace`pair(${second}, ${first})`,
    });
    tester.run("swap", rule, {
      valid: ["pair(a);"],
      invalid: [{ code: "pair(a, b);", output: "pair(b, a);", errors: 1 }],
    });
  });

  it("leaves a file alone when nothing matches", () => {
    tester.run("clean", noConsoleLog, { valid: ["export const value = 1;\n"], invalid: [] });
  });

  it("sees any() as a structural hole", () => {
    const rule = createRule({
      meta: { type: "suggestion", messages: { any: "No logging." } },
      find: code`console.log(${any()})`,
      messageId: "any",
    });
    tester.run("any", rule, { valid: ["console.warn(1);"], invalid: [{ code: "console.log(1, 2);", errors: 1 }] });
  });
});
