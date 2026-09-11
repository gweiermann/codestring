import { describe, expect, it } from "vitest";
import { type AnyAdapter, type TriviaClass, createLanguage, walk } from "@codestring/core";

const TRIVIA_CLASSES = new Set<TriviaClass>([null, "whitespace", "comment", "separator"]);

const DEFAULT_UNICODE = ['a "🎉" b', "// ☃\n", "🎉🎉🎉"];

/** A literal pair a pattern hole can sit between, e.g. `<div ` and `>`. */
export interface PlaceholderContextFixture {
  readonly before: string;
  readonly after: string;
}

export interface AdapterFixtures {
  /** Sources that should parse cleanly. */
  readonly valid?: readonly string[];
  /** Sources that must be reported, not thrown on. */
  readonly malformed?: readonly string[];
  /** Sources containing non-BMP characters. */
  readonly unicode?: readonly string[];
  readonly placeholderContexts?: readonly PlaceholderContextFixture[];
}

/**
 * The compliance suite every adapter should run. It checks the invariants the
 * matcher relies on — offsets, ordering, containment, trivia classes and
 * placeholder round-tripping — and nothing about matching itself.
 */
export function runAdapterContractSuite(adapter: AnyAdapter, fixtures: AdapterFixtures = {}): void {
  const language = createLanguage(adapter);
  const valid = fixtures.valid ?? [];
  const malformed = fixtures.malformed ?? [];
  const unicode = fixtures.unicode ?? DEFAULT_UNICODE;
  const placeholderContexts = fixtures.placeholderContexts ?? [{ before: "", after: "" }];
  const all = [...valid, ...unicode, "", " ", "\n"];

  describe(`adapter contract: ${adapter.id}`, () => {
    it("declares an id and the required methods", () => {
      expect(typeof adapter.id).toBe("string");
      for (const method of ["parse", "root", "kind", "range", "children"] as const) {
        expect(typeof adapter[method]).toBe("function");
      }
    });

    describe.each(all.map((source, index) => [index, source] as const))("source #%i", (_index, source) => {
      it("produces a root that covers the parsed text", () => {
        const parsed = language.parse(source);
        expect(parsed.root.start).toBe(0);
        expect(parsed.root.end).toBe(source.length);
      });

      it("gives every node a valid range whose text is the source substring", () => {
        const parsed = language.parse(source);
        for (const node of walk(parsed.root)) {
          expect(Number.isInteger(node.start)).toBe(true);
          expect(Number.isInteger(node.end)).toBe(true);
          expect(node.start).toBeGreaterThanOrEqual(0);
          expect(node.end).toBeLessThanOrEqual(source.length);
          expect(node.end).toBeGreaterThanOrEqual(node.start);
          expect(node.text()).toBe(source.slice(node.start, node.end));
        }
      });

      it("keeps children ordered and inside their parent", () => {
        const parsed = language.parse(source);
        for (const node of walk(parsed.root)) {
          let previousEnd = node.start;
          for (const child of node.children) {
            expect(child.start).toBeGreaterThanOrEqual(node.start);
            expect(child.end).toBeLessThanOrEqual(node.end);
            expect(child.start).toBeGreaterThanOrEqual(previousEnd);
            previousEnd = child.end;
          }
        }
      });

      it("uses one of the known trivia classes", () => {
        const parsed = language.parse(source);
        for (const node of walk(parsed.root)) {
          expect(TRIVIA_CLASSES.has(node.trivia)).toBe(true);
        }
      });

      it("reports kinds as non-empty strings", () => {
        const parsed = language.parse(source);
        for (const node of walk(parsed.root)) {
          expect(typeof node.kind).toBe("string");
          expect(node.kind.length).toBeGreaterThan(0);
        }
      });
    });

    describe.each(unicode.map((source, index) => [index, source] as const))(
      "UTF-16 offsets #%i",
      (_index, source) => {
        it("counts code units, not code points", () => {
          const parsed = language.parse(source);
          for (const node of walk(parsed.root)) {
            expect(source.slice(node.start, node.end)).toBe(node.text());
          }
        });
      },
    );

    if (malformed.length > 0) {
      describe.each(malformed.map((source, index) => [index, source] as const))(
        "malformed #%i",
        (_index, source) => {
          it("reports the problem instead of throwing", () => {
            expect(() => language.parse(source)).not.toThrow();
          });

          it("still produces a usable tree", () => {
            expect(language.parse(source).root.end).toBe(source.length);
          });
        },
      );
    }

    describe.each(placeholderContexts.map((context, index) => [index, context] as const))(
      "placeholder context #%i",
      (_index, context) => {
        it("round-trips a hole through parse and detection", () => {
          const fallback = "__sm_hole_0__";
          const text = adapter.placeholder
            ? adapter.placeholder(0, { before: context.before, after: context.after, fallback })
            : fallback;
          const source = `${context.before}${text}${context.after}`;
          const parsed = language.parse(source);
          const detected = [...walk(parsed.root)].filter((node) => {
            if (adapter.detectPlaceholder) return adapter.detectPlaceholder(node.raw, node.text()) === 0;
            return node.text().trim() === fallback;
          });
          expect(detected.length, `no placeholder node found in ${JSON.stringify(source)}`).toBeGreaterThan(0);
        });
      },
    );

    it("reports diagnostics as objects with a message and severity", () => {
      for (const source of [...all, ...malformed]) {
        for (const diagnostic of language.parse(source).diagnostics) {
          expect(typeof diagnostic.message).toBe("string");
          expect(["error", "warning"]).toContain(diagnostic.severity);
        }
      }
    });
  });
}
