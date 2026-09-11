import { describe, expect, it } from "vitest";
import { CodeFragment, capture, code, createLanguage, oneOrMore } from "@codestring/core";
import { toyAdapter } from "./toy-language.js";

const toy = createLanguage(toyAdapter);
const value = capture("value");

describe("code fragments as replacement source", () => {
  it("stays a list of literals and slices until it is flattened", () => {
    const match = toy.parse("(x hello)").match(code`(x ${value})`)!;
    const template = code`(y ${value})`.toTemplate("toy", match);
    expect(template.parts.map((part) => part.type)).toEqual(["literal", "slice", "literal"]);
    expect(template.slices()).toHaveLength(1);
    expect(template.text()).toBe("(y hello)");
  });

  it("inserts the exact source of an interpolated capture", () => {
    const source = '(x   "weird   spacing"  )';
    const match = toy.parse(source).match(code`(x ${value})`)!;
    expect(code`${value}`.toTemplate("toy", match).text()).toBe('"weird   spacing"');
  });

  it("knows it still needs a match", () => {
    const fragment = code`(debug ${value})`;
    const template = fragment.toTemplate("toy");
    expect(template.isDeferred).toBe(true);
    expect(template.captures().map(String)).toEqual(["capture(value)"]);
    expect(() => template.text()).toThrow(/resolve it against a match/);
    expect(() => fragment.text()).toThrow(/resolve it against a match/);
  });

  it("resolves against each match in turn", () => {
    const fragment = code`(debug ${value})`;
    const texts = toy
      .parse("(log a) (log b)")
      .matchAll(code`(log ${value})`)
      .map((match) => fragment.toTemplate("toy", match).text());
    expect(texts).toEqual(["(debug a)", "(debug b)"]);
  });

  it("resolves an unbound handle to nothing", () => {
    const missing = capture("missing");
    const match = toy.parse("(log a)").match(code`(log ${value})`)!;
    expect(code`(debug ${missing})`.toTemplate("toy", match).text()).toBe("(debug )");
  });

  it("refuses a handle that bound more than once", () => {
    const item = capture("item");
    const match = toy.parse("(list a b)").match(code`(list ${oneOrMore(item)})`)!;
    expect(() => code`${item}`.toTemplate("toy", match).text()).toThrow(/matched 2 times/);
  });

  it("refuses a matcher combinator in replacement position", () => {
    const match = toy.parse("(log a)").match(code`(log ${value})`)!;
    expect(() => code`${oneOrMore(value)}`.toTemplate("toy", match)).toThrow(/cannot be written into replacement/);
  });

  it("needs no match when it holds no handles", () => {
    expect(code`(plain)`.text()).toBe("(plain)");
    expect(code`(plain)`.toTemplate("toy").isDeferred).toBe(false);
  });

  it("is the same object in pattern and replacement position", () => {
    const fragment = code`(x ${value})`;
    expect(fragment).toBeInstanceOf(CodeFragment);
    expect(toy.parse("(x a)").includes(fragment)).toBe(true);
    expect(fragment.toTemplate("toy", toy.parse("(x a)").match(fragment)!).text()).toBe("(x a)");
  });
});
