import { type ParserOptions, type ParserPlugin, parse as babelParse } from "@babel/parser";
import { VISITOR_KEYS, type Node as BabelNode } from "@babel/types";
import { type BuiltNode, insertComments, separatorGaps } from "@codestring/adapter-utils";
import { defineAdapter, type ParseDiagnostic, type TriviaClass } from "@codestring/core";

// A module specifier or an i18n key has to be a literal, so a hole there is
// written inside the quotes and stands for the whole literal.
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
  "TSInterfaceBody",
  "TSTypeLiteral",
  "TSUnionType",
  "TSIntersectionType",
  "VariableDeclaration",
]);

const COMMA_LISTS = new Set([
  "CallExpression",
  "NewExpression",
  "ArrayExpression",
  "ArrayPattern",
  "ObjectExpression",
  "ObjectPattern",
  "SequenceExpression",
  "TSTypeLiteral",
  "VariableDeclaration",
]);

/** The literal kinds Babel splits by value, all of which a pattern writes as a literal. */
const STRING_LITERALS = new Set(["StringLiteral", "DirectiveLiteral"]);

export interface BabelAdapterNode extends BuiltNode {
  children: BabelAdapterNode[];
  /** The Babel node this came from; absent on comments and error nodes. */
  raw?: BabelNode;
}

export interface BabelParsed {
  root: BabelAdapterNode;
  diagnostics: ParseDiagnostic[];
}

export interface BabelParseOptions {
  readonly sourceType?: ParserOptions["sourceType"];
  readonly plugins?: readonly ParserPlugin[];
}

/**
 * What Babel parses unless a caller says otherwise: the Administration dialect
 * of TypeScript. A plugin that is on costs nothing on a file that does not use
 * it, while a missing one is a parse error on a file that does.
 */
const DEFAULT_PLUGINS: ParserPlugin[] = [
  "typescript",
  "decorators-legacy",
  "classProperties",
  "dynamicImport",
  "importMeta",
  "topLevelAwait",
];

const make = (
  kind: string,
  start: number,
  end: number,
  trivia: TriviaClass = null,
): BabelAdapterNode => ({ kind, start, end, children: [], trivia, error: false });

const wrap = (
  kind: string,
  start: number,
  end: number,
  children: BabelAdapterNode[] = [],
  extra: Partial<BabelAdapterNode> = {},
): BabelAdapterNode => ({ kind, start, end, children, trivia: null, error: false, ...extra });

function isNode(value: unknown): value is BabelNode {
  return (
    value != null &&
    typeof value === "object" &&
    typeof (value as BabelNode).type === "string" &&
    Number.isInteger((value as BabelNode).start) &&
    Number.isInteger((value as BabelNode).end)
  );
}

/**
 * Children as Babel itself declares them. `VISITOR_KEYS` is the map its own
 * traversal uses, so there is nothing to infer from the object's keys and no
 * back-reference to walk into.
 */
function rawChildren(node: BabelNode): BabelNode[] {
  const found: BabelNode[] = [];
  for (const key of VISITOR_KEYS[node.type] ?? []) {
    const value = (node as unknown as Record<string, unknown>)[key];
    if (isNode(value)) found.push(value);
    else if (Array.isArray(value)) {
      for (const entry of value) if (isNode(entry)) found.push(entry);
    }
  }
  // A decorator is written before the thing it decorates but listed after it,
  // and a type parameter list likewise, so source order has to be restored.
  return found.sort((a, b) => a.start! - b.start! || b.end! - a.end!);
}

/** A trailing `;` belongs to the list this node sits in, not to the node. */
function withoutTerminator(node: BabelNode, children: readonly BabelAdapterNode[], source: string): number {
  const end = node.end!;
  const last = children[children.length - 1];
  const canShrink = end - node.start! > 1 && (!last || last.end <= end - 1);
  return canShrink && source[end - 1] === ";" ? end - 1 : end;
}

function convert(node: BabelNode, source: string): BabelAdapterNode {
  const children = rawChildren(node).map((child) => convert(child, source));
  const start = node.start!;
  const end = withoutTerminator(node, children, source);
  return wrap(node.type, start, end, separatorGaps(children, source, start, end, make), { raw: node });
}

/**
 * Build the normalized tree from a Babel AST that was parsed elsewhere, so a
 * codemod that already holds one — and needs to keep holding it, for the scope
 * chain `@babel/traverse` gives it — matches over that same tree rather than a
 * second parse of the same text.
 */
export function fromBabel(file: BabelNode, source: string): BabelParsed {
  const program = file.type === "File" ? (file as { program: BabelNode }).program : file;
  const comments = ((file as { comments?: readonly { start: number; end: number }[] }).comments ?? []).filter(
    (comment) => Number.isInteger(comment.start) && Number.isInteger(comment.end),
  );
  const children = rawChildren(program).map((child) => convert(child, source));
  const root = wrap("Program", 0, source.length, separatorGaps(children, source, 0, source.length, make), {
    raw: program,
  });
  insertComments(root, comments, make);
  return { root, diagnostics: [] };
}

/**
 * Babel adapter. Same normalized shape as the acorn-backed JavaScript adapter,
 * over a parser that reads TypeScript, JSX and decorators — and over an AST
 * someone else may already have built.
 */
export const babelAdapter = defineAdapter<BabelParsed, BabelAdapterNode>({
  id: "babel",

  parse(source, options = {}) {
    const { sourceType, plugins } = options as BabelParseOptions;
    try {
      const file = babelParse(source, {
        sourceType: sourceType ?? "module",
        plugins: [...(plugins ?? DEFAULT_PLUGINS)],
        allowReturnOutsideFunction: true,
        allowAwaitOutsideFunction: true,
        allowSuperOutsideMethod: true,
        allowImportExportEverywhere: true,
        errorRecovery: true,
        ranges: false,
      });
      const parsed = fromBabel(file, source);
      parsed.diagnostics = (file.errors ?? []).map((error) => ({
        message: (error as unknown as { message: string }).message,
        severity: "error" as const,
        range: { start: (error as unknown as { pos?: number }).pos ?? 0, end: source.length },
      }));
      return parsed;
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
    if (STRING_LITERALS.has(kind)) {
      return value.replace(/[\\"']/gu, "\\$&").replace(/\n/gu, "\\n").replace(/\r/gu, "\\r");
    }
    if (kind === "TemplateLiteral" || kind === "TemplateElement") {
      return value.replace(/[\\`]/gu, "\\$&").replace(/\$\{/gu, "\\${");
    }
    return value;
  },

  /** A string is what it says, not which quotes it was written with. */
  compareText(node, text) {
    if (!STRING_LITERALS.has(node.kind) || !/^["']/u.test(text)) return text;
    return `"${text.slice(1, -1).replace(/\\(['"])/gu, "$1")}"`;
  },

  isPatternWrapper: (kind) => kind === "ExpressionStatement",
  listSeparator: (kind) => (COMMA_LISTS.has(kind) ? ", " : null),

  placeholder(_index, { before, after, fallback }) {
    const prefix = IDENTIFIER_EDGE.test(before.slice(-1)) ? " " : "";
    const suffix = IDENTIFIER_EDGE.test(after.slice(0, 1)) ? " " : "";
    return `${prefix}${fallback}${suffix}`;
  },

  /** A statement carries its semicolon and a string its quotes; neither is the hole. */
  holeText: (_node, text) => text.trim().replace(/;$/u, "").trim().replace(/^(["'`])(.*)\1$/su, "$2"),
});
