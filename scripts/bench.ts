import { SourceDocument, any, capture, createLanguage, replace } from "@codestring/core";
import { twigAdapter } from "@codestring/twig";
import { htmlAdapter } from "@codestring/html";
import { javascriptAdapter } from "@codestring/javascript";

const twig = createLanguage(twigAdapter);
const html = createLanguage(htmlAdapter);
const js = createLanguage(javascriptAdapter);

const unit = `{% block block_NN %}
  <template class="t">
    <div class="cell">{{ product.name }}</div>
  </template>
{% endblock %}
`;

const jsUnit = `export function handler_NN(input) {
  console.log('start', input);
  return legacyFetch(input).then((value) => value.json());
}
`;

function grow(template: string, bytes: number): string {
  let text = "";
  let index = 0;
  while (text.length < bytes) text += template.replaceAll("NN", String(index++));
  return text;
}

function time(label: string, runs: number, fn: () => unknown): void {
  fn();
  const started = performance.now();
  for (let i = 0; i < runs; i++) fn();
  const each = (performance.now() - started) / runs;
  process.stdout.write(`${label.padEnd(46)} ${each.toFixed(2).padStart(9)} ms\n`);
}

const name = capture("name");
const body = capture("body");
const blockPattern = twig.pattern`{% block ${name} %}${body}{% endblock %}`;
const inner = capture("inner");
const templatePattern = html.pattern`<template${any()}>${inner}</template>`;
const logArguments = capture("logArguments");
const consoleLog = js.pattern`console.log(${logArguments})`;

for (const bytes of [1_000, 100_000, 1_000_000]) {
  const label = bytes >= 1_000_000 ? "1 MB" : bytes >= 100_000 ? "100 KB" : "1 KB";
  const twigText = grow(unit, bytes);
  const jsText = grow(jsUnit, bytes);
  const runs = bytes > 500_000 ? 3 : 20;

  process.stdout.write(`\n${label} (twig ${twigText.length} chars, js ${jsText.length} chars)\n`);

  time("twig parse", runs, () => twig.parse(new SourceDocument(twigText)));
  time("twig findAll blocks", runs, () => blockPattern.findAll(new SourceDocument(twigText)));
  time("twig findAll + nested html findAll", runs, () => {
    const document = new SourceDocument(twigText);
    for (const match of blockPattern.findAll(document)) templatePattern.findAll(match.get(body));
  });
  time("twig findAll + transform every match", runs, () => {
    const document = new SourceDocument(twigText);
    const matches = blockPattern.findAll(document);
    const edits = matches.map((match) => replace(match.get(body), "x"));
    return matches[0] ? matches[0].transform(edits) : document.text;
  });
  time("javascript parse", runs, () => js.parse(new SourceDocument(jsText)));
  time("javascript findAll calls", runs, () => consoleLog.findAll(new SourceDocument(jsText)));
}
