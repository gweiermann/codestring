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
  /** How this insert keeps the list it lands in well formed. */
  readonly separation?: Separation;
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

function edit(
  operation: EditOperation,
  target: EditTargetInput,
  replacement: SourceValue,
  separation?: Separation,
): Edit {
  const slice = targetSlice(target, operation);
  return {
    [EDIT]: true,
    operation,
    slice,
    replacement,
    separation,
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

/**
 * Insert next to a node, keeping the list it belongs to well formed.
 *
 * What separates two items is read off the tree — the region between two
 * siblings already there, which is `", "` in an argument list, `" "` between
 * attributes and `";\n    "` between statements, indentation included. When the
 * list is too short to show one, two things that would fuse into one word get a
 * space and nothing else gets anything. Text that already carries the
 * separation is left alone, so this never doubles it.
 */
export function insertBefore(target: EditTargetInput, replacement: SourceValue): Edit {
  return edit("insertBefore", target, replacement, separationFor(target, "before"));
}

export function insertAfter(target: EditTargetInput, replacement: SourceValue): Edit {
  return edit("insertAfter", target, replacement, separationFor(target, "after"));
}

/**
 * What already sits between this item and the one next to it — read off the
 * tree, so it carries the list's own spacing and indentation. Separators and
 * trivia are part of the answer, not obstacles to it.
 */
function observedSeparation(anchor: NodeRef<unknown>, side: "before" | "after"): string | null {
  const siblings = anchor.parent?.children;
  if (!siblings) return null;
  const items = siblings.filter((node) => node.trivia === null);
  const index = items.indexOf(anchor);
  if (index === -1) return null;

  const neighbour = side === "after" ? items[index + 1] : items[index - 1];
  const fallback = side === "after" ? items[index - 1] : items[index + 1];
  const [left, right] =
    neighbour !== undefined
      ? side === "after"
        ? [anchor, neighbour]
        : [neighbour, anchor]
      : fallback !== undefined
        ? side === "after"
          ? [fallback, anchor]
          : [anchor, fallback]
        : [undefined, undefined];

  if (!left || !right) return null;
  return left.document.text.slice(left.end, right.start);
}

function separationFor(target: EditTargetInput, side: "before" | "after"): Separation | undefined {
  const nodes = target instanceof NodeRef ? [target] : (target as { nodes?: readonly NodeRef<unknown>[] }).nodes;
  const anchor = side === "before" ? nodes?.[0] : nodes?.[nodes.length - 1];
  if (!anchor) return undefined;
  // Only a list separates its items; the parts of a fixed construct do not.
  const observed = anchor.parent?.variadic ? observedSeparation(anchor, side) : null;
  return { side, observed, anchor };
}

interface Separation {
  readonly side: "before" | "after";
  readonly observed: string | null;
  readonly anchor: NodeRef<unknown>;
}

const WORD_EDGE = /\w/u;

/** What to put between two pieces of source so they do not fuse. */
function separatorText(separation: Separation, inserted: string): string {
  if (inserted.length === 0) return "";
  const joining = separation.side === "after" ? inserted[0]! : inserted[inserted.length - 1]!;
  const neighbour =
    separation.side === "after"
      ? separation.anchor.document.text[separation.anchor.end - 1]
      : separation.anchor.document.text[separation.anchor.start];

  if (separation.observed !== null && separation.observed.length > 0) {
    const already =
      separation.side === "after"
        ? inserted.startsWith(separation.observed) || /^\s/u.test(inserted)
        : inserted.endsWith(separation.observed) || /\s$/u.test(inserted);
    return already ? "" : separation.observed;
  }

  const wouldFuse = WORD_EDGE.test(joining) && neighbour !== undefined && WORD_EDGE.test(neighbour);
  return wouldFuse ? " " : "";
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
  if (operation === "insertBefore") {
    const separated = entry.separation ? text + separatorText(entry.separation, text) : text;
    return { start: slice.start, end: slice.start, replacement: separated, index, entry };
  }
  if (operation === "insertAfter") {
    const separated = entry.separation ? separatorText(entry.separation, text) + text : text;
    return { start: slice.end, end: slice.end, replacement: separated, index, entry };
  }
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
