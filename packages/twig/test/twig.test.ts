import { describe, expect, it } from "vitest";
import { any, capture, createLanguage, oneOrMore, remove, replace } from "@codestring/core";
import { twigAdapter } from "@codestring/twig";

const twig = createLanguage(twigAdapter);

describe("twig parsing", () => {
  it("nests a paired tag and separates its arguments from its body", () => {
    const parsed = twig.parse("{% block content %}hi{% endblock %}");
    const block = parsed.root.children[0]!;
    expect(block.kind).toBe("tag:block");
    expect(block.children.map((child) => child.kind)).toEqual(["args", "body"]);
    expect(block.children[1]!.text()).toBe("hi");
  });

  it("treats a tag with no end counterpart as self-contained", () => {
    const parsed = twig.parse("{% set count = 1 %}");
    expect(parsed.root.children[0]!.kind).toBe("tag:set");
  });

  it("keeps a verbatim body as raw text", () => {
    const parsed = twig.parse("{% verbatim %}{{ literal }}{% endverbatim %}");
    const body = parsed.root.children[0]!.children[1]!;
    expect(body.children.map((child) => child.kind)).toEqual(["text"]);
    expect(body.text()).toBe("{{ literal }}");
  });

  it("classifies comments and whitespace as trivia", () => {
    const parsed = twig.parse("  {# note #}  ");
    expect(parsed.root.children.map((child) => child.trivia)).toEqual(["whitespace", "comment", "whitespace"]);
  });

  it("reports an unclosed block instead of throwing", () => {
    const parsed = twig.parse("{% block a %}body");
    expect(parsed.hasErrors()).toBe(true);
    expect(parsed.diagnostics[0]!.message).toMatch(/never closed/);
  });
});

describe("twig matching", () => {
  const name = capture("name");
  const body = capture("body");
  const blockPattern = twig.pattern`
    {% block ${name} %}
      ${body}
    {% endblock %}
  `;

  it("captures the block name and a tight body", () => {
    const source = "{% block content %}\n  <p>hi</p>\n{% endblock %}";
    const match = blockPattern.match(source)!;
    expect(match.get(name).text()).toBe("content");
    expect(match.get(body).text()).toBe("<p>hi</p>");
  });

  it("does not swallow the indentation around the body", () => {
    const source = "{% block a %}\n\n    x\n\n{% endblock %}";
    const match = blockPattern.match(source)!;
    expect(match.get(body).text()).toBe("x");
  });

  it("matches an empty body", () => {
    const match = blockPattern.match("{% block a %}{% endblock %}")!;
    expect(match.get(body).text()).toBe("");
  });

  it("finds every block in a template", () => {
    const source = "{% block a %}1{% endblock %}\n{% block b %}2{% endblock %}";
    expect(blockPattern.findAll(source).map((match) => match.get(name).text())).toEqual(["a", "b"]);
  });

  it("matches nested blocks, outermost first", () => {
    const source = "{% block outer %}{% block inner %}x{% endblock %}{% endblock %}";
    expect(blockPattern.findAll(source).map((match) => match.get(name).text())).toEqual(["outer", "inner"]);
  });

  it("matches a tag hole inside the arguments", () => {
    const collection = capture("collection");
    const pattern = twig.pattern`{% for item in ${collection} %}${any()}{% endfor %}`;
    const match = pattern.match("{% for item in products.all %}{{ item }}{% endfor %}")!;
    expect(match.get(collection).text()).toBe("products.all");
  });

  it("matches inside an output tag", () => {
    const expression = capture("expression");
    const match = twig.pattern`{{ ${expression} }}`.match("{{ user.name|upper }}")!;
    expect(match.get(expression).text()).toBe("user.name|upper");
  });

  it("ignores whitespace inside tags by default", () => {
    expect(twig.pattern`{% block a %}x{% endblock %}`.match("{%   block   a   %}x{%  endblock  %}")).not.toBeNull();
  });

  it("keeps a comment significant unless trivia is ignored", () => {
    const source = "{% block a %}{# why #}x{% endblock %}";
    expect(twig.pattern`{% block a %}x{% endblock %}`.match(source)).toBeNull();
    expect(twig.pattern({ trivia: "ignore" })`{% block a %}x{% endblock %}`.match(source)).not.toBeNull();
  });

  it("keeps matches away from a broken region", () => {
    const source = "{% block good %}1{% endblock %}\n{% block broken %}2";
    expect(blockPattern.findAll(source).map((match) => match.get(name).text())).toEqual(["good"]);
  });

  it("collects repeated children of a body", () => {
    const item = capture("item");
    const pattern = twig.pattern`{% block list %}${oneOrMore(item)}{% endblock %}`;
    const match = pattern.match("{% block list %}{{ a }}{{ b }}{{ c }}{% endblock %}")!;
    expect(match.getAll(item).map((result) => result.text())).toEqual(["{{ a }}", "{{ b }}", "{{ c }}"]);
  });
});

describe("twig transforms", () => {
  const name = capture("name");
  const body = capture("body");
  const blockPattern = twig.pattern`{% block ${name} %}${body}{% endblock %}`;

  it("preserves every byte it was not asked to change", () => {
    const source = "{# header #}\r\n{% block a %}\r\n\told\r\n{% endblock %}\r\n{# footer #}\r\n";
    const match = blockPattern.match(source)!;
    const result = match.transform([replace(match.get(body), "new")]);
    expect(result).toBe(source.replace("old", "new"));
    expect(result).toContain("\r\n\t");
  });

  it("composes replacement source from captured slices", () => {
    const source = "{% block title %}Hello{% endblock %}";
    const match = blockPattern.match(source)!;
    const result = match.transform([
      match.replace(body)`<h1 data-block="${name}">${body}</h1>`,
    ]);
    expect(result).toBe('{% block title %}<h1 data-block="title">Hello</h1>{% endblock %}');
  });

  it("removes a matched region", () => {
    const match = blockPattern.match("a{% block x %}y{% endblock %}b")!;
    expect(match.transform([remove(match)])).toBe("ab");
  });
});

describe("twig pattern limits", () => {
  it("refuses a hole that would be folded into surrounding text", () => {
    expect(() => twig.pattern`before ${capture("x")} after`.compiled).toThrow(
      /does not sit on a syntax boundary/,
    );
  });

  it("accepts a hole that is the whole text run between two tags", () => {
    expect(() => twig.pattern`{% block a %}${capture("x")}{% endblock %}`.compiled).not.toThrow();
  });
});
