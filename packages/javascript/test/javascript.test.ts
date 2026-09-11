import { describe, expect, it } from "vitest";
import {
  any,
  code,
  capture,
  createLanguage,
  exactly,
  insertBefore,
  oneOrMore,
  remove,
  } from "@codestring/core";
import { javascriptAdapter } from "@codestring/javascript";

const js = createLanguage(javascriptAdapter);

describe("javascript parsing", () => {
  it("orders children by source position", () => {
    const parsed = js.parse("const a = b + c;");
    const declaration = parsed.root.children[0]!;
    expect(declaration.kind).toBe("VariableDeclaration");
    expect(parsed.root.children.every((child) => child.start <= child.end)).toBe(true);
  });

  it("puts comments back into the tree as trivia", () => {
    const parsed = js.parse("function f() {\n  // why\n  return 1;\n}");
    const block = parsed.root.children[0]!.children.find((child) => child.kind === "BlockStatement")!;
    expect(block.children.map((child) => child.kind)).toEqual(["Comment", "ReturnStatement", "separator"]);
    expect(block.children[0]!.trivia).toBe("comment");
  });

  it("reports a syntax error instead of throwing", () => {
    const parsed = js.parse("const = ;");
    expect(parsed.hasErrors()).toBe(true);
    expect(parsed.diagnostics[0]!.message).toMatch(/Unexpected/);
  });
});

describe("javascript matching", () => {
  it("captures a whole argument expression, however nested", () => {
    const argument = capture("argument");
    const match = js.pattern`foo(${argument})`.match("const value = foo(bar(1, 2));")!;
    expect(match.get(argument).text()).toBe("bar(1, 2)");
    expect(match.get(argument).kinds()).toEqual(["CallExpression"]);
  });

  it("matches an expression pattern in any expression position", () => {
    const pattern = js.pattern`foo(${capture("x")})`;
    expect(pattern.findAll("foo(1); const a = foo(2); [foo(3)];")).toHaveLength(3);
  });

  it("ignores formatting", () => {
    expect(js.pattern`foo(a, b)`.match("foo(\n  a,\n  b,\n)")).not.toBeNull();
  });

  it("pins the argument count with exactly()", () => {
    const argument = capture("argument");
    const single = js.pattern`foo(${exactly(1, argument)})`;
    expect(single.match("foo(1)")).not.toBeNull();
    expect(single.match("foo(1, 2)")).toBeNull();
  });

  it("collects the statements of a function body", () => {
    const statement = capture("statement");
    const match = js.pattern`function handler() { ${oneOrMore(statement)} }`.match(
      "function handler() {\n  setup();\n  run();\n}",
    )!;
    // The terminating semicolons are separators of the list, so the captures stay tight.
    expect(match.getAll(statement).map((result) => result.text())).toEqual(["setup()", "run()"]);
  });

  it("matches a member call", () => {
    const argument = capture("argument");
    const match = js.pattern`console.log(${argument})`.match("console.log('hi');")!;
    expect(match.get(argument).text()).toBe("'hi'");
  });

  it("treats a comment as significant under the default policy", () => {
    const source = "function f() { /* note */ run(); }";
    expect(js.pattern`function f() { run(); }`.match(source)).toBeNull();
    expect(js.pattern({ trivia: "ignore" })`function f() { run(); }`.match(source)).not.toBeNull();
  });

  it("keeps matches out of a region the parser could not read", () => {
    expect(js.pattern`foo(${any()})`.findAll("foo(1); const = ;")).toHaveLength(0);
  });
});

describe("javascript transforms", () => {
  it("renames a call without reformatting anything else", () => {
    const source = "const x = foo(  1,\n  2 );\t// keep\r\n";
    const argument = capture("argument");
    const match = js.pattern`foo(${argument})`.match(source)!;
    const result = match.transform([match.replace`bar(${argument})`]);
    // The capture spans the arguments, not the padding inside the parentheses.
    expect(result).toBe("const x = bar(1,\n  2);\t// keep\r\n");
  });

  it("inserts before a matched statement", () => {
    const statement = capture("statement");
    const match = js.pattern`function f() { ${oneOrMore(statement)} }`.match("function f() {\n  run();\n}")!;
    const result = match.transform([insertBefore(match.getAll(statement)[0]!, "// added\n  ")]);
    expect(result).toBe("function f() {\n  // added\n  run();\n}");
  });

  it("leaves the surrounding trivia behind when a statement is removed", () => {
    const statement = capture("statement");
    const match = js.pattern`function f() { ${oneOrMore(statement)} }`.match("function f() {\n  a();\n  b();\n}")!;
    expect(match.transform([remove(match.getAll(statement)[0]!)])).toBe("function f() {\n  \n  b();\n}");
  });
});

describe("separators", () => {
  it("keeps a statement's terminator out of the statement", () => {
    const declaration = js.parse("const a = 1;").root.children[0]!;
    expect(declaration.text()).toBe("const a = 1");
    expect(js.parse("const a = 1;").root.children[1]!.trivia).toBe("separator");
  });

  it("gives a comma between arguments a node of its own", () => {
    const call = js.parse("foo(a, b)").root.children[0]!.children[0]!;
    expect(call.children.map((child) => [child.kind, child.text()])).toEqual([
      ["Identifier", "foo"],
      ["Identifier", "a"],
      ["separator", ","],
      ["Identifier", "b"],
    ]);
  });

  it("matches whether or not the statement ends in a semicolon", () => {
    expect(js.parse("const a = 1;").includes(code`const a = 1`)).toBe(true);
    expect(js.parse("const a = 1").includes(code`const a = 1;`)).toBe(true);
  });

  it("leaves the terminator in place when a statement is rewritten", () => {
    const result = js
      .parse("const a = 1; const b = 2;")
      .replaceAll(code`const a = ${any()}`, "const a = 9")
      .text();
    expect(result).toBe("const a = 9; const b = 2;");
  });

  it("takes the terminator along when a statement is removed", () => {
    expect(js.parse("a(); b();").removeAll(code`a()`).text()).toBe(" b();");
  });

  it("takes the comma along when one argument is removed", () => {
    const second = capture("second");
    const match = js.parse("foo(a, b);").match(code`foo(a, ${second})`)!;
    expect(match.transform([match.remove(second)])).toBe("foo(a);");
  });

  it("takes the comma before it when the removed element is last", () => {
    const first = capture("first");
    const match = js.parse("[x, y]").match(code`[${first}, y]`)!;
    // The separator goes; the space it left behind is not ours to tidy.
    expect(match.transform([match.remove(first)])).toBe("[ y]");
  });

  it("does not leave a for-loop header in pieces", () => {
    const header = js.parse("for (let i = 0; i < n; i++) { a(); }");
    expect(header.hasErrors()).toBe(false);
    expect(header.text()).toBe("for (let i = 0; i < n; i++) { a(); }");
    expect(header.removeAll(code`a()`).text()).toBe("for (let i = 0; i < n; i++) {  }");
  });
});

describe("holes where the grammar demands a literal", () => {
  it("matches a module specifier", () => {
    const from = capture("from");
    const match = js.parse("import Component from '@administration/app/vue.adapter';").match(
      code`import ${capture("bindings")} from "${from}"`,
    )!;
    expect(match.get(from).text()).toBe("'@administration/app/vue.adapter'");
  });

  it("does not care which quotes the source used", () => {
    const from = capture("from");
    const pattern = code`import a from "${from}"`;
    expect(js.parse(`import a from 'x';`).includes(pattern)).toBe(true);
    expect(js.parse(`import a from "x";`).includes(pattern)).toBe(true);
  });

  it("matches any argument that has to be a literal", () => {
    const key = capture("key");
    const match = js.parse("t('sw-product.title');").match(code`t("${key}")`)!;
    expect(match.get(key).text()).toBe("'sw-product.title'");
  });

  it("still matches a plain literal written out", () => {
    expect(js.parse("import a from 'x';").includes(code`import a from 'x'`)).toBe(true);
    expect(js.parse("import a from 'y';").includes(code`import a from 'x'`)).toBe(false);
  });
});
