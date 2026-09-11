import { describe, expect, it } from "vitest";
import { capture, code, createLanguage, exactly, oneOrMore } from "@codestring/core";
import { toyAdapter } from "./toy-language.js";

const toy = createLanguage(toyAdapter);
const value = capture("value");

describe("a parsed document answers the questions a string answers", () => {
  const document = toy.parse("(a (log x) (b) (log y))");

  it("includes() asks in syntax, not characters", () => {
    expect(document.includes(code`(log ${value})`)).toBe(true);
    expect(document.includes(code`(missing ${value})`)).toBe(false);
  });

  it("does not match text that only looks right", () => {
    expect(toy.parse('(say "(log x)")').includes(code`(log ${value})`)).toBe(false);
  });

  it("counts occurrences", () => {
    expect(document.count(code`(log ${value})`)).toBe(2);
    expect(document.count(code`(nope)`)).toBe(0);
  });

  it("indexOf returns an offset in the document, or -1", () => {
    expect(document.indexOf(code`(log ${value})`)).toBe(3);
    expect(document.indexOf(code`(log ${value})`, 4)).toBe(15);
    expect(document.indexOf(code`(nope)`)).toBe(-1);
    expect(document.lastIndexOf(code`(log ${value})`)).toBe(15);
  });

  it("match and matchAll behave like their String counterparts", () => {
    expect(document.match(code`(log ${value})`)!.text()).toBe("(log x)");
    expect(document.matchAll(code`(log ${value})`).map((match) => match.text())).toEqual(["(log x)", "(log y)"]);
    expect(document.match(code`(nope)`)).toBeNull();
  });

  it("equals() is true only when the pattern covers the whole region", () => {
    expect(toy.parse("(log x)").equals(code`(log ${value})`)).toBe(true);
    expect(document.equals(code`(log ${value})`)).toBe(false);
  });

  it("reads its own text and length", () => {
    expect(toy.parse("(a b)").text()).toBe("(a b)");
    expect(toy.parse("(a b)").length).toBe(5);
    expect(String(toy.parse("(a b)"))).toBe("(a b)");
  });

  it("finds the innermost node at an offset", () => {
    expect(document.nodeAt(5)!.kind).toBe("atom");
    expect(document.nodeAt(5)!.text()).toBe("log");
  });
});

describe("rewriting returns a new document", () => {
  it("replace takes the first match, replaceAll takes every one", () => {
    const document = toy.parse("(log a) (log b)");
    expect(document.replace(code`(log ${value})`, code`(debug ${value})`).text()).toBe("(debug a) (log b)");
    expect(document.replaceAll(code`(log ${value})`, code`(debug ${value})`).text()).toBe("(debug a) (debug b)");
  });

  it("never mutates the document it came from", () => {
    const document = toy.parse("(log a)");
    document.replaceAll(code`(log ${value})`, code`(debug ${value})`);
    expect(document.text()).toBe("(log a)");
  });

  it("chains, because each step hands back a parsed document", () => {
    const result = toy
      .parse("(log a) (warn b) (drop c)")
      .replaceAll(code`(log ${value})`, code`(debug ${value})`)
      .replaceAll(code`(warn ${value})`, code`(notice ${value})`)
      .removeAll(code`(drop ${value})`)
      .text();
    expect(result).toBe("(debug a) (notice b) ");
  });

  it("keeps every byte it was not asked to change", () => {
    const source = "(a\r\n\t; keep\r\n\t(log   x)\r\n)";
    const result = toy.parse(source).replaceAll(code`(log ${value})`, code`(debug ${value})`).text();
    expect(result).toBe(source.replace("(log   x)", "(debug x)"));
  });

  it("takes a plain string as the replacement", () => {
    expect(toy.parse("(log a)").replace(code`(log ${value})`, "(nothing)").text()).toBe("(nothing)");
  });

  it("takes a function that decides per match", () => {
    const result = toy
      .parse("(log a) (log skip)")
      .replaceAll(code`(log ${value})`, (match) =>
        match.get(value).text() === "skip" ? null : match.replace`(debug ${value})`,
      )
      .text();
    expect(result).toBe("(debug a) (log skip)");
  });

  it("inserts before and after every match", () => {
    expect(toy.parse("(log a)").insertBefore(code`(log ${value})`, "; before\n").text()).toBe("; before\n(log a)");
    expect(toy.parse("(log a)").insertAfter(code`(log ${value})`, " ; after").text()).toBe("(log a) ; after");
  });

  it("remove takes the first match and removeAll takes them all", () => {
    const document = toy.parse("(log a) (log b)");
    expect(document.remove(code`(log ${value})`).text()).toBe(" (log b)");
    expect(document.removeAll(code`(log ${value})`).text()).toBe(" ");
  });

  it("returns itself when nothing matched", () => {
    const document = toy.parse("(a)");
    expect(document.replaceAll(code`(nope)`, "x")).toBe(document);
  });

  it("reports the edits a rewrite would make", () => {
    expect(toy.parse("(log a) (log b)").edits(code`(log ${value})`, code`(debug ${value})`)).toHaveLength(2);
  });

  it("refuses two rewrites that would touch the same range", () => {
    const document = toy.parse("(log (log a))");
    const nested = document.edits(code`(log ${value})`, code`(debug ${value})`);
    expect(() => document.applyEdits(nested)).toThrow(/overlapping edits/);
  });
});

describe("a nested parse rewrites the file it came from", () => {
  const source = "(doc (log x) (tail))";

  it("keeps covering its own region while the document grows", () => {
    const outer = toy.parse(source);
    const payload = outer.match(code`(doc ${exactly(1, value)} ${capture("rest")})`)!.get(value);
    const inner = toy.parse(payload);

    expect(inner.text()).toBe("(log x)");
    expect(inner.start).toBe(5);

    const rewritten = inner.replaceAll(code`(log ${capture("x")})`, "(debug x y)");
    expect(rewritten.document.text).toBe("(doc (debug x y) (tail))");
    expect(rewritten.text()).toBe("(debug x y)");
    expect(rewritten.start).toBe(5);
  });

  it("leaves the outer document it came from untouched", () => {
    const outer = toy.parse(source);
    const payload = outer.match(code`(doc ${exactly(1, value)} ${capture("rest")})`)!.get(value);
    toy.parse(payload).replaceAll(code`(log ${capture("x")})`, "(debug x)");
    expect(outer.text()).toBe(source);
  });
});

describe("the same fragment works in every language that can parse it", () => {
  it("compiles once per language and caches the result", () => {
    const fragment = code`(log ${value})`;
    const other = createLanguage({ ...toyAdapter, id: "toy-copy" });
    expect(toy.parse("(log a)").includes(fragment)).toBe(true);
    expect(other.parse("(log a)").includes(fragment)).toBe(true);
    expect(fragment.compile(toy)).toBe(fragment.compile(toy));
    expect(fragment.compile(toy)).not.toBe(fragment.compile(other));
  });

  it("carries per-fragment options", () => {
    const source = "(sum 1 ; why\n 2)";
    expect(toy.parse(source).includes(code`(sum 1 2)`)).toBe(false);
    expect(toy.parse(source).includes(code({ trivia: "ignore" })`(sum 1 2)`)).toBe(true);
  });

  it("still tracks capture cardinality through the fragment", () => {
    const item = capture("item");
    const match = toy.parse("(list a b)").match(code`(list ${oneOrMore(item)})`)!;
    expect(match.getAll(item).map((result) => result.text())).toEqual(["a", "b"]);
  });
});

describe("inside", () => {
  /** A second grammar, so the embedded case is tested across a real boundary. */
  const upper = createLanguage({
    ...toyAdapter,
    id: "shout",
    parse: (source: string) => ({
      root: {
        kind: "line",
        start: 0,
        end: source.length,
        children: source
          .split(" ")
          .map((word, index, all) => {
            const start = all.slice(0, index).reduce((sum, part) => sum + part.length + 1, 0);
            return { kind: "word", start, end: start + word.length, children: [], trivia: null, error: false };
          })
          .filter((word) => word.end > word.start),
        trivia: null,
        error: false,
      },
      diagnostics: [],
    }),
    isVariadic: (kind: string) => kind === "line",
  });

  it("re-reads a captured region with another language and splices it back", () => {
    const result = toy
      .parse('(doc "hello world" (tail))')
      .inside(
        (block) => code`(doc ${exactly(1, block)} ${capture("rest")})`,
        upper,
        (inner) => inner.text().toUpperCase(),
      )
      .text();
    expect(result).toBe('(doc "HELLO WORLD" (tail))');
  });

  it("rewrites several regions in one pass without their offsets drifting", () => {
    const result = toy
      .parse("(a (log x) (b) (log y))")
      .inside(
        (block) => code`(log ${block})`,
        toy,
        (inner) => inner.replaceAll(code`${exactly(1, capture("atom"))}`, "renamed"),
      )
      .text();
    expect(result).toBe("(a (log renamed) (b) (log renamed))");
  });

  it("leaves a region its rewrite declined to change", () => {
    const document = toy.parse("(log a) (log b)");
    const result = document.inside(
      (block) => code`(log ${block})`,
      toy,
      (inner) => (inner.text() === "a" ? "z" : null),
    );
    expect(result.text()).toBe("(log z) (log b)");
  });

  it("returns the same document when nothing matched", () => {
    const document = toy.parse("(a)");
    expect(document.inside((block) => code`(log ${block})`, toy, (inner) => inner)).toBe(document);
  });

  it("refuses a region pattern that ignores the capture it was handed", () => {
    expect(() =>
      toy.parse("(log a)").inside(
        () => code`(log ${capture("mine")})`,
        toy,
        (inner) => inner,
      ),
    ).toThrow(/does not use the capture it was handed/);
  });

  it("hands the outer match to the rewrite as well", () => {
    const name = capture("name");
    const result = toy
      .parse("(log hello world)")
      .inside(
        (block) => code`(${exactly(1, name)} ${block})`,
        toy,
        (inner, match) => `${match.get(name).text()}:${inner.text()}`,
      )
      .text();
    expect(result).toBe("(log log:hello world)");
  });

  it("nests as deep as the source does", () => {
    const result = toy
      .parse("(outer (middle (inner x)))")
      .inside(
        (block) => code`(outer ${block})`,
        toy,
        (middle) =>
          middle.inside(
            (block) => code`(middle ${block})`,
            toy,
            (inner) => inner.replaceAll(code`(inner ${capture("v")})`, "(inner deep)"),
          ),
      )
      .text();
    expect(result).toBe("(outer (middle (inner deep)))");
  });
});
