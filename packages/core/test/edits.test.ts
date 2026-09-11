import { describe, expect, it } from "vitest";
import {
  OverlappingEditError,
  SourceDocument,
  SourceRevisionError,
  applyEdits,
  capture,
  createLanguage,
  insertAfter,
  insertBefore,
  remove,
  replace,
} from "@codestring/core";
import { toyAdapter } from "./toy-language.js";

const toy = createLanguage(toyAdapter);

describe("applyEdits", () => {
  const document = new SourceDocument("(sum 1 2)", "demo.toy");

  it("returns the source unchanged when there is nothing to do", () => {
    expect(applyEdits(document, [])).toBe(document.text);
  });

  it("replaces exactly one range and nothing else", () => {
    expect(applyEdits(document, [replace(document.slice(5, 6), "9")])).toBe("(sum 9 2)");
  });

  it("applies several disjoint edits in one pass", () => {
    const result = applyEdits(document, [
      replace(document.slice(7, 8), "b"),
      replace(document.slice(5, 6), "a"),
    ]);
    expect(result).toBe("(sum a b)");
  });

  it("inserts before and after a range", () => {
    const target = document.slice(5, 6);
    expect(applyEdits(document, [insertBefore(target, "["), insertAfter(target, "]")])).toBe("(sum [1] 2)");
  });

  it("keeps several inserts at one position in the order they were listed", () => {
    const target = document.slice(5, 5);
    expect(applyEdits(document, [insertBefore(target, "a"), insertBefore(target, "b")])).toBe("(sum ab1 2)");
  });

  it("allows an insert at the edge of a replaced range", () => {
    const target = document.slice(5, 8);
    expect(applyEdits(document, [insertBefore(target, "«"), replace(target, "x"), insertAfter(target, "»")])).toBe(
      "(sum «x»)",
    );
  });

  it("refuses partially overlapping edits", () => {
    expect(() =>
      applyEdits(document, [replace(document.slice(1, 5), "a"), replace(document.slice(4, 8), "b")]),
    ).toThrow(OverlappingEditError);
  });

  it("refuses a nested replacement", () => {
    expect(() =>
      applyEdits(document, [replace(document.slice(0, 9), "a"), replace(document.slice(5, 6), "b")]),
    ).toThrow(/overlapping edits/);
  });

  it("refuses two identical replacements", () => {
    const target = document.slice(5, 6);
    expect(() => applyEdits(document, [replace(target, "a"), replace(target, "a")])).toThrow(OverlappingEditError);
  });

  it("names both edits and their positions when it refuses", () => {
    try {
      applyEdits(document, [replace(document.slice(1, 5), "a"), replace(document.slice(4, 8), "b")]);
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).toContain("demo.toy:1:2");
      expect((error as Error).message).toContain("demo.toy:1:5");
    }
  });

  it("refuses an edit that belongs to another document", () => {
    const other = new SourceDocument("(sum 1 2)", "other.toy");
    expect(() => applyEdits(document, [replace(other.slice(5, 6), "x")])).toThrow(SourceRevisionError);
  });

  it("refuses anything that is not an edit value", () => {
    // @ts-expect-error a raw range is not an edit value
    expect(() => applyEdits(document, [{ start: 0, end: 1 }])).toThrow(/edit values/);
  });

  it("removes a range without touching its surroundings", () => {
    expect(applyEdits(document, [remove(document.slice(5, 7))])).toBe("(sum 2)");
  });
});

describe("match.transform", () => {
  it("returns the new text of the whole document", () => {
    const value = capture("value");
    const match = toy.pattern`(x ${value})`.match("(a (x 1) (b))")!;
    expect(match.transform([replace(match.get(value), "9")])).toBe("(a (x 9) (b))");
  });

  it("never mutates the match it came from", () => {
    const value = capture("value");
    const match = toy.pattern`(x ${value})`.match("(x 1)")!;
    match.transform([replace(match.get(value), "999")]);
    expect(match.get(value).text()).toBe("1");
    expect(match.document.text).toBe("(x 1)");
  });

  it("accepts a match itself as an edit target", () => {
    const match = toy.pattern`(x 1)`.match("(a (x 1))")!;
    expect(match.transform([replace(match, "(y 2)")])).toBe("(a (y 2))");
  });

  it("preserves every byte it was not asked to change", () => {
    const source = "(a\r\n\t; keep this\r\n\t(x   1)\r\n)";
    const value = capture("value");
    const match = toy.pattern`(x ${value})`.match(source)!;
    const result = match.transform([replace(match.get(value), "2")]);
    expect(result).toBe(source.replace("(x   1)", "(x   2)"));
    expect(result).toContain("\r\n\t; keep this");
  });
});

describe("edit ordering at one position", () => {
  const document = new SourceDocument("(sum 1 2)");

  it("does not care in which order an insert and a replacement were listed", () => {
    const target = document.slice(5, 8);
    const before = [insertBefore(target, "«"), replace(target, "x")];
    const after = [replace(target, "x"), insertBefore(target, "«")];
    expect(applyEdits(document, before)).toBe("(sum «x)");
    expect(applyEdits(document, after)).toBe("(sum «x)");
  });

  it("still refuses two edits that really overlap, in either order", () => {
    const a = replace(document.slice(1, 5), "a");
    const b = replace(document.slice(4, 8), "b");
    expect(() => applyEdits(document, [a, b])).toThrow(OverlappingEditError);
    expect(() => applyEdits(document, [b, a])).toThrow(OverlappingEditError);
  });
});

describe("a removal and its separator", () => {
  it("yields the separator rather than failing when another edit claims it", () => {
    const document = new SourceDocument("(a) (b)");
    const wide = replace(document.slice(0, 7), "x");
    expect(applyEdits(document, [wide])).toBe("x");
  });

  it("does not extend a removal of a plain source range", () => {
    const document = new SourceDocument("a, b");
    expect(applyEdits(document, [remove(document.slice(0, 1))])).toBe(", b");
  });
});
