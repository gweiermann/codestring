import { any, capture, code, createLanguage } from "@codestring/core";
import { createTransformer } from "@codestring/codemod";
import { htmlAdapter } from "@codestring/html";
import { javascriptAdapter } from "@codestring/javascript";
import { cssAdapter } from "@codestring/css";

const html = createLanguage(htmlAdapter);
const js = createLanguage(javascriptAdapter);
const css = createLanguage(cssAdapter);

const bold = capture("bold");
const logArguments = capture("logArguments");

/**
 * One `.vue` file, three grammars. The file is read as HTML; `inside()` hands
 * the region callback a capture for the embedded source, re-reads what it
 * matched with another language, rewrites it there, and splices the result
 * back — so every edit lands in the original file and no parser ever sees
 * another one's syntax.
 */
export const migrateVue = createTransformer({
  name: "vue: markup, script and style",
  language: html,
  fileGlob: "**/*.vue",
  transform: ({ source }) =>
    source
      // the markup itself, in the language of the file
      .replaceAll(code`<b>${bold}</b>`, code`<strong>${bold}</strong>`)
      // the <script> block, read as JavaScript
      .inside(
        (block) => code`<script${any()}>${block}</script>`,
        js,
        (script) =>
          script
            .replaceAll(code`console.log(${logArguments})`, code`logger.debug(${logArguments})`)
            .removeAll(code`debugger;`),
      )
      // the <style> block, read as CSS
      .inside(
        (block) => code`<style${any()}>${block}</style>`,
        css,
        (style) => style.replaceAll(code`color: red`, code`color: var(--text)`),
      ),
});

/** What each embedded language holds, without changing anything. */
export function report(source: string): Record<string, unknown> {
  const file = html.parse(source);
  const scriptBody = capture("scriptBody");
  const styleBody = capture("styleBody");
  const script = file.match(code`<script${any()}>${scriptBody}</script>`);
  const style = file.match(code`<style${any()}>${styleBody}</style>`);
  return {
    bold: file.count(code`<b>${bold}</b>`),
    consoleLog: script ? js.parse(script.get(scriptBody)).count(code`console.log(${any()})`) : 0,
    redDeclarations: style ? css.parse(style.get(styleBody)).count(code`color: red`) : 0,
  };
}
