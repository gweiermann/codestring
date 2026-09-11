import { any, capture, code, createLanguage } from "@codestring/core";
import { twigAdapter } from "@codestring/twig";
import { htmlAdapter } from "@codestring/html";

const twig = createLanguage(twigAdapter);
const html = createLanguage(htmlAdapter);

const blockName = capture("blockName");
const blockContent = capture("blockContent");
const inner = capture("inner");

const blockPattern = code`
  {% block ${blockName} %}
    ${blockContent}
  {% endblock %}
`;

const templatePattern = code`<template${any()}>${inner}</template>`;

/**
 * Wrap the contents of a Twig block in `<sw-block>`. When the block already
 * holds a `<template>`, the wrapper goes inside it instead.
 *
 * The Twig parser never sees the HTML and the HTML parser never sees the Twig:
 * the block body is captured as a source range and re-read by the other
 * language, and edits from either one land in the original file.
 */
export function transform(sourceCode: string): string {
  return twig
    .parse(sourceCode)
    .replace(blockPattern, (block) => {
      const templates = html.parse(block.get(blockContent)).matchAll(templatePattern);
      if (templates.length > 1) throw new Error("At most one template is allowed");

      const template = templates[0];
      return template
        ? template.replace(inner)`<sw-block name="${block.get(blockName)}">${inner}</sw-block>`
        : block.replace(blockContent)`<sw-block name="${blockName}">${blockContent}</sw-block>`;
    })
    .text();
}
