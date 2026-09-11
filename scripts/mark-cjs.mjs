import { mkdir, writeFile } from "node:fs/promises";

// tsc emits .js into dist/cjs, but the package itself is "type": "module", so
// those files need a package.json of their own to be read as CommonJS.
await mkdir("dist/cjs", { recursive: true });
await writeFile("dist/cjs/package.json", `${JSON.stringify({ type: "commonjs" }, null, 2)}\n`);
