import { defineAdapter, type ParseDiagnostic, type TriviaClass } from "@codestring/core";

export interface ToyNode {
  kind: string;
  start: number;
  end: number;
  children: ToyNode[];
  trivia: TriviaClass;
  error: boolean;
}

export interface ToyParsed {
  root: ToyNode;
  diagnostics: ParseDiagnostic[];
}

const node = (kind: string, start: number, end: number, children: ToyNode[] = [], trivia: TriviaClass = null): ToyNode => ({
  kind,
  start,
  end,
  children,
  trivia,
  error: false,
});

/**
 * A parenthesised toy language used to test the core without pulling in a real
 * parser: `(print "hi" (sum 1 2))`, plus `; line comments`.
 */
export function parseToy(source: string): ToyParsed {
  const diagnostics: ParseDiagnostic[] = [];
  const root = node("list", 0, source.length);
  const stack: ToyNode[] = [root];
  let i = 0;

  const top = () => stack[stack.length - 1]!;

  while (i < source.length) {
    const char = source[i]!;
    if (/\s/u.test(char)) {
      const start = i;
      while (i < source.length && /\s/u.test(source[i]!)) i++;
      top().children.push(node("whitespace", start, i, [], "whitespace"));
      continue;
    }
    if (char === ";") {
      const start = i;
      while (i < source.length && source[i] !== "\n") i++;
      top().children.push(node("comment", start, i, [], "comment"));
      continue;
    }
    if (char === "(") {
      const list = node("list", i, i + 1);
      top().children.push(list);
      stack.push(list);
      i++;
      continue;
    }
    if (char === ")") {
      if (stack.length === 1) {
        diagnostics.push({ message: "unexpected )", severity: "error", range: { start: i, end: i + 1 } });
        top().children.push(node("error", i, i + 1));
      } else {
        stack.pop()!.end = i + 1;
      }
      i++;
      continue;
    }
    if (char === '"') {
      const start = i;
      i++;
      while (i < source.length && source[i] !== '"') i++;
      i = Math.min(i + 1, source.length);
      top().children.push(node("string", start, i));
      continue;
    }
    const start = i;
    while (i < source.length && !/[\s()";]/u.test(source[i]!)) i++;
    top().children.push(node("atom", start, i));
  }

  while (stack.length > 1) {
    const unclosed = stack.pop()!;
    unclosed.end = source.length;
    unclosed.error = true;
    diagnostics.push({
      message: "unclosed (",
      severity: "error",
      range: { start: unclosed.start, end: source.length },
    });
  }

  return { root, diagnostics };
}


export const toyAdapter = defineAdapter<ToyParsed, ToyNode>({
  id: "toy",
  parse: (source) => parseToy(source),
  root: (parsed) => parsed.root,
  diagnostics: (parsed) => parsed.diagnostics,
  kind: (node) => node.kind,
  range: (node) => ({ start: node.start, end: node.end }),
  children: (node) => node.children,
  triviaClass: (node) => node.trivia,
  isErrorNode: (node) => node.error,
  isVariadic: (kind) => kind === "list",
  isHoleKind: (kind) => kind === "atom",
});
