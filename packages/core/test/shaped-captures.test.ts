import { describe, expect, it } from "vitest";
import { capture, code, createLanguage, oneOrMore } from "@codestring/core";
import { javascriptAdapter } from "@codestring/javascript";

const js = createLanguage(javascriptAdapter);

describe("a capture can be given a shape", () => {
  const url = capture("url");
  const call = capture("call", code`fetch(${url})`);

  it("binds what the shape matched, and the shape's own captures", () => {
    const match = js.parse("const r = await fetch('/api');").match(code`await ${call}`)!;
    expect(match.get(call).text()).toBe("fetch('/api')");
    expect(match.get(url).text()).toBe("'/api'");
  });

  it("matches nothing when the shape does not fit", () => {
    expect(js.parse("const r = await other('/api');").includes(code`await ${call}`)).toBe(false);
  });

  it("names a sub-shape without needing it to be a node of its own", () => {
    const args = capture("args");
    const logging = capture("logging", code`console.log(${args})`);
    const match = js.parse("if (x) { console.log(a, b); }").match(code`if (x) { ${logging} }`)!;
    expect(match.get(logging).text()).toBe("console.log(a, b)");
    expect(match.get(args).text()).toBe("a, b");
  });

  it("works under a combinator", () => {
    const item = capture("item", code`push(${capture("pushed")})`);
    const body = code`function f() { ${oneOrMore(item)} }`;
    const match = js.parse("function f() { push(1); push(2); }").match(body)!;
    expect(match.getAll(item).map((result) => result.text())).toEqual(["push(1)", "push(2)"]);
  });

  it("keeps the source it bound, byte for byte", () => {
    const source = "await fetch(  '/api' , { mode: 'cors' }  );";
    const anyArgs = capture("anyArgs");
    const shaped = capture("shaped", code`fetch(${anyArgs})`);
    const match = js.parse(source).match(code`await ${shaped}`)!;
    expect(match.transform([match.replace(shaped)`request(${anyArgs})`])).toBe(
      "await request('/api' , { mode: 'cors' });",
    );
  });
});
