import type { SourceDocument } from "./source.js";

export interface ErrorDetails {
  readonly [key: string]: unknown;
}

class StructuralMatchError extends Error {
  constructor(message: string, details: ErrorDetails = {}) {
    super(message);
    this.name = new.target.name;
    Object.assign(this, details);
  }
}

export class PatternCompileError extends StructuralMatchError {}
export class ParseError extends StructuralMatchError {}
export class AdapterContractError extends StructuralMatchError {}
export class MatchError extends StructuralMatchError {}
export class CaptureCardinalityError extends StructuralMatchError {}
export class OverlappingEditError extends StructuralMatchError {}
export class SourceRevisionError extends StructuralMatchError {}

export function formatLocation(document: SourceDocument, offset: number): string {
  const { line, column } = document.positionAt(offset);
  const id = document.id ? `${document.id}:` : "";
  return `${id}${line}:${column}`;
}
