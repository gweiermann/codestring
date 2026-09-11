import {
  type CaptureSet,
  type CodeFragment,
  type Edit,
  type Language,
  type Match,
  SourceDocument,
  planEdits,
} from "@codestring/core";
import type { Rule } from "eslint";
import type { JavaScriptNode } from "@codestring/javascript";
import { type EslintSourceCode, eslintLanguage } from "./language.js";

type RuleMatch<Captures extends CaptureSet, TNode = JavaScriptNode> = Match<Captures, TNode>;

/** What a rule may hand back to fix what it found. */
export type RuleFix<Captures extends CaptureSet, TNode = JavaScriptNode> = (
  match: RuleMatch<Captures, TNode>,
) => Edit | readonly Edit[] | string | null | undefined;

export interface RuleOptions<Captures extends CaptureSet, TNode = JavaScriptNode> {
  /** ESLint's own `meta`, passed through untouched. */
  readonly meta?: Rule.RuleModule["meta"];
  /**
   * How to read the file. The default reuses the AST ESLint already built, which
   * is the script. A rule about markup — a Vue or Twig template — passes the
   * language that can read it, and the file's text is parsed with that instead.
   */
  readonly language?: Language<any>;
  /** What the rule looks for. */
  readonly find: CodeFragment<Captures>;
  /** Narrow it further than the pattern can say. */
  readonly where?: (match: RuleMatch<Captures, TNode>) => boolean;
  /** The report text, or a `messageId` from `meta.messages`. */
  readonly message?: string;
  readonly messageId?: string;
  /** Placeholders for the message, built from what the match captured. */
  readonly data?: (match: RuleMatch<Captures, TNode>) => Record<string, string>;
  /** Report the whole match, or one capture of it. */
  readonly report?: (match: RuleMatch<Captures, TNode>) => { start: number; end: number };
  /** An autofix. Returning nothing reports without offering one. */
  readonly fix?: RuleFix<Captures, TNode>;
  /** Offer the fix as a suggestion instead of applying it automatically. */
  readonly suggest?: string;
}

interface EslintFixer {
  replaceTextRange(range: [number, number], text: string): unknown;
  removeRange(range: [number, number]): unknown;
}

interface EslintContext {
  sourceCode?: EslintSourceCode;
  getSourceCode?: () => EslintSourceCode;
  report(descriptor: Record<string, unknown>): void;
}

function locationOf(document: SourceDocument, start: number, end: number) {
  const from = document.positionAt(start);
  const to = document.positionAt(end);
  // ESLint counts columns from zero; everything else here counts from one.
  return {
    start: { line: from.line, column: from.column - 1 },
    end: { line: to.line, column: to.column - 1 },
  };
}

function toFixes<Captures extends CaptureSet, TNode>(
  produced: ReturnType<RuleFix<Captures, TNode>>,
  match: RuleMatch<Captures, TNode>,
  fixer: EslintFixer,
): unknown[] | null {
  if (produced == null) return null;
  if (typeof produced === "string") {
    return [fixer.replaceTextRange([match.start, match.end], produced)];
  }
  const edits = Array.isArray(produced) ? (produced as readonly Edit[]) : [produced as Edit];
  if (edits.length === 0) return null;
  // planEdits validates the set the same way a transform would, so a rule
  // cannot hand ESLint two fixes that overlap.
  return planEdits(match.document, edits).map((edit) =>
    edit.replacement === ""
      ? fixer.removeRange([edit.start, edit.end])
      : fixer.replaceTextRange([edit.start, edit.end], edit.replacement),
  );
}

/**
 * An ESLint rule written as a pattern: find this, say that, fix it like this.
 * The visitor, the node bookkeeping and the fixer ranges are handled for you.
 */
export function createRule<Captures extends CaptureSet, TNode = JavaScriptNode>(
  options: RuleOptions<Captures, TNode>,
): Rule.RuleModule {
  const { find, where, message, messageId, data, report, fix, suggest } = options;

  return {
    meta: options.meta ?? {},
    create(context: EslintContext & Rule.RuleContext) {
      return {
        "Program:exit"() {
          const sourceCode = context.sourceCode ?? context.getSourceCode?.();
          if (!sourceCode) return;
          const language = options.language ?? eslintLanguage(sourceCode);
          const document = language.parse(sourceCode.text) as unknown as ReturnType<
            ReturnType<typeof eslintLanguage>["parse"]
          >;

          for (const found of document.matchAll(find)) {
            const match = found as unknown as RuleMatch<Captures, TNode>;
            if (where && !where(match)) continue;

            const at = report ? report(match) : { start: match.start, end: match.end };
            const descriptor: Record<string, unknown> = {
              loc: locationOf(document.document, at.start, at.end),
              ...(messageId ? { messageId } : { message: message ?? "Matched a disallowed pattern" }),
              ...(data ? { data: data(match) } : {}),
            };

            if (fix) {
              const apply = (fixer: EslintFixer) => toFixes(fix(match), match, fixer);
              if (suggest) {
                descriptor.suggest = [{ desc: suggest, fix: apply }];
              } else {
                descriptor.fix = apply;
              }
            }

            context.report(descriptor);
          }
        },
      };
    },
  };
}
