import {
  ElementTypes,
  NodeTypes,
  type AttributeNode,
  type DirectiveNode,
  type ElementNode,
  type RootNode,
  type TemplateChildNode,
  parse,
} from "@vue/compiler-dom";
import { defineAdapter, type ParseDiagnostic, type TriviaClass } from "@codestring/core";

export interface VueNode {
  kind: string;
  start: number;
  end: number;
  children: VueNode[];
  trivia: TriviaClass;
  error: boolean;
  /** The compiler's own node, for anything the normalized tree does not carry. */
  raw?: unknown;
  /** The directive or attribute name, without its `v-`, `:` or `@` shorthand. */
  name?: string;
}

export interface VueParsed {
  root: VueNode;
  diagnostics: ParseDiagnostic[];
}

const node = (kind: string, start: number, end: number, children: VueNode[] = [], extra: Partial<VueNode> = {}): VueNode => ({
  kind,
  start,
  end,
  children,
  trivia: null,
  error: false,
  ...extra,
});

const range = (loc: { start: { offset: number }; end: { offset: number } }) => ({
  start: loc.start.offset,
  end: loc.end.offset,
});

/** `v-if`, `:value`, `@click` and `#slot` all arrive as directives; the name is the useful part. */
function directiveNode(prop: DirectiveNode): VueNode {
  const { start, end } = range(prop.loc);
  const children: VueNode[] = [];
  if (prop.arg) children.push(node("directive-argument", range(prop.arg.loc).start, range(prop.arg.loc).end));
  if (prop.exp) children.push(node("expression", range(prop.exp.loc).start, range(prop.exp.loc).end));
  return node(`directive:${prop.name}`, start, end, children, { name: prop.name, raw: prop });
}

function attributeNode(prop: AttributeNode): VueNode {
  const { start, end } = range(prop.loc);
  const children: VueNode[] = [];
  if (prop.value) children.push(node("attribute-value", range(prop.value.loc).start, range(prop.value.loc).end));
  return node("attribute", start, end, children, { name: prop.name, raw: prop });
}

/** Where the start tag ends: the `>` after the last thing written inside it. */
function startTagEnd(element: ElementNode, source: string): number {
  const from = element.props.length > 0 ? range(element.props[element.props.length - 1]!.loc).end : range(element.loc).start;
  const closed = source.indexOf(">", from);
  return closed === -1 ? range(element.loc).end : closed + 1;
}

function convert(current: TemplateChildNode, source: string): VueNode[] {
  const { start, end } = range(current.loc);

  if (current.type === NodeTypes.TEXT) {
    const text = source.slice(start, end);
    if (text.trim() === "") return [node("whitespace", start, end, [], { trivia: "whitespace" })];
    const leading = text.length - text.trimStart().length;
    const trailing = text.length - text.trimEnd().length;
    const parts: VueNode[] = [];
    if (leading > 0) parts.push(node("whitespace", start, start + leading, [], { trivia: "whitespace" }));
    parts.push(node("text", start + leading, end - trailing));
    if (trailing > 0) parts.push(node("whitespace", end - trailing, end, [], { trivia: "whitespace" }));
    return parts;
  }

  if (current.type === NodeTypes.COMMENT) {
    return [node("comment", start, end, [], { trivia: "comment" })];
  }

  if (current.type === NodeTypes.INTERPOLATION) {
    const inner = range(current.content.loc);
    return [node("interpolation", start, end, [node("expression", inner.start, inner.end)], { raw: current })];
  }

  if (current.type !== NodeTypes.ELEMENT) {
    return [node("unknown", start, end, [], { raw: current })];
  }

  const element = current;
  const props = element.props.map((prop) =>
    prop.type === NodeTypes.DIRECTIVE ? directiveNode(prop) : attributeNode(prop),
  );
  const openEnd = startTagEnd(element, source);
  const opening = node("tag-open", start, openEnd, [
    node("attributes", props.length > 0 ? props[0]!.start : openEnd - 1, props.length > 0 ? props[props.length - 1]!.end : openEnd - 1, props),
  ]);

  const children = element.children.flatMap((child) => convert(child, source));
  const closing =
    element.isSelfClosing || openEnd === end
      ? []
      : [node("tag-close", Math.max(openEnd, source.lastIndexOf("</", end)), end)];

  const componentTag = element.tagType === ElementTypes.COMPONENT ? "component" : "element";
  return [
    node(`${componentTag}:${element.tag}`, start, end, [opening, ...children, ...closing], { raw: element }),
  ];
}

/**
 * Vue template adapter. It reads what `@vue/compiler-dom` reads — directives,
 * interpolations, components — rather than the plain markup underneath, so a
 * pattern can say `v-if` and mean the directive.
 */
export const vueAdapter = defineAdapter<VueParsed, VueNode>({
  id: "vue",

  parse(source) {
    const diagnostics: ParseDiagnostic[] = [];
    let root: RootNode | null = null;
    try {
      root = parse(source, {
        comments: true,
        onError: (error) => {
          diagnostics.push({
            message: error.message,
            severity: "error",
            range: error.loc ? range(error.loc) : undefined,
          });
        },
      });
    } catch (error) {
      diagnostics.push({ message: (error as Error).message, severity: "error" });
    }
    const children = (root?.children ?? []).flatMap((child) => convert(child, source));
    return { root: node("root", 0, source.length, children, { raw: root }), diagnostics };
  },

  root: (parsed) => parsed.root,
  diagnostics: (parsed) => parsed.diagnostics,
  kind: (node) => node.kind,
  range: (node) => ({ start: node.start, end: node.end }),
  children: (node) => node.children,
  triviaClass: (node) => node.trivia,
  isErrorNode: (node) => node.error,

  isVariadic: (kind) =>
    kind === "root" || kind === "attributes" || kind.startsWith("element:") || kind.startsWith("component:"),
  listSeparator: (kind) => (kind === "attributes" ? " " : null),
  isHoleKind: (kind) => kind === "text" || kind === "attribute" || kind === "attribute-value" || kind === "expression",

  placeholder(_index, { before, fallback }) {
    if (before.endsWith("</")) {
      // A closing tag has to repeat the opening name or the compiler rejects it,
      // so it echoes whatever the opening tag's hole was called.
      const prefix = fallback.replace(/\d+$/u, "");
      const opened = new RegExp(`<(${prefix}\\d+)(?![\\s\\S]*</\\1>)`, "u").exec(before);
      return opened ? opened[1]! : fallback;
    }
    if (before.endsWith("<")) return fallback;
    const insideTag = before.lastIndexOf("<") > before.lastIndexOf(">");
    return insideTag && !/\s$/u.test(before) ? ` ${fallback}` : fallback;
  },
});

export { parse as parseVueTemplate };
