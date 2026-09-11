import { splitTextTrivia, tokenizeExpression } from "@codestring/adapter-utils";
import type { ParseDiagnostic, TriviaClass } from "@codestring/core";

const PAIRED = new Set([
  "block",
  "if",
  "for",
  "embed",
  "apply",
  "with",
  "macro",
  "filter",
  "autoescape",
  "sandbox",
  "spaceless",
  "verbatim",
  "set",
]);

export interface TwigNode {
  kind: string;
  start: number;
  end: number;
  children: TwigNode[];
  trivia: TriviaClass;
  error: boolean;
}

export interface TwigParsed {
  root: TwigNode;
  diagnostics: ParseDiagnostic[];
  source: string;
}

const node = (
  kind: string,
  start: number,
  end: number,
  children: TwigNode[] = [],
  extra: Partial<Pick<TwigNode, "trivia" | "error">> = {},
): TwigNode => ({ kind, start, end, children, trivia: null, error: false, ...extra });

function tagName(text: string): string | null {
  const match = /^[-\s]*([A-Za-z_][A-Za-z0-9_]*)/u.exec(text);
  return match ? match[1]! : null;
}

interface Frame {
  node: TwigNode;
  container: TwigNode;
  name: string;
}

/**
 * Text, comments, `{{ output }}` and `{% tags %}`, with paired tags nested by
 * their `end<name>` counterpart. Twig's semantics beyond that are not modelled.
 */
export function parseTwig(source: string): TwigParsed {
  const diagnostics: ParseDiagnostic[] = [];
  const root = node("document", 0, source.length);
  const stack: Frame[] = [{ node: root, container: root, name: "" }];
  let cursor = 0;
  let pending = 0;

  const container = () => stack[stack.length - 1]!.container;

  const flushText = (until: number) => {
    if (until <= pending) return;
    for (const segment of splitTextTrivia(source.slice(pending, until), pending)) {
      container().children.push(node(segment.kind, segment.start, segment.end, [], { trivia: segment.trivia }));
    }
    pending = until;
  };

  while (cursor < source.length) {
    const open = source.indexOf("{", cursor);
    if (open === -1) break;
    const marker = source[open + 1];
    if (marker !== "{" && marker !== "%" && marker !== "#") {
      cursor = open + 1;
      continue;
    }

    const close =
      marker === "#" ? source.indexOf("#}", open) : source.indexOf(marker === "{" ? "}}" : "%}", open);
    if (close === -1) {
      diagnostics.push({
        message: `unclosed ${marker === "#" ? "comment" : marker === "{" ? "output" : "tag"}`,
        severity: "error",
        range: { start: open, end: source.length },
      });
      flushText(open);
      container().children.push(node("error", open, source.length, [], { error: true }));
      pending = source.length;
      break;
    }

    const end = close + 2;
    flushText(open);

    if (marker === "#") {
      container().children.push(node("comment", open, end, [], { trivia: "comment" }));
    } else if (marker === "{") {
      const inner = source.slice(open + 2, close);
      container().children.push(node("output", open, end, tokens(inner, open + 2)));
    } else {
      const jump = handleTag({ source, open, close, end, stack, diagnostics });
      if (jump !== undefined) {
        pending = jump;
        cursor = jump;
        continue;
      }
    }

    pending = end;
    cursor = end;
  }

  flushText(source.length);

  while (stack.length > 1) {
    const frame = stack.pop()!;
    frame.node.end = source.length;
    frame.container.end = source.length;
    frame.node.error = true;
    diagnostics.push({
      message: `{% ${frame.name} %} is never closed with {% end${frame.name} %}`,
      severity: "error",
      range: { start: frame.node.start, end: source.length },
    });
  }

  return { root, diagnostics, source };
}

function tokens(text: string, start: number): TwigNode[] {
  return tokenizeExpression(text, start).map((token) =>
    node(token.kind, token.start, token.end, [], { trivia: token.trivia }),
  );
}

function handleTag(input: {
  source: string;
  open: number;
  close: number;
  end: number;
  stack: Frame[];
  diagnostics: ParseDiagnostic[];
}): number | undefined {
  const { source, open, close, end, stack, diagnostics } = input;
  const inner = source.slice(open + 2, close);
  const name = tagName(inner);
  const frame = stack[stack.length - 1]!;
  const container = frame.container;

  if (name && name.startsWith("end") && name.length > 3) {
    const closing = name.slice(3);
    if (stack.length > 1 && frame.name === closing) {
      stack.pop();
      frame.container.end = open;
      frame.node.end = end;
      return undefined;
    }
    diagnostics.push({
      message: `{% ${name} %} does not close an open {% ${closing} %}`,
      severity: "error",
      range: { start: open, end },
    });
    container.children.push(node("error", open, end, [], { error: true }));
    return undefined;
  }

  const nameOffset = inner.indexOf(name ?? "");
  const argsStart = open + 2 + (name ? nameOffset + name.length : 0);
  const argsText = source.slice(argsStart, close);
  const paired = name !== null && PAIRED.has(name) && !(name === "set" && argsText.includes("="));

  if (!paired) {
    container.children.push(node(`tag:${name ?? "unknown"}`, open, end, tokens(argsText, argsStart)));
    return undefined;
  }

  const args = node("args", argsStart, close, tokens(argsText, argsStart));
  const body = node("body", end, end);
  const tag = node(`tag:${name}`, open, end, [args, body]);
  container.children.push(tag);

  if (name === "verbatim") {
    // A verbatim body is raw text, so it must not be scanned for Twig syntax.
    const endTag = source.indexOf("{% endverbatim %}", end);
    const stop = endTag === -1 ? source.length : endTag;
    if (stop > end) body.children.push(node("text", end, stop));
    body.end = stop;
    tag.end = endTag === -1 ? source.length : endTag + "{% endverbatim %}".length;
    if (endTag === -1) {
      tag.error = true;
      diagnostics.push({
        message: "{% verbatim %} is never closed",
        severity: "error",
        range: { start: open, end: source.length },
      });
    }
    return tag.end;
  }

  stack.push({ node: tag, container: body, name });
  return undefined;
}
