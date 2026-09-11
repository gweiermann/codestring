import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { migrateVue, report } from "./transform.ts";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const rule = "─".repeat(72);

for (const name of (await readdir(fixtures)).sort()) {
  const source = await readFile(join(fixtures, name), "utf8");
  process.stdout.write(`${rule}\n${name}  ${JSON.stringify(report(source))}\n${rule}\n`);
  process.stdout.write(`${source}\n── after ${"─".repeat(63)}\n`);
  process.stdout.write(`${migrateVue.transformString(source, name)}\n`);
}
