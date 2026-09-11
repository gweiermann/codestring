import {
  type CaptureSet,
  type CodeFragment,
  type Edit,
  type Match,
  SourceDocument,
  planEdits,
} from "@codestring/core";
import type { Rule } from "eslint";
import type { JavaScriptNode } from "@codestring/javascript";
import { type EslintSourceCode, eslintLanguage } from "./language.js";

type RuleMatch<Captures extends CaptureSet> = Match<Captures, JavaScriptNode>;

/** What a rule may hand back to fix what it found. */
export type RuleFix<Captures extends CaptureSet> = (
  match: RuleMatch<Captures>,
) => Edit | readonly Edit[] | string | null | undefined;

export interface RuleOptions<Captures extends CaptureSet> {
  /** ESLint's own `meta`, passed through untouched. */
  readonly meta?: Rule.RuleModule["meta"];
  /** What the rule looks for. */
  readonly find: CodeFragment<Captures>;
  /** Narrow it further than the pattern can say. */
  readonly where?: (match: RuleMatch<Captures>) => boolean;
  /** The report text, or a `messageId` from `meta.messages`. */
  readonly message?: string;
  readonly messageId?: string;
  /** Placeholders for the message, built from what the match captured. */
  readonly data?: (match: RuleMatch<Captures>) => Record<string, string>;
  /** Report the whole match, or one capture of it. */
  readonly report?: (match: RuleMatch<Captures>) => { start: number; end: number };
  /** An autofix. Returning nothing reports without offering one. */
  readonly fix?: RuleFix<Captures>;
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

function toFixes<Captures extends CaptureSet>(
  produced: ReturnType<RuleFix<Captures>>,
  match: RuleMatch<Captures>,
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
export function createRule<Captures extends CaptureSet>(options: RuleOptions<Captures>): Rule.RuleModule {
  const { find, where, message, messageId, data, report, fix, suggest } = options;

  return {
    meta: options.meta ?? {},
    create(context: EslintContext & Rule.RuleContext) {
      return {
        "Program:exit"() {
          const sourceCode = context.sourceCode ?? context.getSourceCode?.();
          if (!sourceCode) return;
          const document = eslintLanguage(sourceCode).parse(sourceCode.text);

          for (const match of document.matchAll(find)) {
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
