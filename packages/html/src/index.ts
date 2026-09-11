import { type DefaultTreeAdapterMap, parseFragment } from "parse5";
import { isInsideDelimiter, padPlaceholder, splitTextTrivia } from "@codestring/adapter-utils";
import { defineAdapter, type ParseDiagnostic, type TriviaClass } from "@codestring/core";

type Parse5Node = DefaultTreeAdapterMap["node"];
type Parse5Element = DefaultTreeAdapterMap["element"];

const PLACEHOLDER = /^__sm_hole_(\d+)__$/u;
const HOLE_KINDS = new Set(["text", "attribute"]);

export interface HtmlNode {
  kind: string;
  start: number;
  end: number;
  children: HtmlNode[];
  trivia: TriviaClass;
  error: boolean;
  /** Lower-cased attribute name, set on `attribute` nodes. */
  name?: string;
}

export interface HtmlParsed {
  root: HtmlNode;
  diagnostics: ParseDiagnostic[];
}

const node = (
  kind: string,
  start: number,
  end: number,
  children: HtmlNode[] = [],
  extra: Partial<HtmlNode> = {},
): HtmlNode => ({ kind, start, end, children, trivia: null, error: false, ...extra });

function attributeNodes(element: Parse5Element, location: NonNullable<Parse5Element["sourceCodeLocation"]>) {
  const attrs: HtmlNode[] = [];
  const locations = location.attrs ?? {};
  for (const attribute of element.attrs ?? []) {
    const key = attribute.prefix ? `${attribute.prefix}:${attribute.name}` : attribute.name;
    const attributeLocation = locations[key] ?? locations[attribute.name];
    if (!attributeLocation) continue;
    attrs.push(
      node("attribute", attributeLocation.startOffset, attributeLocation.endOffset, [], {
        name: attribute.name,
      }),
    );
  }
  attrs.sort((a, b) => a.start - b.start);
  return attrs;
}

function attributeContainer(
  element: Parse5Element,
  location: NonNullable<Parse5Element["sourceCodeLocation"]>,
  source: string,
): HtmlNode {
  const startTag = location.startTag ?? location;
  const tagName = element.tagName ?? "";
  const start = Math.min(startTag.startOffset + 1 + tagName.length, startTag.endOffset - 1);
  let end = Math.max(startTag.endOffset - 1, start);
  if (source[end - 1] === "/" && end - 1 >= start) end -= 1;
  return node("attributes", start, end, attributeNodes(element, location));
}

function childNodesOf(current: Parse5Node): Parse5Node[] {
  const element = current as Parse5Element & { content?: { childNodes: Parse5Node[] } };
  if (element.content && Array.isArray(element.content.childNodes)) return element.content.childNodes;
  return (element.childNodes ?? []) as Parse5Node[];
}

/** Returns a list because parse5 can produce nodes with no source of their own. */
function convert(current: Parse5Node, source: string): HtmlNode[] {
  const location = current.sourceCodeLocation;

  if (current.nodeName === "#text") {
    if (!location) return [];
    return splitTextTrivia(source.slice(location.startOffset, location.endOffset), location.startOffset).map(
      (segment) => node(segment.kind, segment.start, segment.end, [], { trivia: segment.trivia }),
    );
  }

  if (current.nodeName === "#comment") {
    if (!location) return [];
    return [node("comment", location.startOffset, location.endOffset, [], { trivia: "comment" })];
  }

  if (current.nodeName === "#documentType") {
    if (!location) return [];
    return [node("doctype", location.startOffset, location.endOffset)];
  }

  const children = childNodesOf(current).flatMap((child) => convert(child, source));

  if (!location || location.startOffset === undefined) {
    // An element the parser implied rather than read: keep its children, drop it.
    return children;
  }

  const element = current as Parse5Element;
  return [
    node(`element:${element.tagName}`, location.startOffset, location.endOffset, [
      attributeContainer(element, location, source),
      ...children,
    ]),
  ];
}

/**
 * HTML adapter. Attributes live in their own `attributes` child so a hole in
 * attribute position can never consume element content, and text runs are split
 * so a capture binds the markup rather than the indentation around it.
 */
export const htmlAdapter = defineAdapter<HtmlParsed, HtmlNode>({
  id: "html",

  parse(source) {
    const diagnostics: ParseDiagnostic[] = [];
    const fragment = parseFragment(source, {
      sourceCodeLocationInfo: true,
      onParseError(error) {
        diagnostics.push({
          message: error.code,
          severity: "error",
          range: { start: error.startOffset, end: error.endOffset },
        });
      },
    });
    const children = (fragment.childNodes ?? []).flatMap((child) => convert(child, source));
    return { root: node("fragment", 0, source.length, children), diagnostics };
  },

  root: (parsed) => parsed.root,
  diagnostics: (parsed) => parsed.diagnostics,
  kind: (node) => node.kind,
  range: (node) => ({ start: node.start, end: node.end }),
  children: (node) => node.children,
  triviaClass: (node) => node.trivia,
  isErrorNode: (node) => node.error,
  isVariadic: (kind) => kind === "fragment" || kind === "attributes" || kind.startsWith("element:"),

  placeholder(_index, { before, fallback }) {
    return padPlaceholder(fallback, before, { needsSpace: isInsideDelimiter(before, "<", ">") });
  },

  detectPlaceholder(node, text) {
    if (!HOLE_KINDS.has(node.kind)) return null;
    const candidate = node.kind === "attribute" ? node.name ?? text : text.trim();
    const match = PLACEHOLDER.exec(candidate);
    return match ? Number(match[1]) : null;
  },
});
