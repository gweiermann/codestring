#!/usr/bin/env node
import { parseArgs } from "node:util";
import type { ParseErrorPolicy, TriviaPolicy } from "@codestring/core";
import { type CliOptions, type Finding, find, rewrite } from "./index.js";
import { languageIds, loadLanguage } from "./languages.js";
import { compileCliPattern } from "./patterns.js";

const USAGE = `cs — structural grep and rewrite

Usage
  cs find    -l <language> -p <pattern> [paths...]
  cs replace -l <language> -p <pattern> -r <replacement> [--write] [paths...]
  cs debug   -l <language> -p <pattern>
  cs languages

Pattern holes
  $name      one node, captured under "name"
  $$$name    a run of sibling nodes, captured under "name"
  $_ / $$$_  the same, without capturing

Options
  -l, --language   language id (${languageIds().join(", ")}) or the id your --adapter exports
  -p, --pattern    pattern source
  -r, --replace    replacement source; $name inserts the captured source verbatim
      --adapter    module or file exporting a custom adapter
      --ext        comma separated extensions to search (default: per language)
      --trivia     ignore | exact | whitespace-flexible (default)
      --on-parse-error  reject | allow-recovery | allow-outside-errors (default)
      --write      write changes back to disk instead of printing the result
      --json       machine readable output
  -h, --help

With no paths, cs reads stdin.

Examples
  cs find -l twig -p '{% block $name %}$$$body{% endblock %}' templates/
  cs find -l javascript -p 'console.log($$$args)' src/
  cs replace -l javascript -p 'foo($x)' -r 'bar($x)' --write src/
`;

const options = {
  language: { type: "string", short: "l" },
  pattern: { type: "string", short: "p" },
  replace: { type: "string", short: "r" },
  adapter: { type: "string" },
  ext: { type: "string" },
  trivia: { type: "string" },
  "on-parse-error": { type: "string" },
  write: { type: "boolean", default: false },
  json: { type: "boolean", default: false },
  help: { type: "boolean", short: "h", default: false },
} as const;

function fail(message: string): void {
  process.stderr.write(`cs: ${message}\n\n${USAGE}`);
  process.exitCode = 2;
}

type Values = { [K in keyof typeof options]?: string | boolean };

function shared(values: Values, positionals: string[]): CliOptions {
  return {
    language: String(values.language ?? ""),
    pattern: String(values.pattern ?? ""),
    replacement: values.replace as string | undefined,
    adapterModule: values.adapter as string | undefined,
    extensions: values.ext
      ? String(values.ext)
          .split(",")
          .map((part) => (part.startsWith(".") ? part : `.${part}`))
      : undefined,
    trivia: values.trivia as TriviaPolicy | undefined,
    onParseError: values["on-parse-error"] as ParseErrorPolicy | undefined,
    write: Boolean(values.write),
    paths: positionals.slice(1),
  };
}

function printFindings(findings: readonly Finding[], asJson: boolean): void {
  if (asJson) {
    process.stdout.write(`${JSON.stringify(findings, null, 2)}\n`);
    return;
  }
  for (const finding of findings) {
    if (finding.error) {
      process.stderr.write(`${finding.path}: ${finding.error}\n`);
      continue;
    }
    const preview = finding.text!.split("\n")[0]!.slice(0, 120);
    process.stdout.write(`${finding.path}:${finding.line}:${finding.column}  ${preview}\n`);
    for (const [name, value] of Object.entries(finding.captures ?? {})) {
      const rendered = Array.isArray(value) ? value.join(" | ") : value;
      process.stdout.write(`    $${name} = ${JSON.stringify(rendered.slice(0, 100))}\n`);
    }
  }
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({ options, allowPositionals: true });
  const command = positionals[0];

  if (values.help || !command) {
    process.stdout.write(USAGE);
    return;
  }

  if (command === "languages") {
    process.stdout.write(`${languageIds().join("\n")}\n`);
    return;
  }

  const config = shared(values, positionals);
  if (!config.language) return fail("--language is required");
  if (!config.pattern) return fail("--pattern is required");

  if (command === "debug") {
    const language = await loadLanguage(config.language, { adapterModule: config.adapterModule });
    const { pattern } = compileCliPattern(language, config.pattern, { trivia: config.trivia });
    process.stdout.write(`${pattern.debug()}\n`);
    return;
  }

  if (command === "find") {
    const findings = await find(config);
    printFindings(findings, Boolean(values.json));
    process.exitCode = findings.length > 0 ? 0 : 1;
    return;
  }

  if (command === "replace") {
    if (!config.replacement) return fail("--replace is required");
    const changes = await rewrite(config);
    if (values.json) {
      const summary = changes.map(({ path, count }) => ({ path, count }));
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    } else if (config.write) {
      for (const change of changes) process.stdout.write(`${change.path}: ${change.count} change(s)\n`);
    } else {
      for (const change of changes) process.stdout.write(change.after);
    }
    process.exitCode = changes.length > 0 ? 0 : 1;
    return;
  }

  fail(`unknown command "${command}"`);
}

main().catch((error: unknown) => {
  process.stderr.write(`cs: ${(error as Error).message}\n`);
  process.exitCode = 1;
});
