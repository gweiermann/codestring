import { describe, expect, it } from "vitest";
import { capture, createLanguage, exactly, replace } from "@codestring/core";
import { toyAdapter } from "./toy-language.js";

interface CsvNode {
  kind: string;
  start: number;
  end: number;
  children: CsvNode[];
}

interface CsvParsed {
  root: CsvNode;
}

/** A second grammar, so composition is tested across real adapter boundaries. */
const csvAdapter = {
  id: "csv",
  parse(source: string) {
    const children = [];
    let start = 0;
    for (const field of source.split(",")) {
      children.push({ kind: "cell", start, end: start + field.length, children: [] });
      start += field.length + 1;
    }
    return { root: { kind: "row", start: 0, end: source.length, children } };
  },
  root: (parsed: CsvParsed) => parsed.root,
  kind: (node: CsvNode) => node.kind,
  range: (node: CsvNode) => ({ start: node.start, end: node.end }),
  children: (node: CsvNode) => node.children,
  isVariadic: (kind: string) => kind === "row",
};

const toy = createLanguage(toyAdapter);
const csv = createLanguage(csvAdapter);

const source = '(record "a,b,c" (note x))';

describe("nested language composition", () => {
  it("reports nested matches in offsets of the original document", () => {
    const payload = capture("payload");
    const outer = toy.pattern`(record ${payload} (note ${capture("note")}))`.match(source)!;
    const slice = outer.get(payload);
    expect(slice.text()).toBe('"a,b,c"');
    expect([slice.start, slice.end]).toEqual([8, 15]);

    const cell = capture("cell");
    const cells = csv.pattern`${exactly(1, cell)}`.findAll(slice);
    expect(cells.map((match) => match.text())).toEqual(['"a', "b", 'c"']);
    expect(cells.map((match) => match.start)).toEqual([8, 11, 13]);
    expect(cells[1]!.document).toBe(outer.document);
  });

  it("edits from a nested match target the root document", () => {
    const payload = capture("payload");
    const outer = toy.pattern`(record ${payload} (note ${capture("note")}))`.match(source)!;
    const cell = capture("cell");
    const cells = csv.pattern`${exactly(1, cell)}`.findAll(outer.get(payload));
    const result = cells[1]!.transform([replace(cells[1]!.get(cell), "B")]);
    expect(result).toBe('(record "a,B,c" (note x))');
  });

  it("maps offsets through two levels of nesting", () => {
    const payload = capture("payload");
    const outer = toy.pattern`(record ${payload} (note ${capture("note")}))`.match(source)!;
    const cell = capture("cell");
    const middle = csv.pattern`${exactly(1, cell)}`.findAll(outer.get(payload))[1]!;
    const inner = csv.pattern`${exactly(1, capture("again"))}`.match(middle.get(cell))!;
    expect(inner.text()).toBe("b");
    expect(inner.start).toBe(11);
    expect(inner.transform([replace(inner, "BETA")])).toBe('(record "a,BETA,c" (note x))');
  });

  it("a slice keeps its document identity so the two languages share one file", () => {
    const payload = capture("payload");
    const outer = toy.pattern`(record ${payload} (note ${capture("note")}))`.match(source)!;
    const slice = outer.get(payload);
    expect(slice.document.text.slice(slice.start, slice.end)).toBe(slice.text());
  });
});
