import type { AnyCapture } from "./captures.js";
import { SourceSlice } from "./source.js";

export type SourceTemplatePart =
  | { readonly type: "literal"; readonly value: string }
  | { readonly type: "slice"; readonly value: SourceSlice }
  | { readonly type: "capture"; readonly value: AnyCapture };

/** Anything that can be interpolated into replacement source. */
export type SourceValue =
  | SourceSlice
  | SourceTemplate
  | AnyCapture
  | string
  | number
  | null
  | undefined
  | readonly SourceValue[];

/** What a deferred template needs from a match to resolve its handles. */
export interface CaptureLookup {
  getAll(capture: AnyCapture): readonly SourceSlice[];
}

/**
 * Replacement source built from literal text, exact source slices and capture
 * handles. It stays a list of parts until an edit is applied, so a slice's
 * provenance survives right up to the moment it is written out — and a template
 * written before any match exists can be resolved against each match in turn.
 */
export class SourceTemplate {
  readonly parts: readonly SourceTemplatePart[];
  readonly languageId: string;

  constructor(parts: readonly SourceTemplatePart[], languageId: string) {
    this.parts = parts;
    this.languageId = languageId;
  }

  /** Handles this template still needs a match for. Empty means `text()` works. */
  captures(): AnyCapture[] {
    return this.parts.flatMap((part) => (part.type === "capture" ? [part.value] : []));
  }

  get isDeferred(): boolean {
    return this.parts.some((part) => part.type === "capture");
  }

  /** Bind every capture handle to what one match captured. */
  resolveWith(match: CaptureLookup): SourceTemplate {
    if (!this.isDeferred) return this;
    const parts = this.parts.map((part): SourceTemplatePart => {
      if (part.type !== "capture") return part;
      const results = match.getAll(part.value);
      if (results.length === 0) return { type: "literal", value: "" };
      if (results.length === 1) return { type: "slice", value: results[0]! };
      throw new TypeError(
        `${part.value.toString()} matched ${results.length} times, so it has no single source to insert. ` +
          "Build the replacement from a function instead.",
      );
    });
    return new SourceTemplate(parts, this.languageId);
  }

  text(): string {
    return this.parts
      .map((part) => {
        if (part.type === "literal") return part.value;
        if (part.type === "slice") return part.value.text();
        throw new TypeError(
          `this ${this.languageId} template still holds ${part.value.toString()}; ` +
            "resolve it against a match before reading its text",
        );
      })
      .join("");
  }

  slices(): SourceSlice[] {
    return this.parts.flatMap((part) => (part.type === "slice" ? [part.value] : []));
  }

  toString(): string {
    return this.text();
  }
}

function isCaptureHandle(value: unknown): value is AnyCapture {
  return Boolean(value && typeof value === "object" && (value as AnyCapture).kind === "capture");
}

function pushValue(parts: SourceTemplatePart[], value: SourceValue): void {
  if (value instanceof SourceSlice) {
    parts.push({ type: "slice", value });
    return;
  }
  if (value instanceof SourceTemplate) {
    parts.push(...value.parts);
    return;
  }
  if (isCaptureHandle(value)) {
    parts.push({ type: "capture", value });
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) pushValue(parts, entry);
    return;
  }
  if (value == null) return;
  parts.push({ type: "literal", value: String(value) });
}

export function buildSourceTemplate(
  strings: readonly string[],
  values: readonly SourceValue[],
  languageId: string,
): SourceTemplate {
  const parts: SourceTemplatePart[] = [];
  strings.forEach((literal, index) => {
    if (literal) parts.push({ type: "literal", value: literal });
    if (index < values.length) pushValue(parts, values[index]);
  });
  return new SourceTemplate(parts, languageId);
}

export function replacementText(value: SourceValue): string {
  if (value instanceof SourceTemplate) return value.text();
  if (value instanceof SourceSlice) return value.text();
  if (value == null) return "";
  if (isCaptureHandle(value)) {
    throw new TypeError(
      `${value.toString()} cannot be written as text on its own; interpolate it into a replacement template`,
    );
  }
  if (Array.isArray(value)) return value.map(replacementText).join("");
  return String(value);
}
