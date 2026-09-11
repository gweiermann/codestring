import { describe, expect, it } from "vitest";
import { capture, createLanguage, oneOrMore } from "@codestring/core";
import { toyAdapter } from "./toy-language.js";

const toy = createLanguage(toyAdapter);

describe("match.replace", () => {
  const value = capture("value");
  const pattern = toy.pattern`(log ${value})`;

  it("rewrites the whole match and inserts what the handle captured", () => {
    const source = "(a (log   hello ) (b))";
    const match = pattern.match(source)!;
    expect(match.transform([match.replace`(debug ${value})`])).toBe("(a (debug hello) (b))");
  });

  it("needs no .get() to reach a capture", () => {
    const match = pattern.match('(log "keep   me")')!;
    expect(match.transform([match.replace`(debug ${value})`])).toBe('(debug "keep   me")');
  });

  it("aims at one capture when given a target", () => {
    const match = pattern.match("(log hello)")!;
    expect(match.transform([match.replace(value)`world`])).toBe("(log world)");
  });

  it("takes a capture name as the target", () => {
    const match = pattern.match("(log hello)")!;
    expect(match.transform([match.replace("value")`world`])).toBe("(log world)");
  });

  it("accepts slices, strings and numbers alongside handles", () => {
    const match = pattern.match("(log hello)")!;
    expect(match.transform([match.replace`(debug ${value} ${"lit"} ${42})`])).toBe("(debug hello lit 42)");
  });

  it("inserts before and after", () => {
    const match = pattern.match("(log hello)")!;
    expect(match.transform([match.insertBefore`; note\n`, match.insertAfter` ; end`])).toBe(
      "; note\n(log hello) ; end",
    );
  });

  it("removes the match or one capture", () => {
    const match = pattern.match("(a (log hello) (b))")!;
    expect(match.transform([match.remove()])).toBe("(a  (b))");
    expect(match.transform([match.remove(value)])).toBe("(a (log ) (b))");
  });

  it("refuses to edit a capture that did not bind", () => {
    const maybe = capture("maybe");
    const match = toy.pattern`(a ${oneOrMore(capture("item"))})`.match("(a x)")!;
    expect(() => match.remove(maybe as never)).toThrow(/did not bind/);
  });

  it("collects edits from several matches into one validated pass", () => {
    const source = "(log a) (log b)";
    const matches = pattern.findAll(source);
    const edits = matches.map((match) => match.replace`(debug ${value})`);
    expect(matches[0]!.transform(edits)).toBe("(debug a) (debug b)");
  });
});
