import { describe, expect, it } from "vitest";
import { SourceDocument, SourceSlice, SourceRevisionError } from "@codestring/core";

describe("SourceDocument", () => {
  it("reports 1-based line and column for an offset", () => {
    const document = new SourceDocument("one\ntwo\nthree", "demo.txt");
    expect(document.positionAt(0)).toEqual({ line: 1, column: 1 });
    expect(document.positionAt(4)).toEqual({ line: 2, column: 1 });
    expect(document.positionAt(6)).toEqual({ line: 2, column: 3 });
    expect(document.positionAt(8)).toEqual({ line: 3, column: 1 });
  });

  it("round-trips offsetAt and positionAt", () => {
    const document = new SourceDocument("alpha\n  beta\n\ngamma");
    for (let offset = 0; offset <= document.length; offset++) {
      expect(document.offsetAt(document.positionAt(offset))).toBe(offset);
    }
  });

  it("clamps positions outside the document", () => {
    const document = new SourceDocument("abc");
    expect(document.positionAt(-5)).toEqual({ line: 1, column: 1 });
    expect(document.positionAt(99)).toEqual({ line: 1, column: 4 });
  });

  it("counts UTF-16 code units, so a non-BMP character is two offsets wide", () => {
    const document = new SourceDocument('a="🎉"');
    expect(document.length).toBe(6);
    expect(document.slice(3, 5).text()).toBe("🎉");
    expect(document.positionAt(5)).toEqual({ line: 1, column: 6 });
  });
});

describe("SourceSlice", () => {
  it("keeps its absolute position in the document", () => {
    const document = new SourceDocument("hello world");
    const slice = document.slice(6, 11);
    expect(slice.text()).toBe("world");
    expect(slice.start).toBe(6);
    expect(slice.length).toBe(5);
    expect(slice.position()).toEqual({ line: 1, column: 7 });
  });

  it("refuses ranges outside the document", () => {
    const document = new SourceDocument("short");
    expect(() => new SourceSlice(document, 0, 99)).toThrow(SourceRevisionError);
    expect(() => new SourceSlice(document, 4, 2)).toThrow(SourceRevisionError);
  });

  it("always equals the corresponding substring", () => {
    const text = "the quick brown fox\njumps over\n";
    const document = new SourceDocument(text);
    for (let start = 0; start < text.length; start += 3) {
      for (let end = start; end < text.length; end += 5) {
        expect(document.slice(start, end).text()).toBe(text.slice(start, end));
      }
    }
  });
});
