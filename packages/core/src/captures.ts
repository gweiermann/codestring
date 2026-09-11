import { PatternCompileError } from "./errors.js";

/**
 * An immutable handle for one slot in a pattern. It never holds the result of a
 * match; a Match does. The same handle can therefore be used by several
 * patterns and matched concurrently.
 */
export class Capture<Name extends string | undefined = string | undefined> {
  readonly kind = "capture" as const;
  readonly name: Name;
  readonly id: string;

  constructor(name: Name) {
    this.name = name;
    this.id = `capture#${nextCaptureId++}${name ? `(${name})` : ""}`;
    Object.freeze(this);
  }

  toString(): string {
    return this.name ? `capture(${this.name})` : "capture()";
  }
}

let nextCaptureId = 0;

export class AnyHole {
  readonly kind = "any" as const;

  constructor() {
    Object.freeze(this);
  }

  toString(): string {
    return "any()";
  }
}

export class Repeat<Item extends ItemValue = ItemValue, Min extends number = number, Max extends number = number> {
  readonly kind = "repeat" as const;
  readonly item: Item;
  readonly min: Min;
  readonly max: Max;
  readonly label: string;

  constructor(item: Item, min: Min, max: Max, label: string) {
    this.item = item;
    this.min = min;
    this.max = max;
    this.label = label;
    Object.freeze(this);
  }

  toString(): string {
    return `${this.label}(${String(this.item)})`;
  }
}

export class Choice<Options extends SimpleItem = SimpleItem> {
  readonly kind = "choice" as const;
  readonly options: readonly Options[];

  constructor(options: readonly Options[]) {
    this.options = options;
    Object.freeze(this);
  }

  toString(): string {
    return `oneOf(${this.options.map(String).join(", ")})`;
  }
}

export type AnyCapture = Capture<any>;

/** The three cardinalities a pattern can bind a handle with. */
export interface CaptureSet {
  readonly one: AnyCapture;
  readonly optional: AnyCapture;
  readonly many: AnyCapture;
}

export type NoCaptures = { one: never; optional: never; many: never };

/** Structural view of a Pattern, so the capture types stay free of import cycles. */
export interface PatternLike<Captures extends CaptureSet = CaptureSet> {
  readonly isStructuralPattern: true;
  readonly __captures?: Captures;
}

/** A single-node matcher that needs no further unwrapping. */
export type SimpleItem = AnyCapture | AnyHole | PatternLike<CaptureSet>;

/** Anything a combinator may wrap: it must consume exactly one node per iteration. */
export type ItemValue = SimpleItem | Choice<SimpleItem>;

/** Anything that may be interpolated into a pattern template. */
export type PatternValue = ItemValue | Repeat<ItemValue, number, number> | string | number;

/** The pattern values the compiler handles directly, as opposed to a sub-pattern. */
export type HoleValue = AnyCapture | AnyHole | Repeat<ItemValue, number, number> | Choice<SimpleItem>;

type IsAtMostOne<Max extends number> = number extends Max ? false : Max extends 1 ? true : false;
type IsNeverEmpty<Min extends number> = number extends Min ? false : Min extends 0 ? false : true;

/** Every handle reachable from a pattern value, whatever its cardinality. */
export type CapturesIn<Value> = Value extends AnyCapture
  ? Value
  : Value extends Repeat<infer Item, number, number>
    ? CapturesIn<Item>
    : Value extends Choice<infer Options>
      ? CapturesIn<Options>
      : Value extends PatternLike<infer Captures>
        ? Captures["one"] | Captures["optional"] | Captures["many"]
        : never;

/** Handles that bind exactly once, so `get()` always returns a result. */
export type SingleOf<Value> = Value extends AnyCapture
  ? Value
  : Value extends Repeat<infer Item, infer Min, infer Max>
    ? IsAtMostOne<Max> extends true
      ? IsNeverEmpty<Min> extends true
        ? CapturesIn<Item>
        : never
      : never
    : Value extends Choice<any>
      ? never
      : Value extends PatternLike<infer Captures>
        ? Captures["one"]
        : never;

/** Handles that bind at most once, so `get()` may return undefined. */
export type OptionalOf<Value> = Value extends AnyCapture
  ? never
  : Value extends Repeat<infer Item, infer Min, infer Max>
    ? IsAtMostOne<Max> extends true
      ? IsNeverEmpty<Min> extends true
        ? never
        : CapturesIn<Item>
      : never
    : Value extends Choice<infer Options>
      ? SingleOf<Options> | OptionalOf<Options>
      : Value extends PatternLike<infer Captures>
        ? Captures["optional"]
        : never;

/** Handles that can bind more than once, so only `getAll()` makes sense. */
export type ManyOf<Value> = Value extends AnyCapture
  ? never
  : Value extends Repeat<infer Item, number, infer Max>
    ? IsAtMostOne<Max> extends true
      ? never
      : CapturesIn<Item>
    : Value extends Choice<infer Options>
      ? ManyOf<Options>
      : Value extends PatternLike<infer Captures>
        ? Captures["many"]
        : never;

/** The capture set a template's interpolated values add up to. */
export type CapturesOf<Value> = {
  one: SingleOf<Value>;
  optional: OptionalOf<Value>;
  many: ManyOf<Value>;
};

/** The names declared by a set of handles, for `match.get("name")`. */
export type NamesOf<Handles> = Handles extends Capture<infer Name>
  ? Name extends string
    ? Name
    : never
  : never;

export function capture(): Capture<undefined>;
export function capture<const Name extends string>(name: Name): Capture<Name>;
export function capture(name?: string): Capture<string | undefined> {
  if (name !== undefined && typeof name !== "string") {
    throw new TypeError("capture(name) takes an optional string name");
  }
  return new Capture(name);
}

export function any(): AnyHole {
  return new AnyHole();
}

function assertRepeatable(item: unknown, label: string): asserts item is ItemValue {
  if (item == null || typeof item !== "object") {
    throw new PatternCompileError(`${label}() needs a capture, any(), oneOf() or a pattern`);
  }
  if ((item as { kind?: string }).kind === "repeat") {
    throw new PatternCompileError(
      `${label}(${(item as Repeat).label}(...)) repeats something that can already match nothing; ` +
        "nest at most one repetition around a capture",
    );
  }
}

export function optional<Item extends ItemValue>(item: Item): Repeat<Item, 0, 1> {
  assertRepeatable(item, "optional");
  return new Repeat(item, 0, 1, "optional");
}

export function oneOrMore<Item extends ItemValue>(item: Item): Repeat<Item, 1, number> {
  assertRepeatable(item, "oneOrMore");
  return new Repeat(item, 1, Number.POSITIVE_INFINITY as number, "oneOrMore");
}

export function zeroOrMore<Item extends ItemValue>(item: Item): Repeat<Item, 0, number> {
  assertRepeatable(item, "zeroOrMore");
  return new Repeat(item, 0, Number.POSITIVE_INFINITY as number, "zeroOrMore");
}

export function exactly<const Count extends number, Item extends ItemValue>(
  count: Count,
  item: Item,
): Repeat<Item, Count, Count> {
  assertRepeatable(item, "exactly");
  if (!Number.isInteger(count) || count < 1) {
    throw new PatternCompileError("exactly(count, item) needs a positive integer count");
  }
  return new Repeat(item, count, count, `exactly(${count})`);
}

export function between<const Min extends number, const Max extends number, Item extends ItemValue>(
  min: Min,
  max: Max,
  item: Item,
): Repeat<Item, Min, Max> {
  assertRepeatable(item, "between");
  if (!Number.isInteger(min) || min < 0 || !(max >= min)) {
    throw new PatternCompileError("between(min, max, item) needs 0 <= min <= max");
  }
  return new Repeat(item, min, max, `between(${min}, ${max})`);
}

export function oneOf<const Options extends readonly SimpleItem[]>(
  ...options: Options
): Choice<Options[number]> {
  if (options.length < 2) {
    throw new PatternCompileError("oneOf() needs at least two alternatives");
  }
  for (const option of options) assertRepeatable(option, "oneOf");
  return new Choice(options);
}

export function isCapture(value: unknown): value is AnyCapture {
  return value instanceof Capture;
}

export function isHoleValue(value: unknown): value is HoleValue {
  return (
    value instanceof Capture || value instanceof AnyHole || value instanceof Repeat || value instanceof Choice
  );
}
