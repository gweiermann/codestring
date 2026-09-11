import { describe, expect, it } from "vitest";
import { coreImportPlugin, rewriteCoreImports } from "../src/vite-plugin.ts";

describe("a transformer as a vite plugin", () => {
  it("returns null for a file it does not apply to", () => {
    expect(coreImportPlugin.transform("import a from '@administration/x';", "styles.css")).toBeNull();
  });

  it("returns null when nothing changed", () => {
    expect(coreImportPlugin.transform("import a from 'vue';", "src/a.ts")).toBeNull();
  });

  it("rewrites only the specifier and keeps the rest byte for byte", () => {
    const source = "import {\n\tComponent,\n} from '@administration/app/adapter/view/vue.adapter';\n";
    const result = coreImportPlugin.transform(source, "src/a.ts");
    expect(result?.code).toBe('import {\n\tComponent,\n} from "@shopware-core";\n');
  });

  it("handles every single-specifier import form", () => {
    expect(coreImportPlugin.transform("import * as all from '@administration/x';", "a.ts")?.code).toBe(
      'import * as all from "@shopware-core";',
    );
  });

  it("names itself after the transformer", () => {
    expect(coreImportPlugin.name).toBe("codestring:rewrite core imports to the Shopware global");
  });

  it("refuses a rewrite that would break the file", () => {
    expect(rewriteCoreImports.transformString("import a from 'vue';", "src/a.ts")).toBe("import a from 'vue';");
  });
});
