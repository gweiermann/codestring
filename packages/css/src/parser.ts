import { splitTextTrivia } from "@codestring/adapter-utils";
import type { ParseDiagnostic, TriviaClass } from "@codestring/core";

export interface CssNode {
  kind: string;
  start: number;
  end: number;
  children: CssNode[];
  trivia: TriviaClass;
  error: boolean;
}

export interface CssParsed {
  root: CssNode;
  diagnostics: ParseDiagnostic[];
}

const node = (
  kind: string,
  start: number,
  end: number,
  children: CssNode[] = [],
  extra: Partial<Pick<CssNode, "trivia" | "error">> = {},
): CssNode => ({ kind, start, end, children, trivia: null, error: false, ...extra });

function textNodes(source: string, start: number, end: number, kind: string): CssNode[] {
  return splitTextTrivia(source.slice(start, end), start, kind).map((segment) =>
    node(segment.kind, segment.start, segment.end, [], { trivia: segment.trivia }),
  );
}

/**
 * Rules, declarations, at-rules and comments — enough structure to match and
 * rewrite a stylesheet, not a full CSS grammar.
 */
export function parseCss(source: string): CssParsed {
  const diagnostics: ParseDiagnostic[] = [];
  let cursor = 0;

  const parseBlock = (from: number, stopAtBrace: boolean): { children: CssNode[]; end: number } => {
    const children: CssNode[] = [];
    let start = from;

    const flushTrivia = (until: number) => {
      if (until > start) children.push(...textNodes(source, start, until, "text"));
      start = until;
    };

    while (cursor < source.length) {
      const char = source[cursor]!;

      if (/\s/u.test(char)) {
        cursor++;
        continue;
      }

      if (char === "}" && stopAtBrace) {
        flushTrivia(cursor);
        cursor++;
        return { children, end: cursor };
      }

      if (source.startsWith("/*", cursor)) {
        flushTrivia(cursor);
        const close = source.indexOf("*/", cursor + 2);
        const end = close === -1 ? source.length : close + 2;
        children.push(node("comment", cursor, end, [], { trivia: "comment" }));
        cursor = end;
        start = cursor;
        continue;
      }

      if (char === ";") {
        flushTrivia(cursor);
        children.push(node("separator", cursor, cursor + 1, [], { trivia: "separator" }));
        cursor++;
        start = cursor;
        continue;
      }

      flushTrivia(cursor);
      const before = cursor;
      children.push(parseStatement());
      if (cursor === before) {
        // A stray delimiter the grammar has no place for; keep the tree moving.
        diagnostics.push({
          message: `unexpected ${JSON.stringify(char)}`,
          severity: "error",
          range: { start: cursor, end: cursor + 1 },
        });
        children[children.length - 1] = node("error", cursor, cursor + 1, [], { error: true });
        cursor++;
      }
      start = cursor;
    }

    flushTrivia(source.length);
    if (stopAtBrace) {
      diagnostics.push({ message: "unclosed block", severity: "error", range: { start: from, end: source.length } });
    }
    return { children, end: cursor };
  };

  const parseStatement = (): CssNode => {
    const from = cursor;
    while (cursor < source.length && !"{};".includes(source[cursor]!)) {
      if (source.startsWith("/*", cursor)) {
        const close = source.indexOf("*/", cursor + 2);
        cursor = close === -1 ? source.length : close + 2;
        continue;
      }
      cursor++;
    }
    const head = source.slice(from, cursor).trim();
    const terminator = source[cursor];

    if (terminator === "{") {
      const headEnd = from + source.slice(from, cursor).trimEnd().length;
      const headStart = from + (source.slice(from, cursor).length - source.slice(from, cursor).trimStart().length);
      cursor++;
      const blockStart = cursor;
      const block = parseBlock(blockStart, true);
      const kind = head.startsWith("@") ? "at-rule" : "rule";
      const headKind = head.startsWith("@") ? "prelude" : "selector";
      return node(kind, from, block.end, [
        node(headKind, headStart, headEnd),
        node("block", blockStart, block.end, block.children),
      ]);
    }

    if (terminator === ";" || terminator === undefined || terminator === "}") {
      // The semicolon is a separator of its own, so rewriting a declaration
      // cannot swallow it and a pattern need not spell it out.
      const end = from + head.length;
      if (head.length === 0 && terminator !== ";") return node("text", from, Math.max(end, cursor));
      if (head.startsWith("@")) return node("at-statement", from, end, [node("prelude", from, end)]);

      const colon = source.indexOf(":", from);
      if (colon === -1 || colon > from + head.length) {
        return node("text", from, end);
      }
      const propertyText = source.slice(from, colon);
      const propertyStart = from + (propertyText.length - propertyText.trimStart().length);
      const propertyEnd = from + propertyText.trimEnd().length;
      const valueRaw = source.slice(colon + 1, from + head.length);
      const valueStart = colon + 1 + (valueRaw.length - valueRaw.trimStart().length);
      const valueEnd = colon + 1 + valueRaw.trimEnd().length;
      return node("declaration", from, end, [
        node("property", propertyStart, propertyEnd),
        node("value", valueStart, Math.max(valueStart, valueEnd)),
      ]);
    }

    return node("text", from, cursor);
  };

  const top = parseBlock(0, false);
  return { root: node("stylesheet", 0, source.length, top.children), diagnostics };
}
