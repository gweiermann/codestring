import { describe, expect, it } from "vitest";
import { any, capture, createLanguage, oneOrMore, zeroOrMore } from "@codestring/core";
import { htmlAdapter } from "@codestring/html";

const html = createLanguage(htmlAdapter);

describe("html parsing", () => {
  it("gives attributes their own container so they cannot mix with content", () => {
    const parsed = html.parse('<div class="a">text</div>');
    const div = parsed.root.children[0]!;
    expect(div.kind).toBe("element:div");
    expect(div.children.map((child) => child.kind)).toEqual(["attributes", "text"]);
    expect(div.children[0]!.children.map((child) => child.text())).toEqual(['class="a"']);
  });

  it("splits indentation off a text run", () => {
    const parsed = html.parse("<p>\n  hi\n</p>");
    expect(parsed.root.children[0]!.children.map((child) => child.kind)).toEqual([
      "attributes",
      "whitespace",
      "text",
      "whitespace",
    ]);
  });

  it("reads the content of a template element", () => {
    const parsed = html.parse("<template><p>x</p></template>");
    const kinds = parsed.root.children[0]!.children.map((child) => child.kind);
    expect(kinds).toEqual(["attributes", "element:p"]);
  });

  it("marks comments as trivia", () => {
    const parsed = html.parse("<!-- note -->");
    expect(parsed.root.children[0]!.trivia).toBe("comment");
  });

  it("reports malformed markup without throwing", () => {
    const parsed = html.parse("<div class=>");
    expect(parsed.diagnostics.length).toBeGreaterThan(0);
  });
});

describe("html matching", () => {
  const inner = capture("inner");

  it("matches an element and captures its content", () => {
    const match = html.pattern`<template${any()}>${inner}</template>`.match(
      '<section><template class="x">\n  <p>hi</p>\n</template></section>',
    )!;
    expect(match.get(inner).text()).toBe("<p>hi</p>");
  });

  it("is strict about attributes unless the pattern allows them", () => {
    const strict = html.pattern`<template>${inner}</template>`;
    expect(strict.match("<template><p>x</p></template>")).not.toBeNull();
    expect(strict.match('<template class="x"><p>x</p></template>')).toBeNull();
  });

  it("captures an attribute run", () => {
    const attributes = capture("attributes");
    const match = html.pattern`<div ${attributes}>${any()}</div>`.match('<div class="a" id="b">x</div>')!;
    expect(match.get(attributes).text()).toBe('class="a" id="b"');
  });

  it("matches regardless of attribute quoting and spacing", () => {
    const pattern = html.pattern`<a href="x">${inner}</a>`;
    expect(pattern.match("<a href='x'>link</a>")).toBeNull();
    expect(pattern.match('<a   href="x" >link</a>')).not.toBeNull();
  });

  it("finds nested occurrences of the same element", () => {
    const matches = html.pattern`<div>${zeroOrMore(any())}</div>`.findAll("<div><div>x</div></div>");
    expect(matches).toHaveLength(2);
    expect(matches[0]!.text()).toBe("<div><div>x</div></div>");
  });

  it("collects list items one by one", () => {
    const item = capture("item");
    const match = html.pattern`<ul>${oneOrMore(item)}</ul>`.match("<ul>\n  <li>a</li>\n  <li>b</li>\n</ul>")!;
    expect(match.getAll(item).map((result) => result.text())).toEqual(["<li>a</li>", "<li>b</li>"]);
  });

  it("keeps a comment significant unless trivia is ignored", () => {
    const source = "<p><!-- why -->x</p>";
    expect(html.pattern`<p>x</p>`.match(source)).toBeNull();
    expect(html.pattern({ trivia: "ignore" })`<p>x</p>`.match(source)).not.toBeNull();
  });

  it("matches text content flexibly but not loosely", () => {
    expect(html.pattern`<p>hello world</p>`.match("<p>hello   world</p>")).not.toBeNull();
    expect(html.pattern`<p>hello world</p>`.match("<p>hello worlds</p>")).toBeNull();
  });
});

describe("html transforms", () => {
  it("rewrites one element and leaves the rest of the file alone", () => {
    const inner = capture("inner");
    const source = "<div>\r\n\t<template>\r\n\t\t<p>keep\tthis</p>\r\n\t</template>\r\n</div>\r\n";
    const match = html.pattern`<template>${inner}</template>`.match(source)!;
    const result = match.transform([
      match.replace(inner)`<sw-block>${inner}</sw-block>`,
    ]);
    expect(result).toBe(source.replace("<p>keep\tthis</p>", "<sw-block><p>keep\tthis</p></sw-block>"));
    expect(result).toContain("\r\n\t\t");
  });
});
