import { capture, code, createLanguage } from "@codestring/core";
import { createRule } from "@codestring/eslint";
import { htmlAdapter, type HtmlNode } from "@codestring/html";

const html = createLanguage(htmlAdapter);
const body = capture("body");

/**
 * Shopware's `core-rules/remove-empty-templates`, migrated.
 *
 * The original is 82 lines and has to say three things by hand: the element is
 * a `template`, it is not the root, and `startTag.attributes.length === 0`. All
 * three fall out of the pattern here — a `<template>` written without
 * attributes only matches an element that has none, and a pattern only ever
 * matches inside a document, never the document itself.
 */
export const removeEmptyTemplates = createRule<{ one: typeof body; optional: never; many: never }, HtmlNode>({
  meta: {
    type: "problem",
    fixable: "code",
    docs: { description: "Remove <template> tags that carry no attributes" },
    messages: { empty: "Remove template tags with no attributes." },
  },
  language: html,
  find: code`<template>${body}</template>`,
  messageId: "empty",
  fix: (match) => match.replace`${body}`,
});
