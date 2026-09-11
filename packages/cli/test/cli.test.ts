import { describe, expect, it } from "vitest";
import { createLanguage } from "@codestring/core";
import { twigAdapter } from "@codestring/twig";
import { javascriptAdapter } from "@codestring/javascript";
import { buildReplacement, compileCliPattern, languageIds, loadLanguage } from "@codestring/cli";
import { find, rewrite } from "@codestring/cli";

const twig = createLanguage(twigAdapter);
const js = createLanguage(javascriptAdapter);
const fixtures = "examples/twig-html-migration/fixtures";

describe("command line patterns", () => {
  it("turns $name into a single-node capture", () => {
    const { pattern, handles } = compileCliPattern(js, "foo($x)");
    const match = pattern.match("foo(bar(1))")!;
    expect(match.get(handles.get("x")).text()).toBe("bar(1)");
    expect(pattern.match("foo(1, 2)")).toBeNull();
  });

  it("turns $$$name into a run of siblings", () => {
    const { pattern, handles } = compileCliPattern(js, "foo($$$args)");
    const match = pattern.match("foo(1, 2, 3)")!;
    expect(match.get(handles.get("args")).text()).toBe("1, 2, 3");
  });

  it("keeps $_ anonymous", () => {
    const { pattern, handles } = compileCliPattern(js, "foo($_)");
    expect(handles.size).toBe(0);
    expect(pattern.match("foo(1)")).not.toBeNull();
  });

  it("reuses one handle for a name used twice in a replacement", () => {
    const { pattern, handles } = compileCliPattern(js, "foo($x)");
    const match = pattern.match("foo( 1 )")!;
    expect(buildReplacement(js, "bar($x, $x)", match, handles).text()).toBe("bar(1, 1)");
  });

  it("inserts captured source into a replacement verbatim", () => {
    const { pattern, handles } = compileCliPattern(twig, "{% block $name %}$$$body{% endblock %}");
    const match = pattern.match("{% block a %}  keep   spacing  {% endblock %}")!;
    expect(buildReplacement(twig, "{% block $name %}<i>$body</i>{% endblock %}", match, handles).text()).toBe(
      "{% block a %}<i>keep   spacing</i>{% endblock %}",
    );
  });
});

describe("language loading", () => {
  it("lists the built-in languages", () => {
    expect(languageIds()).toContain("twig");
    expect(languageIds()).toContain("javascript");
  });

  it("explains an unknown language", async () => {
    await expect(loadLanguage("cobol")).rejects.toThrow(/unknown language/);
  });

  it("loads an adapter from a module path", async () => {
    const language = await loadLanguage("twig", { adapterModule: "@codestring/twig" });
    expect(language.id).toBe("twig");
  });
});

describe("find", () => {
  it("reports file, position and captures", async () => {
    const findings = await find({
      language: "twig",
      pattern: "{% block $name %}$$$body{% endblock %}",
      paths: [fixtures],
    });
    expect(findings.map((finding) => finding.captures!.name).sort()).toEqual([
      "sw_product_grid",
      "sw_product_list",
      "sw_two",
    ]);
    const first = findings.find((finding) => finding.captures!.name === "sw_product_list")!;
    expect(first.line).toBe(1);
    expect(first.column).toBe(1);
    expect(first.path).toContain("plain-block.twig");
  });

  it("finds nothing when the pattern does not fit", async () => {
    const findings = await find({
      language: "twig",
      pattern: "{% embed $name %}$$$body{% endembed %}",
      paths: [fixtures],
    });
    expect(findings).toEqual([]);
  });
});

describe("replace", () => {
  it("rewrites every match without touching disk unless asked", async () => {
    const changes = await rewrite({
      language: "twig",
      pattern: "{% block $name %}$$$body{% endblock %}",
      replacement: "{% block $name %}<sw-block>$body</sw-block>{% endblock %}",
      paths: [`${fixtures}/plain-block.twig`],
      write: false,
    });
    expect(changes).toHaveLength(1);
    expect(changes[0]!.after).toContain('<sw-block><p class="intro">Nothing fancy here.</p></sw-block>');
    expect(changes[0]!.before).toContain('<p class="intro">');
  });

  it("reports nothing when no file changes", async () => {
    const changes = await rewrite({
      language: "javascript",
      pattern: "neverAppears($x)",
      replacement: "other($x)",
      paths: ["examples/javascript-codemod/fixtures"],
    });
    expect(changes).toEqual([]);
  });
});
