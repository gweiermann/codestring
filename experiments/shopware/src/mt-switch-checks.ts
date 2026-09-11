import { capture, code, createLanguage } from "@codestring/core";
import { createCodemod, createTransformer } from "@codestring/codemod";
import { htmlAdapter } from "@codestring/html";

const html = createLanguage(htmlAdapter);
const rest = capture("rest");
const body = capture("body");

const vueTemplates = "**/*.{html.twig,vue}";

/**
 * A slice of Shopware's `mt-switch.check.js` (1082 lines). Each check there is
 * an `attributes.find(...)` over two spellings — the plain attribute and its
 * `:bound` form — plus a fixer built from `startTag` ranges.
 *
 * Here each one is a pattern that says "an mt-switch carrying this attribute,
 * whatever else it carries", and the removal takes the attribute out of the
 * list without disturbing the ones around it.
 */
const removeAttribute = (name: string, label: string) =>
  createTransformer({
    name: `mt-switch: ${label}`,
    language: html,
    fileGlob: vueTemplates,
    transform: ({ source }) =>
      source.replaceAll(code`<mt-switch ${rest}>${body}</mt-switch>`, (match) => {
        const attribute = match
          .get(rest)
          .nodes.find((node) => node.kind === "attribute" && node.text().replace(/^:/u, "").startsWith(name));
        return attribute ? match.remove(attribute) : null;
      }),
  });

export const dropNoMarginTop = removeAttribute("noMarginTop", "noMarginTop was removed");
export const dropSize = removeAttribute("size", "size was removed");

/** `bordered` became the default, so the explicit attribute is now noise. */
export const dropBordered = removeAttribute("bordered", "bordered is the default");

// `label` moved from an attribute to the default slot, and that one does not
// work yet: an element has no container node for its content, so a capture that
// binds nothing anchors at the end of the attribute list instead of after `>`.
// See the report — it wants a `content` node beside `attributes`.

export const mtSwitchMigration = createCodemod({
  name: "mt-switch migration",
  transformers: [dropNoMarginTop, dropSize, dropBordered],
});
