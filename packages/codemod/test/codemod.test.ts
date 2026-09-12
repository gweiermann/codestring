import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { any, capture, code, createLanguage } from "@codestring/core";
import { javascriptAdapter } from "@codestring/javascript";
import { htmlAdapter } from "@codestring/html";
import { TransformVerificationError, createCodemod, createTransformer } from "@codestring/codemod";

const js = createLanguage(javascriptAdapter);
const html = createLanguage(htmlAdapter);
const arg = capture("arg");

const rename = createTransformer({
  name: "console.log → logger.debug",
  language: js,
  fileGlob: "**/*.js",
  transform: ({ source }) => source.replaceAll(code`console.log(${arg})`, code`logger.debug(${arg})`),
});

describe("createTransformer", () => {
  it("rewrites every match in a string", () => {
    expect(rename.transformString("console.log(a);\nconsole.log(b, c);\n")).toBe(
      "logger.debug(a);\nlogger.debug(b, c);\n",
    );
  });

  it("keeps the captured source exactly as it was written", () => {
    expect(rename.transformString("console.log(  'x' ,  y  );")).toBe("logger.debug('x' ,  y);");
  });

  it("returns the input unchanged when nothing matches", () => {
    const untouched = "export const value = 1;\n";
    expect(rename.transformString(untouched)).toBe(untouched);
  });

  it("takes its name and glob from the options", () => {
    expect(rename.name).toBe("console.log → logger.debug");
    expect(rename.globs).toEqual(["**/*.js"]);
  });

  it("names itself after its language when no name is given", () => {
    const anonymous = createTransformer({ language: js, transform: ({ source }) => source });
    expect(anonymous.name).toBe("javascript transform");
  });
});

describe("the transform function decides everything", () => {
  it("skips the file by returning nothing", () => {
    const picky = createTransformer({
      language: js,
      transform: ({ source }) =>
        source.includes(code`logger.debug(${any()})`)
          ? null
          : source.replaceAll(code`console.log(${arg})`, code`logger.debug(${arg})`),
    });
    expect(picky.transformString("console.log(a);")).toBe("logger.debug(a);");
    expect(picky.transformString("logger.debug(b); console.log(a);")).toBe("logger.debug(b); console.log(a);");
  });

  it("gates per match by returning nothing for that match", () => {
    const gated = createTransformer({
      language: js,
      transform: ({ source }) =>
        source.replaceAll(code`console.log(${arg})`, (match) =>
          match.get(arg).text().startsWith("'") ? match.replace`logger.debug(${arg})` : null,
        ),
    });
    expect(gated.transformString("console.log('a');\nconsole.log(b);\n")).toBe(
      "logger.debug('a');\nconsole.log(b);\n",
    );
  });

  it("sees the file it was handed", () => {
    const byPath = createTransformer({
      language: js,
      transform: ({ file, source }) =>
        file?.startsWith("src/") ? source.replaceAll(code`console.log(${arg})`, code`logger.debug(${arg})`) : null,
    });
    expect(byPath.transformString("console.log(a);", "src/a.js")).toBe("logger.debug(a);");
    expect(byPath.transformString("console.log(a);", "test/a.js")).toBe("console.log(a);");
  });

  it("may return a plain string", () => {
    const blunt = createTransformer({ language: js, transform: () => "// replaced\n" });
    expect(blunt.transformString("console.log(a);")).toBe("// replaced\n");
  });

  it("chains as many rewrites as it likes", () => {
    const several = createTransformer({
      language: js,
      transform: ({ source }) =>
        source
          .replaceAll(code`console.log(${arg})`, code`logger.debug(${arg})`)
          .removeAll(code`debugger;`),
    });
    expect(several.transformString("debugger;\nconsole.log(a);\n")).toBe("\nlogger.debug(a);\n");
  });
});

describe("fileGlob", () => {
  it("leaves a file its glob does not match alone", () => {
    expect(rename.transformString("console.log(a);", "styles/a.css")).toBe("console.log(a);");
    expect(rename.appliesTo("src/deep/a.js")).toBe(true);
    expect(rename.appliesTo("src/a.ts")).toBe(false);
  });

  it("applies to every file when no glob is given", () => {
    const everywhere = createTransformer({
      language: js,
      transform: ({ source }) => source.replaceAll(code`console.log(${arg})`, code`logger.debug(${arg})`),
    });
    expect(everywhere.appliesTo("anything.txt")).toBe(true);
    expect(everywhere.transformString("console.log(a);", "anything.txt")).toBe("logger.debug(a);");
  });

  it("takes several globs", () => {
    const multi = createTransformer({
      language: js,
      fileGlob: ["**/*.js", "**/*.mjs"],
      transform: ({ source }) => source,
    });
    expect(multi.appliesTo("a.mjs")).toBe(true);
    expect(multi.appliesTo("a.ts")).toBe(false);
  });
});

describe("verify", () => {
  it("refuses a rewrite that no longer parses", () => {
    const broken = createTransformer({
      name: "break it",
      language: js,
      transform: () => "const = ;",
      verify: "parses",
    });
    expect(() => broken.transformString("console.log(a);")).toThrow(TransformVerificationError);
    expect(() => broken.transformString("console.log(a);")).toThrow(/no longer parses/);
  });

  it("allows a rewrite of source that was already broken", () => {
    const safe = createTransformer({
      language: js,
      transform: ({ source }) => source.replaceAll(code`console.log(${arg})`, code`logger.debug(${arg})`),
      verify: "parses",
    });
    expect(() => safe.transformString("console.log(a);")).not.toThrow();
  });

  it("takes a predicate that explains itself", () => {
    const guarded = createTransformer({
      name: "guarded",
      language: js,
      transform: ({ source }) => source.replaceAll(code`console.log(${arg})`, code`logger.debug(${arg})`),
      verify: ({ after }) => (after.includes("logger") ? "logger is not imported here" : true),
    });
    expect(() => guarded.transformString("console.log(a);")).toThrow(/logger is not imported here/);
  });
});

describe("createCodemod", () => {
  const other = capture("other");
  const warn = createTransformer({
    name: "warn",
    language: js,
    fileGlob: "**/*.js",
    transform: ({ source }) => source.replaceAll(code`console.warn(${other})`, code`logger.warn(${other})`),
  });
  const codemod = createCodemod({ name: "two rules", transformers: [rename, warn] });

  it("applies every transformer in order", () => {
    expect(codemod.transformString("console.log(a); console.warn(b);", "a.js")).toBe(
      "logger.debug(a); logger.warn(b);",
    );
  });

  it("feeds each transformer what the last one produced", () => {
    const first = createTransformer({ name: "a→b", language: js, transform: () => "b();" });
    const second = createTransformer({
      name: "b→c",
      language: js,
      transform: ({ source }) => source.replaceAll(code`b()`, code`c()`),
    });
    expect(createCodemod({ transformers: [first, second] }).transformString("a();")).toBe("c();");
  });

  it("carries no language of its own", () => {
    expect(codemod.transformers.map((entry) => entry.name)).toEqual(["console.log → logger.debug", "warn"]);
    expect(Object.keys(codemod)).not.toContain("language");
  });

  it("mixes languages, each transformer reading files its own way", () => {
    const markup = createTransformer({
      name: "html",
      language: html,
      fileGlob: "**/*.html",
      transform: ({ source }) => source.replaceAll(code`<b>${arg}</b>`, code`<strong>${arg}</strong>`),
    });
    const mixed = createCodemod({ name: "mixed", transformers: [rename, markup] });
    expect(mixed.transformString("<b>hi</b>", "a.html")).toBe("<strong>hi</strong>");
    expect(mixed.transformString("console.log(a);", "a.js")).toBe("logger.debug(a);");
    expect(mixed.globs).toEqual(["**/*.js", "**/*.html"]);
  });

  it("flattens a codemod used inside another codemod", () => {
    const inner = createCodemod({ name: "inner", transformers: [rename, warn] });
    expect(createCodemod({ name: "outer", transformers: [inner] }).transformers).toHaveLength(2);
  });
});

describe("files", () => {
  it("reports a file without writing it by default", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sm-codemod-"));
    const file = join(directory, "a.js");
    await writeFile(file, "console.log(1);\n", "utf8");

    const result = await rename.transformFile(file);
    expect(result.changed).toBe(true);
    expect(result.applied).toEqual(["console.log → logger.debug"]);
    expect(result.written).toBe(false);
    expect(result.after).toBe("logger.debug(1);\n");
    expect(await readFile(file, "utf8")).toBe("console.log(1);\n");
  });

  it("writes when asked", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sm-codemod-"));
    const file = join(directory, "a.js");
    await writeFile(file, "console.log(1);\n", "utf8");
    const result = await rename.transformFile(file, { write: true });
    expect(result.written).toBe(true);
    expect(await readFile(file, "utf8")).toBe("logger.debug(1);\n");
  });

  it("walks a directory and keeps only files the glob matches", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sm-codemod-"));
    await writeFile(join(directory, "a.js"), "console.log(1);\n", "utf8");
    await writeFile(join(directory, "b.js"), "const untouched = 1;\n", "utf8");
    await writeFile(join(directory, "c.txt"), "console.log(1);\n", "utf8");

    const results = await rename.transformFiles([directory]);
    expect(results.map((result) => [result.path.endsWith("a.js"), result.changed])).toEqual([
      [true, true],
      [false, false],
    ]);
  });

  it("leaves an unchanged file alone even with write on", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sm-codemod-"));
    const file = join(directory, "a.js");
    await writeFile(file, "const value = 1;\n", "utf8");
    const result = await rename.transformFile(file, { write: true });
    expect(result.changed).toBe(false);
    expect(result.written).toBe(false);
  });

  it("says which transformers actually changed the file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sm-codemod-"));
    const file = join(directory, "a.js");
    await writeFile(file, "console.log(1);\nconsole.warn(2);\n", "utf8");
    const warn = createTransformer({
      name: "warn",
      language: js,
      fileGlob: "**/*.js",
      transform: ({ source }) => source.replaceAll(code`console.warn(${arg})`, code`logger.warn(${arg})`),
    });
    const noop = createTransformer({
      name: "noop",
      language: js,
      fileGlob: "**/*.js",
      transform: () => null,
    });
    const result = await createCodemod({ transformers: [rename, noop, warn] }).transformFile(file);
    expect(result.applied).toEqual(["console.log → logger.debug", "warn"]);
  });
});

describe("verify defaults to parses when a run writes", () => {
  const breaking = createTransformer({ name: "break it", language: js, transform: () => "const = ;" });

  it("leaves a dry run alone", () => {
    expect(breaking.transformString("const a = 1;")).toBe("const = ;");
  });

  it("refuses to write source that no longer parses", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sm-verify-"));
    const file = join(directory, "a.js");
    await writeFile(file, "const a = 1;\n", "utf8");
    await expect(breaking.transformFile(file, { write: true })).rejects.toThrow(/no longer parses/);
    expect(await readFile(file, "utf8")).toBe("const a = 1;\n");
  });

  it("can be turned off", async () => {
    const loud = createTransformer({ language: js, transform: () => "const = ;", verify: false });
    const directory = await mkdtemp(join(tmpdir(), "sm-verify-"));
    const file = join(directory, "a.js");
    await writeFile(file, "const a = 1;\n", "utf8");
    await loud.transformFile(file, { write: true });
    expect(await readFile(file, "utf8")).toBe("const = ;");
  });
});
