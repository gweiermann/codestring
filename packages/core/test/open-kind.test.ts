import { describe, expect, it } from "vitest";
import { any, capture, code, createLanguage } from "@codestring/core";
import { htmlAdapter } from "@codestring/html";

const html = createLanguage(htmlAdapter);
const body = capture("body");

describe("a hole can stand in for a node's kind", () => {
  it("matches any element with the attributes and content the pattern names", () => {
    const pattern = code`<${any()} class="x">${body}</${any()}>`;
    expect(html.parse('<div class="x">a</div>').includes(pattern)).toBe(true);
    expect(html.parse('<section class="x">a</section>').includes(pattern)).toBe(true);
    expect(html.parse('<div class="y">a</div>').includes(pattern)).toBe(false);
  });

  it("still matches what is inside", () => {
    const pattern = code`<${any()}>${body}</${any()}>`;
    const match = html.parse("<aside><p>hi</p></aside>").match(pattern)!;
    expect(match.get(body).text()).toBe("<p>hi</p>");
  });

  it("binds the whole node when the open kind is captured", () => {
    const element = capture("element");
    const match = html.parse('<custom-tag class="x">a</custom-tag>').match(
      code`<${element} class="x">${body}</${any()}>`,
    )!;
    expect(match.get(element).text()).toBe('<custom-tag class="x">a</custom-tag>');
    expect(match.get(element).kinds()).toEqual(["element:custom-tag"]);
  });

  it("says so in debug output", () => {
    expect(code`<${any()} class="x">${body}</${any()}>`.compile(html as never).debug()).toContain("any kind");
  });

  it("rewrites what it matched, keeping the source", () => {
    const result = html
      .parse('<weird-tag class="x">  keep  </weird-tag>')
      .replaceAll(code`<${any()} class="x">${body}</${any()}>`, code`<p>${body}</p>`)
      .text();
    expect(result).toBe("<p>keep</p>");
  });
});
