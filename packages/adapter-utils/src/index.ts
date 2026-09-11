import type { TriviaClass } from "@codestring/core";

const WHITESPACE = /\s/u;

export interface Segment {
  readonly kind: string;
  readonly start: number;
  readonly end: number;
  readonly trivia: TriviaClass;
}

/**
 * Split a text run into leading whitespace, body and trailing whitespace so a
 * capture can bind the meaningful part without swallowing the indentation
 * around it. A run that is only whitespace stays one whitespace segment.
 */
export function splitTextTrivia(text: string, start: number, kind = "text"): Segment[] {
  if (text.length === 0) return [];
  const trimmedStart = text.length - text.trimStart().length;
  if (trimmedStart === text.length) {
    return [{ kind: "whitespace", start, end: start + text.length, trivia: "whitespace" }];
  }
  const trimmedEnd = text.length - text.trimEnd().length;
  const segments: Segment[] = [];
  if (trimmedStart > 0) {
    segments.push({ kind: "whitespace", start, end: start + trimmedStart, trivia: "whitespace" });
  }
  segments.push({
    kind,
    start: start + trimmedStart,
    end: start + text.length - trimmedEnd,
    trivia: null,
  });
  if (trimmedEnd > 0) {
    segments.push({
      kind: "whitespace",
      start: start + text.length - trimmedEnd,
      end: start + text.length,
      trivia: "whitespace",
    });
  }
  return segments;
}

const NAME_START = /[A-Za-z_$À-\u{10FFFF}]/u;
const NAME_PART = /[A-Za-z0-9_$À-\u{10FFFF}]/u;

export type ExpressionTokenKind = "whitespace" | "string" | "number" | "name" | "operator";

export interface ExpressionToken extends Segment {
  readonly kind: ExpressionTokenKind;
}

/**
 * Tokenize an expression-ish fragment into names, numbers, strings, operators
 * and whitespace. Adapters for template languages use this so a hole can sit
 * anywhere inside a tag instead of only replacing the whole argument text.
 */
export function tokenizeExpression(text: string, start: number): ExpressionToken[] {
  const tokens: ExpressionToken[] = [];
  let i = 0;
  while (i < text.length) {
    const char = text[i]!;
    if (WHITESPACE.test(char)) {
      const from = i;
      while (i < text.length && WHITESPACE.test(text[i]!)) i++;
      tokens.push({ kind: "whitespace", start: start + from, end: start + i, trivia: "whitespace" });
      continue;
    }
    if (char === '"' || char === "'") {
      const from = i;
      i++;
      while (i < text.length && text[i] !== char) {
        if (text[i] === "\\") i++;
        i++;
      }
      i = Math.min(i + 1, text.length);
      tokens.push({ kind: "string", start: start + from, end: start + i, trivia: null });
      continue;
    }
    if (char >= "0" && char <= "9") {
      const from = i;
      while (i < text.length && /[0-9._]/u.test(text[i]!)) i++;
      tokens.push({ kind: "number", start: start + from, end: start + i, trivia: null });
      continue;
    }
    if (NAME_START.test(char)) {
      const from = i;
      i++;
      while (i < text.length && NAME_PART.test(text[i]!)) i++;
      tokens.push({ kind: "name", start: start + from, end: start + i, trivia: null });
      continue;
    }
    tokens.push({ kind: "operator", start: start + i, end: start + i + 1, trivia: null });
    i++;
  }
  return tokens;
}

/** True when `before` leaves an unclosed delimiter, e.g. still inside `<div `. */
export function isInsideDelimiter(before: string, open: string, close: string): boolean {
  return before.lastIndexOf(open) > before.lastIndexOf(close);
}

/** Placeholder text padded so it cannot fuse with the literal in front of it. */
export function padPlaceholder(
  placeholder: string,
  before: string,
  options: { needsSpace: boolean },
): string {
  if (!options.needsSpace) return placeholder;
  return /\s$/u.test(before) ? placeholder : ` ${placeholder}`;
}
