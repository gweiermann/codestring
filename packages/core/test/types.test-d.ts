import { describe, expectTypeOf, it } from "vitest";
import {
  type CaptureResult,
  type Language,
  type Match,
  type MatchOf,
  any,
  between,
  capture,
  createLanguage,
  exactly,
  oneOf,
  oneOrMore,
  optional,
  zeroOrMore,
} from "@codestring/core";
import { toyAdapter, type ToyNode } from "./toy-language.js";

const toy = createLanguage(toyAdapter);

describe("capture cardinality is visible in the types", () => {
  it("a bare capture always binds, so get() cannot be undefined", () => {
    const name = capture("name");
    const match = toy.pattern`(hello ${name})`.match("(hello world)")!;
    expectTypeOf(match.get(name)).toEqualTypeOf<CaptureResult<ToyNode>>();
  });

  it("an optional capture may be missing", () => {
    const maybe = capture("maybe");
    const match = toy.pattern`(a ${optional(maybe)})`.match("(a)")!;
    expectTypeOf(match.get(maybe)).toEqualTypeOf<CaptureResult<ToyNode> | undefined>();
  });

  it("exactly(1, ...) is a single capture, exactly(2, ...) is not", () => {
    const one = capture("one");
    const two = capture("two");
    const single = toy.pattern`(a ${exactly(1, one)})`.match("(a x)")!;
    expectTypeOf(single.get(one)).toEqualTypeOf<CaptureResult<ToyNode>>();

    const repeated = toy.pattern`(a ${exactly(2, two)})`.match("(a x y)")!;
    // @ts-expect-error a capture that can bind twice has no single result
    repeated.get(two);
    expectTypeOf(repeated.getAll(two)).toEqualTypeOf<CaptureResult<ToyNode>[]>();
  });

  it("refuses get() for a repeated capture and points at getAll()", () => {
    const item = capture("item");
    const match = toy.pattern`(list ${oneOrMore(item)})`.match("(list a b)")!;
    // @ts-expect-error oneOrMore binds many times
    match.get(item);
    expectTypeOf(match.getAll(item)).toEqualTypeOf<CaptureResult<ToyNode>[]>();

    const loose = toy.pattern`(list ${zeroOrMore(item)})`.match("(list)")!;
    // @ts-expect-error zeroOrMore binds many times
    loose.get(item);
  });

  it("between(0, 1, ...) is optional and between(1, 3, ...) is repeated", () => {
    const value = capture("value");
    const maybe = toy.pattern`(a ${between(0, 1, value)})`.match("(a)")!;
    expectTypeOf(maybe.get(value)).toEqualTypeOf<CaptureResult<ToyNode> | undefined>();

    const many = toy.pattern`(a ${between(1, 3, capture("other"))})`.match("(a x)")!;
    expectTypeOf(many.getAll("other")).toEqualTypeOf<CaptureResult<ToyNode>[]>();
  });

  it("an alternative makes its captures optional", () => {
    const left = capture("left");
    const right = capture("right");
    const match = toy.pattern`(a ${oneOf(left, right)})`.match("(a x)")!;
    expectTypeOf(match.get(left)).toEqualTypeOf<CaptureResult<ToyNode> | undefined>();
  });

  it("a capture inside an interpolated pattern keeps its cardinality", () => {
    const inner = capture("inner");
    const sub = toy.pattern`(inner ${inner})`;
    const match = toy.pattern`(outer ${sub})`.match("(outer (inner x))")!;
    expectTypeOf(match.get(inner)).toEqualTypeOf<CaptureResult<ToyNode>>();
  });
});

describe("names are checked too", () => {
  it("accepts a declared name", () => {
    const body = capture("body");
    const match = toy.pattern`(a ${body})`.match("(a x)")!;
    expectTypeOf(match.get("body")).toEqualTypeOf<CaptureResult<ToyNode>>();
  });

  it("rejects a name the pattern never declared", () => {
    const body = capture("body");
    const match = toy.pattern`(a ${body})`.match("(a x)")!;
    // @ts-expect-error "nope" is not a capture of this pattern
    match.get("nope");
  });

  it("has no capture accessors at all when the pattern declares none", () => {
    const match = toy.pattern`(a ${any()})`.match("(a x)")!;
    // @ts-expect-error the pattern binds nothing
    match.get("anything");
  });
});

describe("the adapter's node type flows through", () => {
  it("reaches raw parser nodes from a capture result", () => {
    const value = capture("value");
    const match = toy.pattern`(a ${value})`.match("(a x)")!;
    expectTypeOf(match.get(value).nodes[0]!.raw).toEqualTypeOf<ToyNode>();
    expectTypeOf(match.get(value).nodes[0]!.raw.kind).toEqualTypeOf<string>();
  });

  it("exposes the language and match types as utilities", () => {
    expectTypeOf(toy).toEqualTypeOf<Language<typeof toyAdapter>>();
    const pattern = toy.pattern`(a ${capture("x")})`;
    expectTypeOf<MatchOf<typeof pattern>>().toEqualTypeOf<Match<{ one: ReturnType<typeof capture<"x">>; optional: never; many: never }, ToyNode>>();
  });
});

describe("misuse is rejected at compile time", () => {
  it("refuses a value that is not a pattern value", () => {
    // @ts-expect-error a plain object is not interpolatable
    toy.pattern`(a ${{ nope: true }})`;
  });

  it("refuses a repetition wrapped in a repetition", () => {
    // @ts-expect-error oneOrMore() does not accept another repetition
    oneOrMore(optional(capture("x")));
  });

  it("keeps replacement templates away from pattern holes", () => {
    const value = capture("value");
    const match = toy.pattern`(a ${value})`.match("(a x)")!;
    expectTypeOf(match.replace`(b ${value})`).toMatchTypeOf<{ operation: string }>();
  });
});
