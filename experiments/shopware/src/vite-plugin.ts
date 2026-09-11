import { capture, code, createLanguage } from "@codestring/core";
import { createTransformer } from "@codestring/codemod";
import { javascriptAdapter } from "@codestring/javascript";

const js = createLanguage(javascriptAdapter);
const path = capture("path");

/**
 * The shape Shopware's source-rewriting Vite plugins have: a `transform(code,
 * id)` that returns new code or null. A codestring transformer is already that
 * function, so the plugin is a four-line adapter around it.
 */
export function codestringVitePlugin(transformer: {
  name: string;
  appliesTo(id: string): boolean;
  transformString(code: string, id: string): string;
}) {
  return {
    name: `codestring:${transformer.name}`,
    transform(source: string, id: string) {
      if (!transformer.appliesTo(id)) return null;
      const code = transformer.transformString(source, id);
      return code === source ? null : { code, map: null };
    },
  };
}

/**
 * Shopware rewrites `@administration/...` imports to the global `Shopware`
 * object for plugin builds. As a pattern that is one line, and the import's own
 * formatting survives because only the specifier is touched.
 */
export const rewriteCoreImports = createTransformer({
  name: "rewrite core imports to the Shopware global",
  language: js,
  fileGlob: "**/*.{js,ts}",
  transform: ({ source }) =>
    source.replaceAll(code`import ${capture("bindings")} from "${path}"`, (match) =>
      match.get(path).text().slice(1).startsWith("@administration/")
        ? match.replace(path)`"@shopware-core"`
        : null,
    ),
  verify: "parses",
});

export const coreImportPlugin = codestringVitePlugin(rewriteCoreImports);
