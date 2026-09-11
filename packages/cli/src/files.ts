import { readFile, readdir, stat } from "node:fs/promises";
import { extname, join } from "node:path";

const SKIP = new Set(["node_modules", ".git", "dist", "build", "coverage", "vendor"]);

export async function collectFiles(paths: readonly string[], extensions: readonly string[]): Promise<string[]> {
  const files: string[] = [];
  const matches = (file: string) => extensions.length === 0 || extensions.includes(extname(file));

  const visit = async (path: string): Promise<void> => {
    const info = await stat(path);
    if (info.isDirectory()) {
      for (const entry of await readdir(path)) {
        if (SKIP.has(entry)) continue;
        await visit(join(path, entry));
      }
      return;
    }
    if (matches(path)) files.push(path);
  };

  for (const path of paths) await visit(path);
  return files.sort();
}

export async function readSource(path: string): Promise<string> {
  return readFile(path, "utf8");
}

export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}
