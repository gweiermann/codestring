import { SourceRevisionError } from "./errors.js";

/** A UTF-16 code-unit offset into a SourceDocument. */
export type Offset = number;

export interface Position {
  readonly line: number;
  readonly column: number;
}

let nextRevision = 0;

/**
 * An immutable snapshot of one source text. Every range in the library is a
 * UTF-16 code-unit offset into exactly one of these.
 */
export class SourceDocument {
  readonly text: string;
  readonly id: string | undefined;
  readonly revision: number;
  #lineStarts: readonly number[] | null = null;

  constructor(text: string, id?: string) {
    if (typeof text !== "string") {
      throw new TypeError("SourceDocument requires a string");
    }
    this.text = text;
    this.id = id;
    this.revision = nextRevision++;
  }

  get length(): number {
    return this.text.length;
  }

  slice(start: Offset, end: Offset): SourceSlice {
    return new SourceSlice(this, start, end);
  }

  whole(): SourceSlice {
    return new SourceSlice(this, 0, this.text.length);
  }

  lineStarts(): readonly number[] {
    if (this.#lineStarts) return this.#lineStarts;
    const starts = [0];
    for (let i = 0; i < this.text.length; i++) {
      if (this.text.charCodeAt(i) === 10) starts.push(i + 1);
    }
    this.#lineStarts = starts;
    return starts;
  }

  positionAt(offset: Offset): Position {
    const clamped = Math.max(0, Math.min(offset, this.text.length));
    const starts = this.lineStarts();
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (starts[mid]! <= clamped) low = mid;
      else high = mid - 1;
    }
    return { line: low + 1, column: clamped - starts[low]! + 1 };
  }

  offsetAt(position: Position): Offset {
    const starts = this.lineStarts();
    const index = Math.max(0, Math.min(position.line - 1, starts.length - 1));
    const lineEnd = index + 1 < starts.length ? starts[index + 1]! - 1 : this.text.length;
    return Math.min(starts[index]! + Math.max(0, position.column - 1), lineEnd);
  }
}

export function toDocument(input: string | SourceDocument | SourceSlice, id?: string): SourceDocument {
  if (input instanceof SourceDocument) return input;
  if (input instanceof SourceSlice) return input.document;
  return new SourceDocument(String(input), id);
}

/** An absolute region of one SourceDocument. */
export class SourceSlice {
  readonly document: SourceDocument;
  readonly start: Offset;
  readonly end: Offset;

  constructor(document: SourceDocument, start: Offset, end: Offset) {
    if (!(document instanceof SourceDocument)) {
      throw new TypeError("SourceSlice requires a SourceDocument");
    }
    if (!Number.isInteger(start) || !Number.isInteger(end)) {
      throw new TypeError(`SourceSlice requires integer offsets, got ${start}..${end}`);
    }
    if (start < 0 || end < start || end > document.length) {
      throw new SourceRevisionError(
        `SourceSlice ${start}..${end} is outside document bounds 0..${document.length}`,
        { start, end, document },
      );
    }
    this.document = document;
    this.start = start;
    this.end = end;
  }

  text(): string {
    return this.document.text.slice(this.start, this.end);
  }

  get length(): number {
    return this.end - this.start;
  }

  isEmpty(): boolean {
    return this.start === this.end;
  }

  position(): Position {
    return this.document.positionAt(this.start);
  }

  toString(): string {
    return this.text();
  }
}

export function isSlice(value: unknown): value is SourceSlice {
  return value instanceof SourceSlice;
}
