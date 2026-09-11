import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const source = (name: string) => fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    // Tests run against the sources, so no build step stands between an edit
    // and a test run; published consumers resolve dist through exports.
    alias: {
      "@codestring/core": source("core"),
      "@codestring/adapter-utils": source("adapter-utils"),
      "@codestring/testing": source("testing"),
      "@codestring/twig": source("twig"),
      "@codestring/html": source("html"),
      "@codestring/javascript": source("javascript"),
      "@codestring/cli": source("cli"),
      "@codestring/codemod": source("codemod"),
      "@codestring/css": source("css"),
      "@codestring/eslint": source("eslint"),
      "codestring": source("umbrella"),
    },
  },
  test: {
    include: ["packages/*/test/**/*.test.ts", "examples/*/test/**/*.test.ts"],
    environment: "node",
    typecheck: {
      enabled: true,
      include: ["packages/*/test/**/*.test-d.ts"],
      tsconfig: "tsconfig.json",
    },
  },
});
