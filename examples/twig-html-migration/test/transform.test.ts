import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { transform } from "../transform.ts";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const read = (name: string) => readFile(join(fixtures, name), "utf8");

describe("twig to sw-block migration", () => {
  it("wraps a plain block body", async () => {
    const source = await read("plain-block.twig");
    expect(transform(source)).toBe(
      '{% block sw_product_list %}\n\t<sw-block name="sw_product_list">' +
        '<p class="intro">Nothing fancy here.</p></sw-block>\n{% endblock %}\n',
    );
  });

  it("wraps inside an existing template and keeps its attributes", async () => {
    const source = await read("with-template.twig");
    const result = transform(source);
    expect(result).toContain('<template class="grid" data-x="1">');
    expect(result).toContain('<sw-block name="sw_product_grid"><div class="cell">');
    expect(result).toContain("{# keep this comment #}");
  });

  it("keeps the Twig output tag that lives inside the HTML", async () => {
    const result = transform(await read("with-template.twig"));
    expect(result).toContain("{{ product.name }}");
  });

  it("changes nothing outside the region it rewrote", async () => {
    const source = await read("with-template.twig");
    const result = transform(source);
    const before = source.split('<div class="cell">')[0]!;
    expect(result.startsWith(before)).toBe(true);
    expect(result.endsWith("\t</template>\n{% endblock %}\n")).toBe(true);
  });

  it("preserves tabs and line endings byte for byte", async () => {
    const source = "{% block a %}\r\n\t\t<p>x</p>\r\n{% endblock %}";
    const result = transform(source);
    expect(result).toBe('{% block a %}\r\n\t\t<sw-block name="a"><p>x</p></sw-block>\r\n{% endblock %}');
  });

  it("returns the input unchanged when there is no block", async () => {
    const source = await read("no-block.twig");
    expect(transform(source)).toBe(source);
  });

  it("refuses a block with more than one template", async () => {
    const source = await read("two-templates.twig");
    expect(() => transform(source)).toThrow("At most one template is allowed");
  });

  it("wraps an empty region when a block body holds only whitespace", () => {
    expect(transform("{% block a %}\n{% endblock %}")).toBe(
      '{% block a %}<sw-block name="a"></sw-block>\n{% endblock %}',
    );
  });
});
