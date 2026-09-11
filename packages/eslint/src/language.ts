import { type Language, type LanguageAdapter, createLanguage, defineAdapter } from "@codestring/core";
import {
  type JavaScriptNode,
  type JavaScriptParsed,
  fromEstree,
  javascriptAdapter,
} from "@codestring/javascript";

/** The part of ESLint's SourceCode this needs — kept structural, so no ESLint import. */
export interface EslintSourceCode {
  readonly text: string;
  readonly ast: unknown;
  getAllComments?: () => readonly { range?: readonly [number, number]; start?: number; end?: number }[];
}

function commentRanges(sourceCode: EslintSourceCode): { start: number; end: number }[] {
  const comments = sourceCode.getAllComments?.() ?? [];
  return comments.map((comment) => ({
    start: comment.range?.[0] ?? comment.start ?? 0,
    end: comment.range?.[1] ?? comment.end ?? 0,
  }));
}

/**
 * A language backed by the AST ESLint already built. Nothing is parsed twice,
 * and because the tree is read structurally rather than by node type, whatever
 * parser ESLint was configured with comes along.
 */
export function eslintLanguage(sourceCode: EslintSourceCode): Language<LanguageAdapter<JavaScriptParsed, JavaScriptNode>> {
  const adapter = defineAdapter<JavaScriptParsed, JavaScriptNode>({
    ...javascriptAdapter,
    id: "eslint",
    parse(source, options) {
      // A nested parse asks for a slice, which ESLint's tree cannot answer.
      if (source !== sourceCode.text) return javascriptAdapter.parse(source, options);
      return fromEstree(sourceCode.ast as never, sourceCode.text, commentRanges(sourceCode));
    },
  });
  return createLanguage(adapter);
}
