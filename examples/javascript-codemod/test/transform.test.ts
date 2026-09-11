import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { codemod, renameFetch, report, transform } from "../transform.ts";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");

describe("javascript codemod", () => {
  it("counts what each rule will touch", async () => {
    const source = await readFile(join(fixtures, "service.js"), "utf8");
    expect(report(source)).toEqual({
      "console.log → logger.debug": 2,
      "legacyFetch → fetchJson": 1,
      "drop debugger statements": 1,
    });
  });

  it("names the codemod and the rules it bundles", () => {
    expect(codemod.name).toBe("service migration");
    expect(codemod.transformers.map((entry) => entry.name)).toEqual([
      "console.log → logger.debug",
      "legacyFetch → fetchJson",
      "drop debugger statements",
    ]);
  });

  it("applies every rule in one validated pass", async () => {
    const source = await readFile(join(fixtures, "service.js"), "utf8");
    const result = transform(source);
    expect(result).toContain("logger.debug('loading', id)");
    expect(result).toContain("/* migrated */ fetchJson(`/api/product/${id}`)");
    expect(result).not.toContain("debugger;");
    expect(result).not.toContain("console.log");
  });

  it("keeps comments, tabs and template literals untouched", async () => {
    const source = await readFile(join(fixtures, "service.js"), "utf8");
    const result = transform(source);
    expect(result).toContain("// Keeps its own formatting, comments and quote style.");
    expect(result).toContain("   // trailing comment stays put");
    expect(result).toContain("\treturn helper(response);");
  });

  it("leaves indentation behind when a statement is removed", () => {
    expect(transform("function f() {\n\tdebugger;\n\trun();\n}")).toBe("function f() {\n\t\n\trun();\n}");
  });

  it("returns the source unchanged when no rule matches", () => {
    const source = "export const value = 1;\n";
    expect(transform(source)).toBe(source);
  });

  it("runs one rule on its own", () => {
    expect(renameFetch.transformString("legacyFetch(url);", "a.js")).toBe("/* migrated */ fetchJson(url);");
  });

  it("leaves a gated match alone", () => {
    expect(transform("console.log();", "a.js")).toBe("console.log();");
  });
});
