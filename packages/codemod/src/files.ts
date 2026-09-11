import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join, matchesGlob, relative } from "node:path";

const SKIP = new Set(["node_modules", ".git", "dist", "build", "coverage", "vendor"]);

/** Does a path match any of these globs? No globs means every file matches. */
export function matchesAnyGlob(path: string, globs: readonly string[]): boolean {
  if (globs.length === 0) return true;
  const candidates = [path, relative(process.cwd(), path)];
  return globs.some((glob) => candidates.some((candidate) => matchesGlob(candidate, glob)));
}

/** Walk files and directories, skipping the usual build output. */
export async function collectFiles(paths: readonly string[], globs: readonly string[] = []): Promise<string[]> {
  const files: string[] = [];

  const visit = async (path: string): Promise<void> => {
    const info = await stat(path);
    if (info.isDirectory()) {
      for (const entry of await readdir(path)) {
        if (SKIP.has(entry)) continue;
        await visit(join(path, entry));
      }
      return;
    }
    if (matchesAnyGlob(path, globs)) files.push(path);
  };

  for (const path of paths) await visit(path);
  return files.sort();
}

export async function readSource(path: string): Promise<string> {
  return readFile(path, "utf8");
}

export async function writeSource(path: string, text: string): Promise<void> {
  await writeFile(path, text, "utf8");
}
