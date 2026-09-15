import { describe, expect, it } from "vitest";
import { any, capture, code, createLanguage } from "../src/index.js";
import { javascriptAdapter } from "../../javascript/src/index.js";
import { twigAdapter } from "../../twig/src/index.js";

const js = createLanguage(javascriptAdapter);

const SOURCE = `export default {
  props: { perPage: { type: Number } },
  methods: {
    onChange(perPage) { this.perPage = perPage; },
    reset() { return 1; },
  },
}`;

const optionsObject = () => {
  const file = js.parse(SOURCE);
  return file.nodes().find((node) => node.kind === "ObjectExpression")!;
};

describe("searching a node searches the tree it belongs to", () => {
  it("answers about a subtree that its own text would answer differently", () => {
    const options = optionsObject();

    expect(options.includes(code`this`)).toBe(true);
    // The same text on its own is a block statement, where the `this` is not there to find.
    expect(js.parse(options.slice()).includes(code`this`)).toBe(false);
  });

  it("scopes the answer to the node, not the file", () => {
    const file = js.parse(SOURCE);
    const methods = file
      .nodes()
      .filter((node) => node.kind === "FunctionExpression")
      .map((node) => node.child("BlockStatement")!);

    expect(methods.map((body) => body.includes(code`this`))).toEqual([true, false]);
    expect(file.count(code`this.${any()}`)).toBe(1);
  });

  it("binds captures the same way a document does", () => {
    const member = capture("member");
    const matches = optionsObject().matchAll(code`this.${member}`);

    expect(matches.map((match) => match.get(member).text())).toEqual(["perPage"]);
  });

  it("finds nothing outside the node", () => {
    const file = js.parse(`a.flag; function keep() { b.flag; }`);
    const fn = file.nodes().find((node) => node.kind === "FunctionDeclaration")!;

    expect(fn.count(code`${any()}.flag`)).toBe(1);
    expect(file.count(code`${any()}.flag`)).toBe(2);
  });

  it("never matches the node itself, the way a document never matches its root", () => {
    const file = js.parse(`const x = 1;`);
    const declaration = file.nodes().find((node) => node.kind === "VariableDeclaration")!;

    expect(declaration.includes(code`const x = 1;`)).toBe(false);
    expect(file.includes(code`const x = 1;`)).toBe(true);
  });

  it("refuses a pattern of another language rather than guessing", () => {
    const twig = createLanguage(twigAdapter);

    expect(() => optionsObject().includes(twig.pattern`{% block x %}`)).toThrowError(
      /twig pattern cannot search a javascript node/u,
    );
  });
});
