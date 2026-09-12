import { type Comment, type Node as AcornNode, parse as acornParse } from "acorn";
import { defineAdapter, type ParseDiagnostic, type TriviaClass } from "@codestring/core";

const PLACEHOLDER = /^__sm_hole_(\d+)__$/u;
// A module specifier or an i18n key has to be a literal, so a hole there is
// written inside the quotes and stands for the whole literal.
const QUOTED_PLACEHOLDER = /^(["'`])__sm_hole_(\d+)__\1$/u;
const IDENTIFIER_EDGE = /[A-Za-z0-9_$]/u;

const VARIADIC = new Set([
  "Program",
  "BlockStatement",
  "ClassBody",
  "CallExpression",
  "NewExpression",
  "ArrayExpression",
  "ArrayPattern",
  "ObjectExpression",
  "ObjectPattern",
  "SequenceExpression",
  "SwitchStatement",
  "SwitchCase",
  "TemplateLiteral",
  "VariableDeclaration",
]);

// `parent` is a back-reference ESLint adds; following it would never terminate.
const SKIPPED_KEYS = new Set([
  "type",
  "start",
  "end",
  "loc",
  "range",
  "parent",
  "sourceFile",
  "leadingComments",
  "trailingComments",
  "comments",
  "tokens",
]);

export interface JavaScriptNode {
  kind: string;
  start: number;
  end: number;
  children: JavaScriptNode[];
  trivia: TriviaClass;
  error: boolean;
  /** The acorn node this came from; absent on comments and error nodes. */
  raw?: AcornNode;
}

export interface JavaScriptParsed {
  root: JavaScriptNode;
  diagnostics: ParseDiagnostic[];
}

export interface JavaScriptParseOptions {
  readonly sourceType?: "module" | "script";
}

/**
 * ESLint replaces `start`/`end` on its nodes with getters that throw, to push
 * callers towards `range`, so `range` is consulted first and the older fields
 * are only touched when it is absent.
 */
function nodeStart(node: AcornNode): number {
  const range = (node as { range?: readonly [number, number] }).range;
  return range ? range[0] : node.start;
}

function nodeEnd(node: AcornNode): number {
  const range = (node as { range?: readonly [number, number] }).range;
  return range ? range[1] : node.end;
}

function isNode(value: unknown): value is AcornNode {
  if (value == null || typeof value !== "object" || typeof (value as AcornNode).type !== "string") return false;
  const range = (value as { range?: readonly [number, number] }).range;
  if (Array.isArray(range)) return Number.isInteger(range[0]) && Number.isInteger(range[1]);
  return Number.isInteger((value as AcornNode).start) && Number.isInteger((value as AcornNode).end);
}

/**
 * ESTree reaches the same node twice in shorthand forms — `{ a }` has one node
 * as both key and value, `import { a }` as both imported and local — so equal
 * or overlapping regions collapse to the widest single child.
 */
function rawChildren(node: AcornNode): AcornNode[] {
  const found = new Set<AcornNode>();
  for (const key of Object.keys(node)) {
    if (SKIPPED_KEYS.has(key)) continue;
    const value = (node as unknown as Record<string, unknown>)[key];
    if (isNode(value)) found.add(value);
    else if (Array.isArray(value)) {
      for (const entry of value) if (isNode(entry)) found.add(entry);
    }
  }
  const sorted = [...found].sort((a, b) => nodeStart(a) - nodeStart(b) || nodeEnd(b) - nodeEnd(a));
  const children: AcornNode[] = [];
  let previousEnd = -1;
  for (const child of sorted) {
    if (nodeStart(child) < previousEnd) continue;
    children.push(child);
    previousEnd = nodeEnd(child);
  }
  return children;
}

const wrap = (
  kind: string,
  start: number,
  end: number,
  children: JavaScriptNode[] = [],
  extra: Partial<JavaScriptNode> = {},
): JavaScriptNode => ({ kind, start, end, children, trivia: null, error: false, ...extra });

const SEPARATORS = new Set([",", ";"]);

/**
 * ESTree puts a statement's terminating `;` inside the statement and gives a
 * `,` between list elements no node at all, so rewriting one element would eat
 * its terminator and removing one would strand the comma. Both become separator
 * nodes of their own: present in the tree, skipped when matching, and taken
 * along when the element beside them is removed.
 */
function separatorGaps(
  children: readonly JavaScriptNode[],
  source: string,
  parentStart: number,
  parentEnd: number,
): JavaScriptNode[] {
  if (children.length === 0) return [...children];

  const result: JavaScriptNode[] = [];
  // A gap may hold more than the separator — `; }` closes the block as well —
  // so only its first non-whitespace character is considered.
  const addGap = (from: number, to: number) => {
    let at = from;
    while (at < to && /\s/u.test(source[at]!)) at++;
    if (at >= to || !SEPARATORS.has(source[at]!)) return;
    result.push(wrap("separator", at, at + 1, [], { trivia: "separator" }));
  };

  let cursor = parentStart;
  for (const child of children) {
    addGap(cursor, child.start);
    result.push(child);
    cursor = child.end;
  }
  addGap(cursor, parentEnd);
  return result;
}

/** A trailing `;` belongs to the list this node sits in, not to the node. */
function withoutTerminator(node: AcornNode, children: readonly JavaScriptNode[], source: string): number {
  const end = nodeEnd(node);
  const last = children[children.length - 1];
  const canShrink = end - nodeStart(node) > 1 && (!last || last.end <= end - 1);
  return canShrink && source[end - 1] === ";" ? end - 1 : end;
}

function convert(node: AcornNode, source: string): JavaScriptNode {
  const children = rawChildren(node).map((child) => convert(child, source));
  const start = nodeStart(node);
  const end = withoutTerminator(node, children, source);
  return wrap(node.type, start, end, separatorGaps(children, source, start, end), { raw: node });
}

/** Acorn keeps comments out of the tree; put them back where they belong. */
function insertComments(root: JavaScriptNode, comments: readonly { start: number; end: number }[]): void {
  for (const comment of comments) {
    let target = root;
    let moved = true;
    while (moved) {
      moved = false;
      for (const child of target.children) {
        if (child.start <= comment.start && comment.end <= child.end) {
          target = child;
          moved = true;
          break;
        }
      }
    }
    const commentNode = wrap("Comment", comment.start, comment.end, [], { trivia: "comment" });
    const index = target.children.findIndex((child) => child.start >= comment.end);
    if (index === -1) target.children.push(commentNode);
    else target.children.splice(index, 0, commentNode);
  }
}

/**
 * Build the normalized tree from an ESTree program that was parsed elsewhere —
 * by ESLint, say — so a tool that already has an AST need not parse twice.
 */
export function fromEstree(
  program: AcornNode,
  source: string,
  comments: readonly { start: number; end: number }[] = [],
): JavaScriptParsed {
  const children = rawChildren(program).map((child) => convert(child, source));
  const root = wrap("Program", 0, source.length, separatorGaps(children, source, 0, source.length), {
    raw: program,
  });
  insertComments(root, comments);
  return { root, diagnostics: [] };
}

/**
 * JavaScript adapter. Children come from the ESTree tree in source order, and
 * comments are spliced back in as trivia so the trivia policies mean something.
 */
export const javascriptAdapter = defineAdapter<JavaScriptParsed, JavaScriptNode>({
  id: "javascript",

  parse(source, options = {}) {
    const comments: Comment[] = [];
    try {
      const program: AcornNode = acornParse(source, {
        ecmaVersion: "latest",
        sourceType: (options as JavaScriptParseOptions).sourceType ?? "module",
        allowReturnOutsideFunction: true,
        allowAwaitOutsideFunction: true,
        allowSuperOutsideMethod: true,
        allowImportExportEverywhere: true,
        onComment: comments,
      });
      return fromEstree(program, source, comments);
    } catch (error) {
      const at = Number.isInteger((error as { pos?: number }).pos) ? (error as { pos: number }).pos : 0;
      return {
        root: wrap("Program", 0, source.length, [wrap("error", at, source.length, [], { error: true })]),
        diagnostics: [
          { message: (error as Error).message, severity: "error", range: { start: at, end: source.length } },
        ],
      };
    }
  },

  root: (parsed) => parsed.root,
  diagnostics: (parsed) => parsed.diagnostics,
  kind: (node) => node.kind,
  range: (node) => ({ start: node.start, end: node.end }),
  children: (node) => node.children,
  triviaClass: (node) => node.trivia,
  isErrorNode: (node) => node.error,
  isVariadic: (kind) => VARIADIC.has(kind),

  /** A value written into a string literal must not be able to end it. */
  escape(value, { kind }) {
    if (kind === "Literal") {
      return value.replace(/[\\"']/gu, "\\$&").replace(/\n/gu, "\\n").replace(/\r/gu, "\\r");
    }
    if (kind === "TemplateLiteral" || kind === "TemplateElement") {
      return value.replace(/[\\`]/gu, "\\$&").replace(/\$\{/gu, "\\${");
    }
    return value;
  },

  /** A string is what it says, not which quotes it was written with. */
  compareText(node, text) {
    if (node.kind !== "Literal" || !/^["']/u.test(text)) return text;
    return `"${text.slice(1, -1).replace(/\\(['"])/gu, "$1")}"`;
  },
  isPatternWrapper: (kind) => kind === "ExpressionStatement",

  placeholder(_index, { before, after, fallback }) {
    const prefix = IDENTIFIER_EDGE.test(before.slice(-1)) ? " " : "";
    const suffix = IDENTIFIER_EDGE.test(after.slice(0, 1)) ? " " : "";
    return `${prefix}${fallback}${suffix}`;
  },

  /**
   * Any node whose whole text is the placeholder is the hole. The walk is
   * top-down, so the outermost such node wins — which is what lets a hole stand
   * for an import clause without the pattern having to name which kind of
   * specifier it is.
   */
  detectPlaceholder(_node, text) {
    const bare = PLACEHOLDER.exec(text.trim().replace(/;$/u, "").trim());
    if (bare) return Number(bare[1]);
    const quoted = QUOTED_PLACEHOLDER.exec(text.trim());
    return quoted ? Number(quoted[2]) : null;
  },
});
