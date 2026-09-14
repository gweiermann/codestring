import { describe, expect, it } from "vitest";
import { any, capture, code, createLanguage } from "@codestring/core";
import { runAdapterContractSuite } from "@codestring/testing";
import { vueAdapter } from "@codestring/vue";

const vue = createLanguage(vueAdapter);

describe("vue parsing", () => {
  it("reads a directive as a directive, not as an attribute", () => {
    const kinds = vue.parse(`<div v-if="ok" class="a">x</div>`).nodes().map((node) => node.kind);
    expect(kinds).toContain("directive:if");
    expect(kinds).toContain("attribute");
  });

  it("names a component apart from an element", () => {
    expect(vue.parse("<sw-block>x</sw-block>").nodes().map((n) => n.kind)).toContain("component:sw-block");
    expect(vue.parse("<div>x</div>").nodes().map((n) => n.kind)).toContain("element:div");
  });

  it("reads an interpolation and its expression", () => {
    const document = vue.parse("<p>{{ product.name }}</p>");
    const interpolation = document.nodes().find((node) => node.kind === "interpolation")!;
    expect(interpolation.text()).toBe("{{ product.name }}");
    expect(interpolation.child("expression")!.text()).toBe("product.name");
  });

  it("names the tags, like the other markup adapters", () => {
    const [opening, , closing] = vue.parse(`<div class="a">x</div>`).root.children[0]!.children;
    expect(opening!.text()).toBe(`<div class="a">`);
    expect(closing!.text()).toBe("</div>");
  });

  it("reports what the compiler could not read", () => {
    expect(vue.parse("<div>x</span>").hasErrors()).toBe(true);
  });
});

describe("vue matching", () => {
  const body = capture("body");

  it("matches a directive by name", () => {
    expect(vue.parse(`<div v-if="ok">x</div>`).includes(code`<div v-if="ok">${body}</div>`)).toBe(true);
    expect(vue.parse(`<div v-show="ok">x</div>`).includes(code`<div v-if="ok">${body}</div>`)).toBe(false);
  });

  it("matches any element carrying a directive", () => {
    const pattern = code`<${any()} v-if="ok">${body}</${any()}>`;
    expect(vue.parse(`<section v-if="ok">a</section>`).includes(pattern)).toBe(true);
    expect(vue.parse(`<sw-block v-if="ok">a</sw-block>`).includes(pattern)).toBe(true);
  });

  it("captures what an interpolation reads", () => {
    const expression = capture("expression");
    const match = vue.parse("<p>{{ product.name }}</p>").match(code`{{ ${expression} }}`)!;
    expect(match.get(expression).text()).toBe("product.name");
  });

  it("rewrites a directive without touching the rest of the tag", () => {
    const directive = capture("directive");
    const result = vue
      .parse(`<div class="a" v-if="ok" id="b">x</div>`)
      .replaceAll(code`<div class="a" ${directive} id="b">${body}</div>`, (match) =>
        match.replace(directive)`v-show="ok"`,
      )
      .text();
    expect(result).toBe(`<div class="a" v-show="ok" id="b">x</div>`);
  });
});

runAdapterContractSuite(vueAdapter, {
  valid: [
    "<p>hello</p>",
    `<div class="a" v-if="ok"><span>{{ x }}</span></div>`,
    "<sw-block name='a'><template #default>x</template></sw-block>",
    "<!-- a comment -->",
    "text only",
    "<br>",
    "<ul>\n  <li v-for='i in items'>{{ i }}</li>\n</ul>",
  ],
  malformed: ["<div><span></div>", "<p", "</p>"],
  unicode: ["<p>🎉</p>", `<div title="🎉">x</div>`, "🎉"],
  placeholderContexts: [
    { before: "<div ", after: "></div>" },
    { before: "<div>", after: "</div>" },
  ],
});
