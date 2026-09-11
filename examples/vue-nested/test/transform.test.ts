import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { migrateVue, report } from "../transform.ts";

const fixture = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "ProductCard.vue");
const read = () => readFile(fixture, "utf8");

describe("one file, three grammars", () => {
  it("counts what each embedded language holds", async () => {
    expect(report(await read())).toEqual({ bold: 1, consoleLog: 1, redDeclarations: 2 });
  });

  it("rewrites the markup as HTML", async () => {
    const result = migrateVue.transformString(await read(), "ProductCard.vue");
    expect(result).toContain("<strong>{{ product.name }}</strong>");
    expect(result).not.toContain("<b>");
  });

  it("rewrites the script block as JavaScript", async () => {
    const result = migrateVue.transformString(await read(), "ProductCard.vue");
    expect(result).toContain("logger.debug('card mounted', this.product.id);");
    expect(result).not.toContain("console.log");
    expect(result).not.toContain("debugger;");
  });

  it("rewrites the style block as CSS", async () => {
    const result = migrateVue.transformString(await read(), "ProductCard.vue");
    expect(result).toContain("color: var(--text);");
    expect(result).toContain(".price { color: var(--text) }");
    expect(result).not.toContain("color:   red");
  });

  it("leaves everything the three rules did not name alone", async () => {
    const source = await read();
    const result = migrateVue.transformString(source, "ProductCard.vue");
    expect(result).toContain("/* keep this comment and the tabs below */");
    expect(result).toContain('\t<article class="card" :class="{ active: isActive }">');
    expect(result).toContain("import { logger } from '../logging.js';");
    expect(result).toContain("\tpadding: 8px;");
    expect(result).toContain("<style scoped>");
  });

  it("only touches files its glob matches", async () => {
    const source = await read();
    expect(migrateVue.transformString(source, "ProductCard.html")).toBe(source);
  });

  it("is idempotent once the migration has run", async () => {
    const once = migrateVue.transformString(await read(), "ProductCard.vue");
    expect(migrateVue.transformString(once, "ProductCard.vue")).toBe(once);
  });

  it("keeps the Vue interpolations the parsers never understood", async () => {
    const result = migrateVue.transformString(await read(), "ProductCard.vue");
    expect(result).toContain("{{ product.price }}");
  });
});
