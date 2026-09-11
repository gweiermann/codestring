import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { transform } from "./transform.ts";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const rule = "─".repeat(72);

for (const name of (await readdir(fixtures)).sort()) {
  const source = await readFile(join(fixtures, name), "utf8");
  process.stdout.write(`${rule}\n${name}\n${rule}\n`);
  process.stdout.write(`${source}\n`);
  process.stdout.write(`── after ${"─".repeat(63)}\n`);
  try {
    process.stdout.write(`${transform(source)}\n`);
  } catch (error) {
    process.stdout.write(`refused: ${(error as Error).message}\n\n`);
  }
}
