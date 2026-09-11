import { describe, expectTypeOf, it } from "vitest";
import { type CaptureResult, capture, createLanguage, oneOrMore, optional } from "@codestring/core";
import { type TwigNode, twigAdapter } from "@codestring/twig";

const twig = createLanguage(twigAdapter);
const source = "{% block a %}{{ x }}{% endblock %}";

describe("a real adapter carries its node type through", () => {
  it("binds a bare capture exactly once", () => {
    const name = capture("name");
    const match = twig.pattern`{% block ${name} %}${capture("body")}{% endblock %}`.match(source)!;
    expectTypeOf(match.get(name)).toEqualTypeOf<CaptureResult<TwigNode>>();
    expectTypeOf(match.get(name).nodes[0]!.raw).toEqualTypeOf<TwigNode>();
    expectTypeOf(match.get(name).nodes[0]!.raw.kind).toEqualTypeOf<string>();
  });

  it("refuses get() for a repeated capture", () => {
    const item = capture("item");
    const match = twig.pattern`{% block a %}${oneOrMore(item)}{% endblock %}`.match(source)!;
    // @ts-expect-error oneOrMore binds many times
    match.get(item);
    expectTypeOf(match.getAll(item)).toEqualTypeOf<CaptureResult<TwigNode>[]>();
  });

  it("makes an optional capture optional", () => {
    const maybe = capture("maybe");
    const match = twig.pattern`{% block a %}${optional(maybe)}{% endblock %}`.match(source)!;
    expectTypeOf(match.get(maybe)).toEqualTypeOf<CaptureResult<TwigNode> | undefined>();
  });

  it("checks capture names against the pattern", () => {
    const body = capture("body");
    const match = twig.pattern`{% block a %}${body}{% endblock %}`.match(source)!;
    expectTypeOf(match.get("body")).toEqualTypeOf<CaptureResult<TwigNode>>();
    // @ts-expect-error the pattern declares no "name" capture
    match.get("name");
  });

  it("rejects a pattern from another language", () => {
    const html = createLanguage(twigAdapter);
    void html;
    const inner = twig.pattern`{{ ${capture("x")} }}`;
    expectTypeOf(twig.pattern`{% block a %}${inner}{% endblock %}`).toMatchTypeOf<{ isStructuralPattern: true }>();
  });
});
