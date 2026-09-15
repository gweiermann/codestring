import { parse as babelParse } from "@babel/parser";
import { describe, expect, it } from "vitest";
import { createLanguage } from "../../core/src/index.js";
import { babelAdapter, babelIndex, babelLanguage, babelNode, fromBabel } from "../src/index.js";

const SOURCE = `export default { methods: { a() { this.x = 1; } } };`;

describe("each helper stands on its own", () => {
  it("fromBabel needs no language", () => {
    const parsed = fromBabel(babelParse(SOURCE, { sourceType: "module", plugins: ["typescript"] }), SOURCE);

    expect(parsed.root.kind).toBe("Program");
  });

  it("babelLanguage needs no adapter from the caller", () => {
    const language = babelLanguage(babelParse(SOURCE, { sourceType: "module" }), SOURCE);

    expect(language.parse(SOURCE).root.kind).toBe("Program");
  });

  it("babelNode works on a node from any construction of the language", () => {
    const file = babelParse(SOURCE, { sourceType: "module", plugins: ["typescript"] });
    const roots = [createLanguage(babelAdapter).parse(SOURCE).root, babelLanguage(file, SOURCE).parse(SOURCE).root];

    expect(roots.map((root) => babelNode(root)?.type)).toEqual(["Program", "Program"]);
  });

  it("babelIndex takes any node, not only a root", () => {
    const document = createLanguage(babelAdapter).parse(SOURCE);
    const method = document.nodes().find((node) => node.kind === "ObjectMethod")!;

    const whole = babelIndex(document.root);
    const part = babelIndex(method);

    expect(part.size).toBeLessThan(whole.size);
    expect([...part.keys()].every((node) => whole.has(node))).toBe(true);
  });

  it("the helpers do not depend on each other's having run", () => {
    const file = babelParse(SOURCE, { sourceType: "module", plugins: ["typescript"] });

    // babelNode straight off a fresh parse, with no index ever built.
    const document = babelLanguage(file, SOURCE).parse(SOURCE);
    expect(babelNode(document.nodes()[1]!)).toBeDefined();

    // babelIndex straight off a fresh parse, with babelNode never called.
    expect(babelIndex(babelLanguage(file, SOURCE).parse(SOURCE).root).size).toBeGreaterThan(0);
  });
});
