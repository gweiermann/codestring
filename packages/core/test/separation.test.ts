import { describe, expect, it } from "vitest";
import { any, capture, code, createLanguage } from "@codestring/core";
import { javascriptAdapter } from "@codestring/javascript";
import { htmlAdapter } from "@codestring/html";

const js = createLanguage(javascriptAdapter);
const html = createLanguage(htmlAdapter);
const value = capture("value");

describe("an insert keeps the list it lands in well formed", () => {
  it("reads the separator off an argument list", () => {
    const match = js.parse("foo(a, b);").match(code`foo(${value})`)!;
    const last = match.get(value).nodes[1]!;
    expect(match.transform([match.insertAfter(last)`c`])).toBe("foo(a, b, c);");
  });

  it("reads the separator off an attribute list, which is a space", () => {
    const match = html.parse(`<div class="a" id="b">x</div>`).match(code`<div ${any()}>${any()}</div>`)!;
    const attributes = match.nodes[0]!.children[0]!;
    const last = attributes.children[attributes.children.length - 1]!;
    expect(match.transform([match.insertAfter(last)`v-if="x"`])).toBe(
      `<div class="a" id="b" v-if="x">x</div>`,
    );
  });

  it("carries the indentation a statement list separates with", () => {
    const source = "function f() {\n    a();\n    b();\n}";
    const statements = capture("statements");
    const match = js.parse(source).match(code`function f() { ${statements} }`)!;
    const first = match.get(statements).nodes[0]!;
    expect(match.transform([match.insertAfter(first)`c()`])).toBe(
      "function f() {\n    a();\n    c();\n    b();\n}",
    );
  });

  it("does nothing when the text already carries the separation", () => {
    const match = html.parse(`<div class="a" id="b">x</div>`).match(code`<div ${any()}>${any()}</div>`)!;
    const attributes = match.nodes[0]!.children[0]!;
    const last = attributes.children[attributes.children.length - 1]!;
    expect(match.transform([match.insertAfter(last)` v-if="x"`])).toBe(
      `<div class="a" id="b" v-if="x">x</div>`,
    );
  });

  it("separates two things that would fuse into one word", () => {
    const match = js.parse("const a = 1;").match(code`const ${value} = 1`)!;
    const name = match.get(value).nodes[0]!;
    expect(match.transform([match.insertAfter(name)`b`])).toBe("const a b = 1;");
  });

  it("separates nothing when the two sides cannot fuse", () => {
    const match = js.parse("a.b();").match(code`a.b()`)!;
    const call = match.nodes[0]!;
    expect(match.transform([match.insertAfter(call)`;`])).toBe("a.b();;");
  });

  it("leaves an insert next to something that is not in a list alone", () => {
    const match = js.parse("log(x);").match(code`log(${value})`)!;
    expect(match.transform([match.insertBefore`// note\n`])).toBe("// note\nlog(x);");
  });
});
