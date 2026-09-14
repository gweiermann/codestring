import { defineAdapter } from "@codestring/core";
import { type CssNode, type CssParsed, parseCss } from "./parser.js";

const HOLE_KINDS = new Set(["selector", "property", "value", "prelude", "text"]);
const VARIADIC = new Set(["stylesheet", "block"]);

/**
 * CSS adapter. A stylesheet is rules and declarations; a declaration splits
 * into its property and its value, so a hole can sit on either side of the
 * colon without the matcher knowing anything about CSS.
 */
export const cssAdapter = defineAdapter<CssParsed, CssNode>({
  id: "css",

  parse: (source) => parseCss(source),
  root: (parsed) => parsed.root,
  diagnostics: (parsed) => parsed.diagnostics,
  kind: (node) => node.kind,
  range: (node) => ({ start: node.start, end: node.end }),
  children: (node) => node.children,
  triviaClass: (node) => node.trivia,
  isErrorNode: (node) => node.error,
  isVariadic: (kind) => VARIADIC.has(kind),

  isHoleKind: (kind) => HOLE_KINDS.has(kind),
});

export { parseCss };
export type { CssNode, CssParsed };
