import { describe, expect, it } from "vitest";
import { dropNoMarginTop, dropSize, mtSwitchMigration } from "../src/mt-switch-checks.ts";

const run = (t: { transformString(s: string, p: string): string }, source: string) =>
  t.transformString(source, "component.html.twig");

describe("mt-switch attribute checks", () => {
  it("removes an attribute wherever it sits in the list", () => {
    expect(run(dropNoMarginTop, '<mt-switch label="a" noMarginTop size="s"></mt-switch>')).toBe(
      '<mt-switch label="a" size="s"></mt-switch>',
    );
    expect(run(dropNoMarginTop, '<mt-switch noMarginTop label="a"></mt-switch>')).toBe(
      '<mt-switch label="a"></mt-switch>',
    );
  });

  it("removes the bound spelling too", () => {
    expect(run(dropSize, '<mt-switch label="a" :size="big"></mt-switch>')).toBe('<mt-switch label="a"></mt-switch>');
  });

  it("leaves a switch that does not carry it", () => {
    const source = '<mt-switch label="a"></mt-switch>';
    expect(run(dropNoMarginTop, source)).toBe(source);
  });

  it("leaves every other component alone", () => {
    const source = '<mt-checkbox noMarginTop label="a"></mt-checkbox>';
    expect(run(dropNoMarginTop, source)).toBe(source);
  });

  it("keeps the rest of the file byte for byte", () => {
    const source =
      '<div class="card">\r\n\t<mt-switch\r\n\t\tlabel="a"\r\n\t\tnoMarginTop\r\n\t\t:size="big"\r\n\t></mt-switch>\r\n</div>\r\n';
    const result = run(mtSwitchMigration, source);
    expect(result).toContain('\r\n\t\tlabel="a"\r\n');
    expect(result).not.toContain("noMarginTop");
    expect(result).not.toContain(":size");
    expect(result).toContain('<div class="card">\r\n');
  });

  it("runs every check in one pass", () => {
    expect(run(mtSwitchMigration, '<mt-switch bordered noMarginTop :size="s" label="a"></mt-switch>')).toBe(
      '<mt-switch label="a"></mt-switch>',
    );
  });

  it("names the checks that fired", async () => {
    expect(mtSwitchMigration.transformers.map((t) => t.name)).toEqual([
      "mt-switch: noMarginTop was removed",
      "mt-switch: size was removed",
      "mt-switch: bordered is the default",
    ]);
  });
});
