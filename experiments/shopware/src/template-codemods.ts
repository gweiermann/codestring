import { any, capture, code, createLanguage } from "@codestring/core";
import { createTransformer } from "@codestring/codemod";
import { htmlAdapter } from "@codestring/html";

const html = createLanguage(htmlAdapter);

const body = capture("body");
const blockName = capture("blockName");

/**
 * Shopware's `core-rules/remove-empty-templates` (82 lines), as a codemod.
 *
 * The original says three things by hand: the element is a `template`, it is
 * not the document root, and `startTag.attributes.length === 0`. All three are
 * in the pattern — a `<template>` written without attributes only matches an
 * element that has none, and a pattern never matches the document itself.
 */
export const removeEmptyTemplates = createTransformer({
  name: "remove <template> tags with no attributes",
  language: html,
  fileGlob: "**/*.{html,twig,vue}",
  transform: ({ source }) => source.replaceAll(code`<template>${body}</template>`, code`${body}`),
});

/**
 * Shopware's `core-rules/replace-top-level-blocks-to-extends` (110 lines).
 *
 * Only top-level blocks change, which the original expresses by checking
 * `node.parent.type === 'VDocumentFragment'`. Here the match carries its nodes,
 * so the same question is `match.nodes[0].parent === source.root`.
 */
export const topLevelBlocksToExtends = createTransformer({
  name: "top-level <sw-block name> becomes <sw-block extends>",
  language: html,
  fileGlob: "**/*.html.twig",
  transform: ({ source }) =>
    source.replaceAll(code`<sw-block name="${blockName}"${any()}>${body}</sw-block>`, (match) => {
      const element = match.nodes[0];
      if (element?.parent !== source.root) return null;
      // Rewriting only the attribute region leaves the element's own layout
      // alone; rebuilding the whole element from a template would not, because
      // a capture binds the nodes inside it and not the whitespace around them.
      const attributes = element.children[0];
      // The attributes region starts right after the tag name, so it owns the
      // space before the first attribute and the replacement has to put it back.
      return attributes ? match.replace(attributes)` extends="${blockName}"` : null;
    }),
});

const slotAttribute = capture("slotAttribute");

/**
 * Shopware's `core-rules/move-slots-to-wrap-blocks` (96 lines), in one pattern.
 *
 * The slot is captured as a whole attribute rather than as the name after `#`,
 * because a hole cannot attach to part of an attribute name.
 */
export const wrapSlotsInBlocks = createTransformer({
  name: "a slot template inside sw-block moves outside it",
  language: html,
  fileGlob: "**/*.html.twig",
  transform: ({ source }) =>
    source.replaceAll(
      code`<sw-block name="${blockName}"><template ${slotAttribute}>${body}</template></sw-block>`,
      (match) =>
        match.get(slotAttribute).text().startsWith("#")
          ? match.replace`<template ${slotAttribute}><sw-block name="${blockName}">${body}</sw-block></template>`
          : null,
    ),
});
