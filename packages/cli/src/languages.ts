import { type AnyAdapter, type Language, type LanguageOptions, createLanguage } from "@codestring/core";

interface BuiltIn {
  readonly load: () => Promise<AnyAdapter>;
  readonly extensions: readonly string[];
}

/**
 * The first-party adapters, loaded on demand so the CLI does not pay for
 * parsers it never uses. `--adapter` adds any other package or file.
 */
const BUILT_IN: Record<string, BuiltIn> = {
  twig: { load: () => import("@codestring/twig").then((m) => m.twigAdapter), extensions: [".twig"] },
  html: {
    load: () => import("@codestring/html").then((m) => m.htmlAdapter),
    extensions: [".html", ".htm", ".vue"],
  },
  css: {
    load: () => import("@codestring/css").then((m) => m.cssAdapter),
    extensions: [".css", ".scss"],
  },
  javascript: {
    load: () => import("@codestring/javascript").then((m) => m.javascriptAdapter),
    extensions: [".js", ".mjs", ".cjs", ".jsx", ".ts", ".mts"],
  },
};

BUILT_IN.js = BUILT_IN.javascript!;

export function languageIds(): string[] {
  return Object.keys(BUILT_IN);
}

export function defaultExtensions(id: string): readonly string[] {
  return BUILT_IN[id]?.extensions ?? [];
}

export interface LoadLanguageOptions {
  readonly adapterModule?: string;
  readonly options?: LanguageOptions;
}

export async function loadLanguage(id: string, config: LoadLanguageOptions = {}): Promise<Language<AnyAdapter>> {
  if (config.adapterModule) {
    const module = (await import(config.adapterModule)) as Record<string, unknown> & { default?: AnyAdapter };
    const adapter =
      module.default?.id === id
        ? module.default
        : (Object.values(module).find(
            (value) => value && typeof value === "object" && (value as AnyAdapter).id === id,
          ) as AnyAdapter | undefined) ?? module.default;
    if (!adapter) {
      throw new Error(`${config.adapterModule} does not export an adapter with id "${id}"`);
    }
    return createLanguage(adapter, config.options);
  }
  const entry = BUILT_IN[id];
  if (!entry) {
    throw new Error(`unknown language "${id}"; built-in: ${languageIds().join(", ")}, or pass --adapter`);
  }
  return createLanguage(await entry.load(), config.options);
}
