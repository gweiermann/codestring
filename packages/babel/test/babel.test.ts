import { parse as babelParse } from "@babel/parser";
import { describe, expect, it } from "vitest";
import { any, capture, code, createLanguage, exactly } from "../../core/src/index.js";
import { babelAdapter, fromBabel } from "../src/index.js";

const ts = createLanguage(babelAdapter);

describe("the babel adapter reads what the acorn one cannot", () => {
  it.each([
    "const x: number = 1;",
    "export default Shopware.Component.register('sw-a', { props: {} as Props });",
    "class A { @Dec() x = 1; }",
    "enum Mode { On, Off }",
  ])("parses %s, which acorn rejects", (source) => {
    expect(ts.parse(source).errors.map((error) => error.message)).toEqual([]);
  });

  it("reads JSX when the caller asks for the plugin", () => {
    const jsx = createLanguage(babelAdapter, { parseOptions: { plugins: ["jsx"] } });

    expect(jsx.parse("const el = <div className='a' />;").hasErrors()).toBe(false);
  });

  it("matches through a type assertion the pattern never mentions", () => {
    const name = capture("name");
    const document = ts.parse(`Shopware.Component.register('sw-a', {} as Options);`);
    const match = document.match(code`Shopware.Component.register(${exactly(1, name)}, ${any()})`);

    expect(match?.get(name).text()).toBe("'sw-a'");
  });
});

describe("a tree someone else parsed", () => {
  const SOURCE = `export default {
  methods: {
    onChange(perPage: number) { this.perPage = perPage; },
    reset() { return 1; },
  },
};`;

  it("wraps a Babel AST without parsing again", () => {
    const file = babelParse(SOURCE, { sourceType: "module", plugins: ["typescript"] });
    const wrapped = fromBabel(file, SOURCE);
    const document = ts.parse(SOURCE);

    expect(wrapped.root.children.map((child) => child.kind)).toEqual(
      document.root.children.map((child) => child.kind),
    );
  });

  it("answers about one Babel node without re-parsing its text", () => {
    const document = ts.parse(SOURCE);
    const bodies = document
      .nodes()
      .filter((node) => node.kind === "ObjectMethod")
      .map((node) => node.child("BlockStatement")!);

    expect(bodies.map((body) => body.includes(code`this`))).toEqual([true, false]);
  });
});

describe("normalized shape", () => {
  it("gives a list's commas nodes of their own", () => {
    const document = ts.parse(`call(a, b);`);
    const call = document.nodes().find((node) => node.kind === "CallExpression")!;

    expect(call.children.map((child) => child.kind)).toEqual([
      "Identifier",
      "Identifier",
      "separator",
      "Identifier",
    ]);
  });

  it("puts comments in the tree as trivia", () => {
    const document = ts.parse(`function f() {\n  // why\n  return 1;\n}`);
    const block = document.nodes().find((node) => node.kind === "BlockStatement")!;

    expect(block.children.map((child) => `${child.kind}:${child.trivia}`)).toEqual([
      "Comment:comment",
      "ReturnStatement:null",
      "separator:separator",
    ]);
  });

  it("puts a decorator before the member it decorates", () => {
    const document = ts.parse(`class A { @Dec() method() {} }`);
    const method = document.nodes().find((node) => node.kind === "ClassMethod")!;

    expect(method.children[0]!.kind).toBe("Decorator");
  });

  it("compares a string by what it says, not its quotes", () => {
    expect(ts.parse(`register("sw-a");`).includes(code`register('sw-a')`)).toBe(true);
  });
});
