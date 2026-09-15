import { describe, expect, it } from "vitest";
import { createLanguage } from "../../core/src/index.js";
import {
  attributesOf,
  contentOf,
  isComponent,
  isElement,
  nameOf,
  tagOf,
  vueAdapter,
  vueNode,
} from "../src/index.js";

const vue = createLanguage(vueAdapter);

const SOURCE = `<sw-card class="a" v-if="ok" :title="t" @click="go" #footer>\n  text <b>bold</b> <!-- c -->\n</sw-card>`;
const card = () => vue.parse(SOURCE).nodes().find((node) => isElement(node))!;

describe("each helper takes a node and nothing else", () => {
  it("names the tag without the caller reading the kind", () => {
    expect(tagOf(card())).toBe("sw-card");
    expect(isComponent(card())).toBe(true);
  });

  it("returns null for a node that is not a tag", () => {
    const text = vue.parse(SOURCE).nodes().find((node) => node.kind === "text")!;

    expect(tagOf(text)).toBeNull();
    expect(isElement(text)).toBe(false);
  });

  it("gives every attribute and directive by its resolved name", () => {
    expect(attributesOf(card()).map(nameOf)).toEqual(["class", "if", "bind", "on", "slot"]);
  });

  it("gives an element's content without its own tags", () => {
    expect(contentOf(card()).map((node) => node.kind)).toEqual([
      "whitespace",
      "text",
      "whitespace",
      "element:b",
      "comment",
    ]);
  });

  it("works the same on a node from a nested parse", () => {
    const outer = vue.parse(`<div><sw-card class="a">x</sw-card></div>`);
    const nested = vue.parse(outer.nodes().find((node) => node.kind === "component:sw-card")!.slice());

    expect(attributesOf(nested.nodes().find(isElement)!).map(nameOf)).toEqual(["class"]);
  });

  it("answers for an element with no start tag content at all", () => {
    const bare = vue.parse(`<br>`).nodes().find(isElement)!;

    expect([tagOf(bare), attributesOf(bare).length, contentOf(bare).length]).toEqual(["br", 0, 0]);
  });
});

describe("vueNode", () => {
  it("hands back the compiler node for a tag, a directive and an attribute", () => {
    const nodes = vue.parse(`<sw-card class="a" v-for="x in xs" />`).nodes();
    const kinds = ["component:sw-card", "attribute", "directive:for"];

    expect(kinds.map((kind) => (vueNode(nodes.find((node) => node.kind === kind)!) as { type: number }).type)).toEqual([
      1, 6, 7,
    ]);
  });

  it("has nothing to hand back for a node the compiler never made", () => {
    const startTag = vue.parse(`<b>x</b>`).nodes().find((node) => node.kind === "tag-open")!;

    expect(vueNode(startTag)).toBeUndefined();
  });
});
