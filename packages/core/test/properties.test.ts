import { describe, expect, it } from "vitest";
import {
  type AnyAdapter,
  type LanguageAdapter,
  AdapterContractError,
  SourceDocument,
  applyEdits,
  capture,
  createLanguage,
  exactly,
  replace,
  walk,
} from "@codestring/core";
import { type ToyNode, type ToyParsed, toyAdapter } from "./toy-language.js";

const toy = createLanguage(toyAdapter);

/** Deterministic so a failure is reproducible from the seed alone. */
function randomSource(seed: number): string {
  let state = seed;
  const next = () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
  const atoms = ["a", "bb", "c1", '"str"', "🎉", "; note\n", "\n  ", "(", ")", "x"];
  let text = "";
  const length = 5 + Math.floor(next() * 40);
  for (let i = 0; i < length; i++) text += atoms[Math.floor(next() * atoms.length)];
  return text;
}

describe("invariants over generated sources", () => {
  const sources = Array.from({ length: 120 }, (_, seed) => randomSource(seed + 1));

  it("never throws while parsing, however malformed the input", () => {
    for (const source of sources) {
      expect(() => toy.parse(source)).not.toThrow();
    }
  });

  it("keeps every node inside its parent and inside the document", () => {
    for (const source of sources) {
      const parsed = toy.parse(source);
      for (const node of walk(parsed.root)) {
        expect(node.start).toBeGreaterThanOrEqual(0);
        expect(node.end).toBeLessThanOrEqual(source.length);
        expect(node.end).toBeGreaterThanOrEqual(node.start);
        expect(node.text()).toBe(source.slice(node.start, node.end));
        for (const child of node.children) {
          expect(child.start).toBeGreaterThanOrEqual(node.start);
          expect(child.end).toBeLessThanOrEqual(node.end);
        }
      }
    }
  });

  it("keeps children in source order", () => {
    for (const source of sources) {
      const parsed = toy.parse(source);
      for (const node of walk(parsed.root)) {
        for (let i = 1; i < node.children.length; i++) {
          expect(node.children[i]!.start).toBeGreaterThanOrEqual(node.children[i - 1]!.end);
        }
      }
    }
  });

  it("applying no edits returns the identical string", () => {
    for (const source of sources) {
      const document = new SourceDocument(source);
      expect(applyEdits(document, [])).toBe(source);
    }
  });

  it("an edit changes its own range and nothing around it", () => {
    for (const source of sources) {
      if (source.length < 4) continue;
      const document = new SourceDocument(source);
      const start = 1;
      const end = Math.min(3, source.length);
      const result = applyEdits(document, [replace(document.slice(start, end), "@")]);
      expect(result.slice(0, start)).toBe(source.slice(0, start));
      expect(result.slice(start + 1)).toBe(source.slice(end));
    }
  });

  it("findAll is deterministic and ordered by start offset", () => {
    const pattern = toy.pattern`${exactly(1, capture("node"))}`;
    for (const source of sources) {
      const first = pattern.findAll(source).map((match) => [match.start, match.end]);
      const second = pattern.findAll(source).map((match) => [match.start, match.end]);
      expect(second).toEqual(first);
      for (let i = 1; i < first.length; i++) {
        expect(first[i]![0]!).toBeGreaterThanOrEqual(first[i - 1]![0]!);
      }
    }
  });

  it("a capture always equals the substring it points at", () => {
    const value = capture("value");
    const pattern = toy.pattern`(x ${value})`;
    for (const source of sources) {
      for (const match of pattern.findAll(`${source} (x 1) ${source}`)) {
        const result = match.get(value);
        expect(result.text()).toBe(result.document.text.slice(result.start, result.end));
      }
    }
  });
});

describe("adapter contract enforcement", () => {
  const brokenLanguage = (overrides: Partial<LanguageAdapter<ToyParsed, ToyNode>>) =>
    createLanguage({ ...toyAdapter, id: "broken", ...overrides });

  it("rejects ranges outside the source", () => {
    const language = brokenLanguage({
      range: (node: ToyNode) => ({ start: node.start, end: node.end + 100 }),
    });
    expect(() => language.parse("(a)")).toThrow(AdapterContractError);
  });

  it("rejects a child that escapes its parent", () => {
    const language = brokenLanguage({
      range: (node: ToyNode) =>
        node.kind === "atom" ? { start: 0, end: node.end } : { start: node.start, end: node.end },
    });
    expect(() => language.parse("(x (abc))")).toThrow(/not contained in parent/);
  });

  it("rejects children that are not in source order", () => {
    const language = brokenLanguage({
      children: (node: ToyNode) => [...node.children].reverse(),
    });
    expect(() => language.parse("(a b)")).toThrow(/not in source order/);
  });

  it("rejects a non-integer range", () => {
    const language = brokenLanguage({ range: () => ({ start: 0.5, end: 1 }) });
    expect(() => language.parse("(a)")).toThrow(/integer offsets/);
  });

  it("rejects an empty kind", () => {
    const language = brokenLanguage({ kind: () => "" });
    expect(() => language.parse("(a)")).toThrow(/non-empty string/);
  });

  it("rejects an adapter that is missing a required method", () => {
    const { children: _children, ...incomplete } = toyAdapter;
    expect(() => createLanguage(incomplete as unknown as AnyAdapter)).toThrow(/missing children/);
  });
});
