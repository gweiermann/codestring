import { describe, expect, it } from "vitest";
import {
  PatternCompileError,
  any,
  capture,
  createLanguage,
  exactly,
  oneOf,
  oneOrMore,
  optional,
  zeroOrMore,
} from "@codestring/core";
import { toyAdapter } from "./toy-language.js";

const toy = createLanguage(toyAdapter);

describe("pattern compilation", () => {
  it("compiles literal syntax into a structural tree", () => {
    const pattern = toy.pattern`(sum 1 2)`;
    expect(pattern.debug()).toContain("list");
    expect(pattern.debug()).toContain('atom "sum"');
  });

  it("infers a sibling run for a hole in a variadic position", () => {
    const body = capture("body");
    expect(toy.pattern`(list ${body})`.debug()).toContain("0..∞ nodes as one slice");
  });

  it("reports the inferred cardinality of each combinator", () => {
    const item = capture("item");
    expect(toy.pattern`(a ${optional(item)})`.debug()).toContain("optional → 0..1");
    expect(toy.pattern`(a ${oneOrMore(item)})`.debug()).toContain("oneOrMore → 1..∞");
    expect(toy.pattern`(a ${zeroOrMore(item)})`.debug()).toContain("zeroOrMore → 0..∞");
    expect(toy.pattern`(a ${exactly(2, item)})`.debug()).toContain("exactly(2) → 2..2");
  });

  it("rejects the same capture handle in two positions of one pattern", () => {
    const x = capture("x");
    expect(() => toy.pattern`(pair ${x} ${x})`.compiled).toThrow(PatternCompileError);
    expect(() => toy.pattern`(pair ${x} ${x})`.compiled).toThrow(/more than one position/);
  });

  it("allows the same handle in exclusive alternatives", () => {
    const x = capture("x");
    expect(() => toy.pattern`(one ${oneOf(x, capture("y"))})`.compiled).not.toThrow();
  });

  it("rejects a repetition that can match nothing", () => {
    const x = capture("x");
    // @ts-expect-error a repetition cannot wrap another repetition
    expect(() => oneOrMore(optional(x))).toThrow(PatternCompileError);
    // @ts-expect-error a repetition cannot wrap another repetition
    expect(() => zeroOrMore(zeroOrMore(x))).toThrow(/repeats something that can already match nothing/);
  });

  it("rejects an empty pattern", () => {
    expect(() => toy.pattern``.compiled).toThrow(/empty/);
  });

  it("rejects a pattern the language cannot parse", () => {
    expect(() => toy.pattern`(unclosed`.compiled).toThrow(PatternCompileError);
  });

  it("rejects an interpolated value that is not a pattern value", () => {
    // @ts-expect-error a plain object is not a pattern value
    expect(() => toy.pattern`(a ${{ nope: true }})`.compiled).toThrow(/interpolate a capture/);
  });

  it("splices another pattern of the same language", () => {
    const inner = toy.pattern`(inner ${capture("x")})`;
    const outer = toy.pattern`(outer ${inner})`;
    expect(outer.compiled.source).toBe("(outer (inner cshole0))");
  });

  it("refuses a pattern from another language", () => {
    const other = createLanguage({ ...toyAdapter, id: "toy2" });
    expect(() => toy.pattern`(a ${other.pattern`(b)`})`.compiled).toThrow(/cross-language/);
  });

  it("interpolates literal text verbatim", () => {
    expect(toy.pattern`(a ${"b"} ${1})`.compiled.source).toBe("(a b 1)");
  });

  it("rejects an unknown trivia policy", () => {
    // @ts-expect-error "loose" is not one of the three policies
    expect(() => toy.pattern({ trivia: "loose" })`(a)`.compiled).toThrow(/unknown trivia policy/);
  });

  it("requires a sub-pattern inside a combinator to be a single node", () => {
    const two = toy.pattern`(a) (b)`;
    expect(() => toy.pattern`(x ${oneOrMore(two)})`.compiled).toThrow(/exactly one node/);
  });

  it("keeps any() unbound but still structural", () => {
    expect(toy.pattern`(a ${any()})`.debug()).toContain("any → 0..∞");
  });
});
