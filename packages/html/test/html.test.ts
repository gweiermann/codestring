import { describe, expect, it } from "vitest";
import { any, capture, code, createLanguage, oneOrMore, zeroOrMore } from "@codestring/core";
import { htmlAdapter } from "@codestring/html";

const html = createLanguage(htmlAdapter);

describe("html parsing", () => {
  it("gives attributes their own container so they cannot mix with content", () => {
    const parsed = html.parse('<div class="a">text</div>');
    const div = parsed.root.children[0]!;
    expect(div.kind).toBe("element:div");
    expect(div.children.map((child) => child.kind)).toEqual(["tag-open", "text", "tag-close"]);
    expect(
      div.children[0]!.children[0]!.children
        .filter((child) => child.kind === "attribute")
        .map((child) => child.text()),
    ).toEqual(['class="a"']);
  });

  it("splits indentation off a text run", () => {
    const parsed = html.parse("<p>\n  hi\n</p>");
    expect(parsed.root.children[0]!.children.map((child) => child.kind)).toEqual([
      "tag-open",
      "whitespace",
      "text",
      "whitespace",
      "tag-close",
    ]);
  });

  it("reads the content of a template element", () => {
    const parsed = html.parse("<template><p>x</p></template>");
    const kinds = parsed.root.children[0]!.children.map((child) => child.kind);
    expect(kinds).toEqual(["tag-open", "element:p", "tag-close"]);
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
    expect(pattern.match("<a href='x'>link</a>")).not.toBeNull();
    expect(pattern.match('<a   href="x" >link</a>')).not.toBeNull();
    expect(pattern.match('<a href="y">link</a>')).toBeNull();
  });

  it("splits an attribute into its name and its value", () => {
    const attribute = html
      .parse('<div class="a b">x</div>')
      .root.children[0]!.children[0]!.children[0]!.children.find((child) => child.kind === "attribute")!;
    expect(attribute.children.map((child) => [child.kind, child.text()])).toEqual([
      ["attribute-name", "class"],
      ["attribute-value", "a b"],
    ]);
  });

  it("gives a valueless attribute only a name", () => {
    const attribute = html
      .parse("<input disabled>")
      .root.children[0]!.children[0]!.children[0]!.children.find((child) => child.kind === "attribute")!;
    expect(attribute.children.map((child) => child.kind)).toEqual(["attribute-name"]);
  });

  it("puts a hole on either side of the equals sign", () => {
    const value = capture("value");
    const name = capture("name");
    expect(html.parse('<div class="card">x</div>').match(code`<div class="${value}">${any()}</div>`)!.get(value).text()).toBe(
      "card",
    );
    expect(html.parse('<div class="card">x</div>').match(code`<div ${name}="card">${any()}</div>`)!.get(name).text()).toBe(
      "class",
    );
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

describe("the tags are nodes", () => {
  it("names the opening and closing tags", () => {
    const parsed = html.parse('<div class="a">text</div>');
    const [opening, content, closing] = parsed.root.children[0]!.children;
    expect(opening!.kind).toBe("tag-open");
    expect(opening!.text()).toBe('<div class="a">');
    expect(content!.text()).toBe("text");
    expect(closing!.text()).toBe("</div>");
  });

  it("keeps the attributes inside the opening tag", () => {
    const parsed = html.parse('<div class="a" id="b">x</div>');
    const attributes = parsed.root.children[0]!.children[0]!.children[0]!;
    expect(attributes.kind).toBe("attributes");
    expect(
      attributes.children.filter((child) => child.kind === "attribute").map((child) => child.text()),
    ).toEqual(['class="a"', 'id="b"']);
  });

  it("gives a void element no closing tag", () => {
    const parsed = html.parse("<br>");
    expect(parsed.root.children[0]!.children.map((child) => child.kind)).toEqual(["tag-open"]);
  });

  it("lets a rewrite swap two elements by their tags alone", () => {
    const inner = capture("inner");
    const source = '<sw-block name="a">\n  <template #default>\n    <p>x</p>\n  </template>\n</sw-block>';
    const match = html.parse(source).match(code`<sw-block ${any()}>${inner}</sw-block>`)!;
    const block = match.nodes[0]!;
    const child = match.get(inner).nodes.find((node) => node.kind.startsWith("element:"))!;

    const result = match.transform([
      match.replace(block.children[0]!)`${child.children[0]!.slice()}`,
      match.replace(block.children[block.children.length - 1]!)`${child.children[child.children.length - 1]!.slice()}`,
      match.replace(child.children[0]!)`${block.children[0]!.slice()}`,
      match.replace(child.children[child.children.length - 1]!)`${block.children[block.children.length - 1]!.slice()}`,
    ]);
    expect(result).toBe(
      '<template #default>\n  <sw-block name="a">\n    <p>x</p>\n  </sw-block>\n</template>',
    );
  });
});
