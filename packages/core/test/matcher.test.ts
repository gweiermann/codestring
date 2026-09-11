import { describe, expect, it } from "vitest";
import {
  CaptureCardinalityError,
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

describe("literal matching", () => {
  it("matches an identical subtree", () => {
    const match = toy.pattern`(sum 1 2)`.match("(print (sum 1 2))")!;
    expect(match.text()).toBe("(sum 1 2)");
    expect(match.start).toBe(7);
  });

  it("ignores formatting differences by default", () => {
    expect(toy.pattern`(sum 1 2)`.match("(sum\n  1\n  2)")).not.toBeNull();
  });

  it("still requires the same structure", () => {
    expect(toy.pattern`(sum 1 2)`.match("(sum 1 2 3)")).toBeNull();
    expect(toy.pattern`(sum 1 2)`.match("(sum 1)")).toBeNull();
    expect(toy.pattern`(sum 1 2)`.match("(diff 1 2)")).toBeNull();
  });

  it("does not match a leaf against a node with children", () => {
    expect(toy.pattern`(a b)`.match("(a (b))")).toBeNull();
  });
});

describe("captures", () => {
  it("binds a whole node, however deeply nested", () => {
    const argument = capture("argument");
    const match = toy.pattern`(print ${argument})`.match("(print (sum 1 (product 2 3)))")!;
    expect(match.get(argument).text()).toBe("(sum 1 (product 2 3))");
    expect(match.get(argument).kinds()).toEqual(["list"]);
  });

  it("binds a run of siblings as one slice in a variadic position", () => {
    const rest = capture("rest");
    const match = toy.pattern`(print ${rest})`.match("(print a b c)")!;
    expect(match.get(rest).text()).toBe("a b c");
    expect(match.get(rest).nodes).toHaveLength(3);
  });

  it("binds an empty slice when a variadic position has nothing in it", () => {
    const rest = capture("rest");
    const match = toy.pattern`(print ${rest})`.match("(print)")!;
    expect(match.get(rest).text()).toBe("");
    expect(match.get(rest).isEmpty()).toBe(true);
  });

  it("keeps capture state on the match, not the handle", () => {
    const name = capture("name");
    const pattern = toy.pattern`(hello ${name})`;
    const first = pattern.match("(hello world)")!;
    const second = pattern.match("(hello moon)")!;
    expect(first.get(name).text()).toBe("world");
    expect(second.get(name).text()).toBe("moon");
  });

  it("looks a capture up by name as well as by handle", () => {
    const name = capture("name");
    const match = toy.pattern`(hello ${name})`.match("(hello world)")!;
    expect(match.get("name").text()).toBe("world");
  });

  it("returns undefined for a capture that did not participate", () => {
    const maybe = capture("maybe");
    const match = toy.pattern`(a ${optional(maybe)})`.match("(a)")!;
    expect(match.get(maybe)).toBeUndefined();
    expect(match.has(maybe)).toBe(false);
  });

  it("refuses get() for a repeated capture and offers getAll()", () => {
    const item = capture("item");
    const match = toy.pattern`(list ${oneOrMore(item)})`.match("(list a b c)")!;
    // @ts-expect-error the type already refuses get() for a repeated capture
    expect(() => match.get(item)).toThrow(CaptureCardinalityError);
    expect(match.getAll(item).map((result) => result.text())).toEqual(["a", "b", "c"]);
  });

  it("discards what any() matched", () => {
    const match = toy.pattern`(pair ${any()} ${capture("second")})`.match("(pair a b)")!;
    expect(match.captures()).toHaveLength(1);
  });
});

describe("repetition and alternation", () => {
  it("matches an exact count", () => {
    const item = capture("item");
    const pattern = toy.pattern`(pair ${exactly(2, item)})`;
    expect(pattern.match("(pair a b)")).not.toBeNull();
    expect(pattern.match("(pair a)")).toBeNull();
    expect(pattern.match("(pair a b c)")).toBeNull();
  });

  it("backtracks within the sibling list so a later item can still match", () => {
    const head = capture("head");
    const match = toy.pattern`(list ${oneOrMore(head)} end)`.match("(list a b end)")!;
    expect(match.getAll(head).map((result) => result.text())).toEqual(["a", "b"]);
  });

  it("is greedy but yields what the rest of the pattern needs", () => {
    const first = capture("first");
    const second = capture("second");
    const match = toy.pattern`(list ${first} ${oneOrMore(second)})`.match("(list a b c)")!;
    expect(match.get(first).text()).toBe("a b");
    expect(match.getAll(second).map((result) => result.text())).toEqual(["c"]);
  });

  it("takes the first alternative that fits", () => {
    const pattern = toy.pattern`(value ${oneOf(toy.pattern`(left)`, toy.pattern`(right)`)})`;
    expect(pattern.match("(value (left))")).not.toBeNull();
    expect(pattern.match("(value (right))")).not.toBeNull();
    expect(pattern.match("(value (other))")).toBeNull();
  });

  it("matches zero occurrences", () => {
    const item = capture("item");
    expect(toy.pattern`(list ${zeroOrMore(item)} end)`.match("(list end)")).not.toBeNull();
  });
});

describe("search", () => {
  it("returns every occurrence in source order", () => {
    const matches = toy.pattern`(x ${capture("v")})`.findAll("(a (x 1) (b (x 2)) (x 3))");
    expect(matches.map((match) => match.text())).toEqual(["(x 1)", "(x 2)", "(x 3)"]);
    expect(matches.map((match) => match.start)).toEqual([3, 12, 19]);
  });

  it("finds nested occurrences of the same pattern", () => {
    const matches = toy.pattern`(x ${capture("v")})`.findAll("(x (x 1))");
    expect(matches.map((match) => match.text())).toEqual(["(x (x 1))", "(x 1)"]);
  });

  it("orders equal starts outermost first", () => {
    const matches = toy.pattern`${capture("node")}`.findAll("((a))");
    expect(matches[0]!.text()).toBe("((a))");
  });

  it("matches() only accepts a whole-input match", () => {
    const pattern = toy.pattern`(a)`;
    expect(pattern.matches("(a)")).toBe(true);
    expect(pattern.matches("  (a)  ")).toBe(true);
    expect(pattern.matches("(b (a))")).toBe(false);
  });

  it("matches a multi-node pattern as a contiguous run", () => {
    const match = toy.pattern`(a) (b)`.match("(x) (a) (b) (c)")!;
    expect(match.text()).toBe("(a) (b)");
  });
});

describe("trivia policies", () => {
  const withComment = "(sum 1 ; why\n 2)";

  it("whitespace-flexible keeps comments significant", () => {
    expect(toy.pattern`(sum 1 2)`.match(withComment)).toBeNull();
  });

  it("ignore skips comments as well as whitespace", () => {
    expect(toy.pattern({ trivia: "ignore" })`(sum 1 2)`.match(withComment)).not.toBeNull();
  });

  it("exact requires identical trivia", () => {
    const exactPattern = toy.pattern({ trivia: "exact" })`(sum 1 2)`;
    expect(exactPattern.match("(sum 1 2)")).not.toBeNull();
    expect(exactPattern.match("(sum  1 2)")).toBeNull();
  });
});

describe("parse error policies", () => {
  const broken = "(good 1) (bad";

  it("allow-outside-errors keeps matches clear of the damage", () => {
    const matches = toy.pattern`(good ${capture("v")})`.findAll(broken);
    expect(matches).toHaveLength(1);
    expect(toy.pattern`(bad ${capture("v")})`.findAll(broken)).toHaveLength(0);
  });

  it("reject refuses to match anything in a broken file", () => {
    const pattern = toy.pattern({ onParseError: "reject" })`(good ${capture("v")})`;
    expect(() => pattern.findAll(broken)).toThrow(/parse errors/);
  });

  it("allow-recovery matches the recovered tree", () => {
    const pattern = toy.pattern({ onParseError: "allow-recovery" })`(bad ${capture("v")})`;
    expect(pattern.findAll("(good 1) (bad 2")).toHaveLength(1);
  });
});

describe("explain", () => {
  it("names the node kind that did not line up", () => {
    const explanation = toy.pattern`(sum 1 2)`.explain("(diff 1 2)");
    expect(explanation).toContain("no match");
    expect(explanation).toMatch(/expected:\s+sum/);
  });

  it("says where a match was found when there is one", () => {
    expect(toy.pattern`(a)`.explain("(a)")).toContain("matched 1 time");
  });
});
