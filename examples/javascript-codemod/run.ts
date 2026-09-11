import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { codemod, transform } from "./transform.ts";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const rule = "─".repeat(72);

process.stdout.write(`codemod: ${codemod.name}\n`);
for (const entry of codemod.transformers) {
  process.stdout.write(`  · ${entry.name}  ${entry.globs.join(", ")}\n`);
}
process.stdout.write("\n");

for (const name of (await readdir(fixtures)).sort()) {
  const source = await readFile(join(fixtures, name), "utf8");
  process.stdout.write(`${rule}\n${name}\n${rule}\n`);
  process.stdout.write(`${source}\n── after ${"─".repeat(63)}\n`);
  process.stdout.write(`${transform(source, name)}\n`);
}

for (const result of await codemod.transformFiles([fixtures])) {
  process.stdout.write(`${result.path}: changed=${result.changed} by [${result.applied.join(", ")}]\n`);
}
