import { describe, expect, it } from "vitest";
import { any, capture, code, createLanguage } from "@codestring/core";
import { cssAdapter } from "@codestring/css";

const css = createLanguage(cssAdapter);
const value = capture("value");

describe("css parsing", () => {
  it("splits a rule into its selector and block", () => {
    const rule = css.parse(".a { color: red; }").root.children[0]!;
    expect(rule.kind).toBe("rule");
    expect(rule.children.map((child) => child.kind)).toEqual(["selector", "block"]);
    expect(rule.children[0]!.text()).toBe(".a");
  });

  it("splits a declaration into property and value", () => {
    const block = css.parse(".a { color: red; }").root.children[0]!.children[1]!;
    const declaration = block.children.find((child) => child.kind === "declaration")!;
    expect(declaration.kind).toBe("declaration");
    expect(declaration.children.map((child) => child.text())).toEqual(["color", "red"]);
  });

  it("keeps comments as trivia and semicolons as separators", () => {
    expect(css.parse("/* note */").root.children[0]!.trivia).toBe("comment");
    const block = css.parse(".a { color: red; }").root.children[0]!.children[1]!;
    expect(block.children.find((child) => child.kind === "separator")!.trivia).toBe("separator");
  });

  it("matches whether or not the last declaration ends in a semicolon", () => {
    expect(css.parse(".a { color: red; }").includes(code`.a { color: red }`)).toBe(true);
    expect(css.parse(".a { color: red }").includes(code`.a { color: red; }`)).toBe(true);
  });

  it("nests an at-rule's block", () => {
    const atRule = css.parse("@media screen { .a { color: red } }").root.children[0]!;
    expect(atRule.kind).toBe("at-rule");
    expect(atRule.children[1]!.children.map((child) => child.kind)).toContain("rule");
  });

  it("reports an unclosed block", () => {
    expect(css.parse(".a { color: red").hasErrors()).toBe(true);
  });
});

describe("css matching", () => {
  it("matches a declaration by value", () => {
    const match = css.parse(".a { color: red; }").match(code`color: ${value}`)!;
    expect(match.get(value).text()).toBe("red");
  });

  it("matches a declaration by property", () => {
    const property = capture("property");
    const match = css.parse(".a { color: red; }").match(code`${property}: red`)!;
    expect(match.get(property).text()).toBe("color");
  });

  it("ignores formatting", () => {
    expect(css.parse(".a{color:red}").includes(code`color: red`)).toBe(true);
    expect(css.parse(".a {\n  color:   red;\n}").includes(code`color: red`)).toBe(true);
  });

  it("matches a whole rule", () => {
    const body = capture("body");
    const match = css.parse(".a { color: red; }").match(code`.a { ${body} }`)!;
    // The semicolon is a separator of its own, so the capture stays tight.
    expect(match.get(body).text()).toBe("color: red");
  });

  it("rewrites a value and leaves the rest byte for byte", () => {
    const source = "/* keep */\r\n.a {\r\n\tcolor:   red;\r\n\tmargin: 0;\r\n}\r\n";
    const result = css.parse(source).replaceAll(code`color: red`, code`color: var(--danger)`).text();
    expect(result).toBe(source.replace("color:   red;", "color: var(--danger);"));
    expect(result).toContain("/* keep */\r\n");
  });

  it("finds every matching declaration", () => {
    const document = css.parse(".a { color: red } .b { color: red } .c { color: blue }");
    expect(document.count(code`color: red`)).toBe(2);
    expect(document.replaceAll(code`color: ${any()}`, code`color: inherit`).text()).toBe(
      ".a { color: inherit } .b { color: inherit } .c { color: inherit }",
    );
  });
});

describe("removing a declaration", () => {
  it("takes the separator that follows it", () => {
    expect(css.parse(".a { color: red; margin: 0; }").removeAll(code`color: red`).text()).toBe(
      ".a {  margin: 0; }",
    );
  });

  it("takes the separator before it when it is the last declaration", () => {
    expect(css.parse(".a { color: red; margin: 0 }").removeAll(code`margin: 0`).text()).toBe(
      ".a { color: red }",
    );
  });

  it("removes every declaration without two removals fighting over one separator", () => {
    const property = capture("property");
    expect(css.parse(".a { color: red; margin: 0 }").removeAll(code`${property}: ${any()}`).text()).toBe(
      ".a {   }",
    );
  });

  it("leaves the whitespace it did not name", () => {
    expect(css.parse(".a {\n\tcolor: red;\n\tmargin: 0;\n}").removeAll(code`color: red`).text()).toBe(
      ".a {\n\t\n\tmargin: 0;\n}",
    );
  });
});
