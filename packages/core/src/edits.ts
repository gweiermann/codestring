import { OverlappingEditError, SourceRevisionError, formatLocation } from "./errors.js";
import { SourceDocument, SourceSlice } from "./source.js";
import { NodeRef } from "./nodes.js";
import { type SourceValue, replacementText } from "./template.js";

const EDIT = Symbol.for("codestring.edit");

export type EditOperation = "replace" | "remove" | "insertBefore" | "insertAfter";

/** Anything with a source range an edit can point at. */
export interface EditTarget {
  readonly range?: SourceSlice;
}

export type EditTargetInput = SourceSlice | NodeRef<any> | EditTarget;

export interface Edit {
  readonly [EDIT]: true;
  readonly operation: EditOperation;
  readonly slice: SourceSlice;
  readonly replacement: SourceValue;
  /**
   * A separator this removal may also take, if nothing else claims it. The
   * library chose this range, so unlike the range the caller named it yields
   * rather than failing.
   */
  readonly extension?: { readonly start: number; readonly end: number };
  toString(): string;
}

export interface TextEdit {
  readonly start: number;
  readonly end: number;
  readonly replacement: string;
}

function targetSlice(target: EditTargetInput, operation: EditOperation): SourceSlice {
  if (target instanceof SourceSlice) return target;
  if (target instanceof NodeRef) return target.slice();
  if (target && (target as EditTarget).range instanceof SourceSlice) {
    return (target as EditTarget).range!;
  }
  throw new TypeError(`${operation}() needs a capture result, source slice, node or match as its target`);
}

function edit(operation: EditOperation, target: EditTargetInput, replacement: SourceValue): Edit {
  const slice = targetSlice(target, operation);
  return {
    [EDIT]: true,
    operation,
    slice,
    replacement,
    toString() {
      return `${operation}(${slice.start}..${slice.end})`;
    },
  };
}

export function replace(target: EditTargetInput, replacement: SourceValue): Edit {
  return edit("replace", target, replacement);
}

/**
 * Delete a list element, separator and all. A `;` between two CSS declarations
 * or a `,` between two arguments belongs to the list, so removing one element
 * without it would leave the list malformed.
 */
export function remove(target: EditTargetInput): Edit {
  const separator = adjacentSeparator(target);
  const base = edit("remove", target, "");
  return separator ? { ...base, extension: separator } : base;
}

/** The one separator beside a matched sibling run: after it, or before it when it is last. */
function adjacentSeparator(target: EditTargetInput): { start: number; end: number } | undefined {
  // A node is its own one-element run, so `remove(node)` reaches its separator
  // the same way `remove(match)` does.
  const nodes =
    target instanceof NodeRef ? [target] : (target as { nodes?: readonly NodeRef<unknown>[] }).nodes;
  let first = nodes?.[0];
  let last = nodes?.[nodes.length - 1];
  if (!first || !last) return undefined;

  // A lone node wrapped in something that covers exactly the same source — an
  // expression inside its expression statement — sits in the outer list, and
  // that is where its separator lives.
  while (nodes!.length === 1 && first.parent && first.parent.start === first.start && first.parent.end === first.end) {
    first = first.parent;
    last = first;
  }

  const siblings = last.parent?.children;
  if (!siblings) return undefined;

  for (let i = siblings.indexOf(last) + 1; i < siblings.length; i++) {
    const sibling = siblings[i]!;
    if (sibling.trivia === "whitespace") continue;
    return sibling.trivia === "separator" ? { start: sibling.start, end: sibling.end } : undefined;
  }
  for (let i = siblings.indexOf(first) - 1; i >= 0; i--) {
    const sibling = siblings[i]!;
    if (sibling.trivia === "whitespace") continue;
    return sibling.trivia === "separator" ? { start: sibling.start, end: sibling.end } : undefined;
  }
  return undefined;
}

export function insertBefore(target: EditTargetInput, replacement: SourceValue): Edit {
  return edit("insertBefore", target, replacement);
}

export function insertAfter(target: EditTargetInput, replacement: SourceValue): Edit {
  return edit("insertAfter", target, replacement);
}

export function isEdit(value: unknown): value is Edit {
  return Boolean(value && (value as Edit)[EDIT]);
}

interface PlacedEdit {
  start: number;
  end: number;
  readonly replacement: string;
  readonly index: number;
  readonly entry: Edit;
}

function toTextEdit(entry: Edit, index: number): PlacedEdit {
  const { slice, operation, replacement } = entry;
  const text = replacementText(replacement);
  if (operation === "insertBefore") return { start: slice.start, end: slice.start, replacement: text, index, entry };
  if (operation === "insertAfter") return { start: slice.end, end: slice.end, replacement: text, index, entry };
  return { start: slice.start, end: slice.end, replacement: text, index, entry };
}

/** Take each removal's separator too, unless another edit already covers it. */
function widenRemovals(textEdits: PlacedEdit[]): void {
  for (const entry of textEdits) {
    const extension = entry.entry.extension;
    if (!extension || entry.entry.operation !== "remove") continue;
    const start = Math.min(entry.start, extension.start);
    const end = Math.max(entry.end, extension.end);
    const claimed = textEdits.some(
      (other) => other !== entry && other.start < end && start < other.end,
    );
    if (claimed) continue;
    entry.start = start;
    entry.end = end;
  }
}

/**
 * Validate a set of edits against one document and resolve them to plain ranges,
 * without touching the text. Useful wherever another tool wants to apply the
 * edits itself — an ESLint fixer, an LSP code action.
 */
export function planEdits(
  document: SourceDocument,
  edits: readonly (Edit | null | undefined)[] | Edit,
): TextEdit[] {
  return placeEdits(document, edits).map(({ start, end, replacement }) => ({ start, end, replacement }));
}

/**
 * Validate a set of edits against one document and produce the new text.
 * Overlaps are refused rather than merged: silently picking a winner is how a
 * codemod corrupts a file.
 */
export function applyEdits(document: SourceDocument, edits: readonly (Edit | null | undefined)[] | Edit): string {
  let result = "";
  let cursor = 0;
  for (const textEdit of placeEdits(document, edits)) {
    result += document.text.slice(cursor, textEdit.start);
    result += textEdit.replacement;
    cursor = textEdit.end;
  }
  return result + document.text.slice(cursor);
}

function placeEdits(
  document: SourceDocument,
  edits: readonly (Edit | null | undefined)[] | Edit,
): PlacedEdit[] {
  if (!(document instanceof SourceDocument)) {
    throw new TypeError("applyEdits() needs a SourceDocument");
  }
  const list = (Array.isArray(edits) ? edits : [edits]).filter(Boolean) as Edit[];
  for (const entry of list) {
    if (!isEdit(entry)) {
      throw new TypeError("transform() takes edit values from replace/remove/insertBefore/insertAfter");
    }
    if (entry.slice.document !== document) {
      throw new SourceRevisionError(
        `${entry.operation}() targets a different source document ` +
          `(${entry.slice.document.id ?? "anonymous"} vs ${document.id ?? "anonymous"})`,
        { edit: entry },
      );
    }
  }

  // At one position an insert sorts before a wider edit, so inserting at the edge
  // of a replaced range works whichever order the two were listed in. Remaining
  // ties keep the caller's order, which orders inserts at the same position.
  const textEdits = list.map(toTextEdit);
  const width = (entry: PlacedEdit) => (entry.start === entry.end ? 0 : 1);
  textEdits.sort((a, b) => a.start - b.start || width(a) - width(b) || a.index - b.index);

  for (let i = 1; i < textEdits.length; i++) {
    const previous = textEdits[i - 1]!;
    const current = textEdits[i]!;
    if (current.start < previous.end) {
      throw new OverlappingEditError(
        `overlapping edits: ${previous.entry.operation} at ${formatLocation(document, previous.start)} ` +
          `(${previous.start}..${previous.end}) and ${current.entry.operation} at ` +
          `${formatLocation(document, current.start)} (${current.start}..${current.end}). ` +
          "Split the transform or widen one edit to cover the other.",
        { edits: [previous.entry, current.entry] },
      );
    }
  }

  widenRemovals(textEdits);
  textEdits.sort((a, b) => a.start - b.start || width(a) - width(b) || a.index - b.index);
  return textEdits;
}
