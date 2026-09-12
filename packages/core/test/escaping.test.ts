import { describe, expect, it } from "vitest";
import { capture, code, createLanguage } from "@codestring/core";
import { javascriptAdapter } from "@codestring/javascript";
import { htmlAdapter } from "@codestring/html";

const js = createLanguage(javascriptAdapter);
const html = createLanguage(htmlAdapter);
const value = capture("value");

describe("a plain value is escaped for wherever it lands", () => {
  it("cannot end the string literal it was written into", () => {
    const label = `He said "stop"`;
    const result = js.parse("log(x);").replaceAll(code`log(${value})`, code`log("${label}")`).text();
    expect(result).toBe(`log("He said \\"stop\\"");`);
    expect(js.parse(result).hasErrors()).toBe(false);
  });

  it("cannot break out with a backslash or a newline", () => {
    const nasty = 'a\\b\nc';
    const result = js.parse("log(x);").replaceAll(code`log(${value})`, code`log("${nasty}")`).text();
    expect(js.parse(result).hasErrors()).toBe(false);
    expect(result).toContain("\\\\b\\n");
  });

  it("cannot end a template literal either", () => {
    const nasty = "a`b${c}";
    const result = js.parse("log(x);").replaceAll(code`log(${value})`, code`log(\`${nasty}\`)`).text();
    expect(js.parse(result).hasErrors()).toBe(false);
  });

  it("is left alone where escaping would be wrong", () => {
    const result = js.parse("log(x);").replaceAll(code`log(${value})`, code`log(${"someIdentifier"})`).text();
    expect(result).toBe("log(someIdentifier);");
  });

  it("cannot open a tag from inside markup", () => {
    const injected = "<script>alert(1)</script>";
    const result = html.parse("<p>x</p>").replaceAll(code`<p>${value}</p>`, code`<p>${injected}</p>`).text();
    expect(result).toBe("<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>");
  });

  it("cannot close an attribute", () => {
    const injected = 'a" onclick="steal()';
    const result = html
      .parse("<p title=x>y</p>")
      .replaceAll(code`<p title=x>${value}</p>`, code`<p title="${injected}">ok</p>`)
      .text();
    expect(result).toContain("&quot;");
    expect(result).not.toContain('onclick="steal()"');
  });
});

describe("source keeps its provenance", () => {
  it("never escapes a captured slice, however it is spelled", () => {
    const source = `log("He said \\"stop\\"");`;
    const result = js.parse(source).replaceAll(code`log(${value})`, code`debug(${value})`).text();
    expect(result).toBe(`debug("He said \\"stop\\"");`);
  });

  it("keeps markup a capture bound, rather than encoding it", () => {
    const result = html
      .parse("<p><b>bold</b></p>")
      .replaceAll(code`<p>${value}</p>`, code`<div>${value}</div>`)
      .text();
    expect(result).toBe("<div><b>bold</b></div>");
  });
});
