import { describe, expect, it } from "vitest";
import { removeEmptyTemplates, topLevelBlocksToExtends, wrapSlotsInBlocks } from "../src/template-codemods.ts";

describe("remove-empty-templates", () => {
  const run = (source: string) => removeEmptyTemplates.transformString(source, "a.html.twig");

  it("unwraps a template that carries no attributes", () => {
    expect(run("<sw-block>\n\t<template>\n\t\t<h1>Title</h1>\n\t</template>\n</sw-block>")).toBe(
      "<sw-block>\n\t<h1>Title</h1>\n</sw-block>",
    );
  });

  it("leaves a template that carries one alone", () => {
    const source = '<sw-block>\n\t<template v-if="!!message">\n\t\t<h1>Title</h1>\n\t</template>\n</sw-block>';
    expect(run(source)).toBe(source);
    expect(run('<div><template #header><h1>T</h1></template></div>')).toBe(
      '<div><template #header><h1>T</h1></template></div>',
    );
  });

  it("keeps the indentation of what it unwrapped", () => {
    expect(run("<div>\r\n\t<template>\r\n\t\t<p>a</p>\r\n\t</template>\r\n</div>")).toBe(
      "<div>\r\n\t<p>a</p>\r\n</div>",
    );
  });
});

describe("replace-top-level-blocks-to-extends", () => {
  const run = (source: string) => topLevelBlocksToExtends.transformString(source, "a.html.twig");

  it("rewrites a top-level block and leaves a nested one", () => {
    const source =
      '<sw-block name="block-1" :data="$dataScope">\n' +
      '\t<div><sw-block name="block-2" :data="$dataScope"></sw-block></div>\n' +
      "</sw-block>";
    expect(run(source)).toBe(
      '<sw-block extends="block-1">\n' +
        '\t<div><sw-block name="block-2" :data="$dataScope"></sw-block></div>\n' +
        "</sw-block>",
    );
  });

  it("rewrites every top-level block", () => {
    expect(run('<sw-block name="a"><p>1</p></sw-block>\n<sw-block name="b"><p>2</p></sw-block>')).toBe(
      '<sw-block extends="a"><p>1</p></sw-block>\n<sw-block extends="b"><p>2</p></sw-block>',
    );
  });

  it("only touches the files its glob names", () => {
    const source = '<sw-block name="a"><p>1</p></sw-block>';
    expect(topLevelBlocksToExtends.transformString(source, "component.vue")).toBe(source);
  });
});

describe("move-slots-to-wrap-blocks", () => {
  it("swaps the slot template outside the block", () => {
    expect(
      wrapSlotsInBlocks.transformString(
        '<sw-block name="b"><template #header><h1>T</h1></template></sw-block>',
        "a.html.twig",
      ),
    ).toBe('<template #header><sw-block name="b"><h1>T</h1></sw-block></template>');
  });
});
