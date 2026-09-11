export { createLanguage } from "./language.js";
export type {
  CapturesOfPattern,
  Language,
  LanguageNodeOf,
  MatchOf,
  NodeOfPattern,
  PatternFactory,
  PatternTag,
} from "./language.js";

export { defineAdapter } from "./adapter.js";
export type {
  AdapterNodeOf,
  AnyAdapter,
  LanguageAdapter,
  ParseDiagnostic,
  ParseOptions,
  ParsedOf,
  PlaceholderContext,
  Range,
  TokenOf,
  TriviaClass,
} from "./adapter.js";

export {
  any,
  between,
  capture,
  exactly,
  isCapture,
  isHoleValue,
  oneOf,
  oneOrMore,
  optional,
  zeroOrMore,
  AnyHole,
  Capture,
  Choice,
  Repeat,
} from "./captures.js";
export type {
  AnyCapture,
  CaptureSet,
  CapturesIn,
  CapturesOf,
  HoleValue,
  ItemValue,
  ManyOf,
  NamesOf,
  NoCaptures,
  OptionalOf,
  PatternLike,
  PatternValue,
  SimpleItem,
  SingleOf,
} from "./captures.js";

export { applyEdits, insertAfter, insertBefore, isEdit, planEdits, remove, replace } from "./edits.js";
export type { Edit, EditOperation, EditTarget, EditTargetInput, TextEdit } from "./edits.js";

export { SourceDocument, SourceSlice, isSlice } from "./source.js";
export type { Offset, Position } from "./source.js";

export { SourceTemplate } from "./template.js";
export type { CaptureLookup, SourceTemplatePart, SourceValue } from "./template.js";

export { NodeRef, walk } from "./nodes.js";
export { ParsedDocument } from "./parsed.js";
export type { EmbeddedRewrite, ParseErrorPolicy, ParsedLanguage, Query, Rewrite } from "./parsed.js";
export { CodeFragment, code, isCodeFragment } from "./code.js";
export type { CodeFactory, CodeTag, CodeValue } from "./code.js";

export { CaptureResult, Match } from "./match.js";
export type { EditFactory, EditTag, MatchEditTarget, ReplacementValue, UseGetAllInstead } from "./match.js";

export { Pattern } from "./pattern.js";
export type { PatternLanguage } from "./pattern.js";
export type { MatchInput, PatternHandle } from "./pattern-handle.js";

export type { LanguageOptions, ParseInputOptions, PatternOptions } from "./options.js";
export type { CompiledPattern, PatternIR, TriviaPolicy } from "./compile.js";

export {
  AdapterContractError,
  CaptureCardinalityError,
  MatchError,
  OverlappingEditError,
  ParseError,
  PatternCompileError,
  SourceRevisionError,
} from "./errors.js";
