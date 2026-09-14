import { isInsideDelimiter, padPlaceholder } from "@codestring/adapter-utils";
import { defineAdapter } from "@codestring/core";
import { type TwigNode, type TwigParsed, parseTwig } from "./parser.js";

const HOLE_KINDS = new Set(["text", "name"]);
const VARIADIC = new Set(["document", "args", "body", "output"]);

/**
 * Twig adapter. It normalizes exactly what the matcher needs: kinds, ranges,
 * children, trivia and placeholder syntax. It implements no matching.
 */
export const twigAdapter = defineAdapter<TwigParsed, TwigNode>({
  id: "twig",

  parse: (source) => parseTwig(source),
  root: (parsed) => parsed.root,
  diagnostics: (parsed) => parsed.diagnostics,
  kind: (node) => node.kind,
  range: (node) => ({ start: node.start, end: node.end }),
  children: (node) => node.children,
  triviaClass: (node) => node.trivia,
  isErrorNode: (node) => node.error,
  isVariadic: (kind) => VARIADIC.has(kind) || kind.startsWith("tag:"),

  placeholder(_index, { before, fallback }) {
    const insideTag = isInsideDelimiter(before, "{%", "%}") || isInsideDelimiter(before, "{{", "}}");
    return padPlaceholder(fallback, before, { needsSpace: insideTag });
  },

  isHoleKind: (kind) => HOLE_KINDS.has(kind),
});

export { parseTwig };
export type { TwigNode, TwigParsed };
