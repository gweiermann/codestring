import { describe, expect, it } from "vitest";
import { any, capture, code, createLanguage } from "@codestring/core";
import { htmlAdapter } from "@codestring/html";
import { javascriptAdapter } from "@codestring/javascript";
import { cssAdapter } from "@codestring/css";

const html = createLanguage(htmlAdapter);
const js = createLanguage(javascriptAdapter);
const css = createLanguage(cssAdapter);

const body = capture("body");
const script = code`<script${any()}>${body}</script>`;
const style = code`<style${any()}>${body}</style>`;

/**
 * `<script>` and `<style>` are raw text elements: the HTML tokenizer ends them
 * at the first `</script>` / `</style>`, whatever the embedded language thinks
 * it is in the middle of. A browser does the same, so the library agrees with
 * what would actually run.
 */
describe("a closing tag inside an embedded string", () => {
  const source = `<script>const foo = "bar</script>"; </script>`;

  it("ends the script where the HTML tokenizer ends it, as a browser would", () => {
    expect(html.parse(source).match(script)!.get(body).text()).toBe('const foo = "bar');
  });

  it("leaves the rest of the line as markup, not as script", () => {
    const kinds = html.parse(source).nodes().map((node) => node.kind);
    expect(kinds).toEqual(["fragment", "element:script", "attributes", "text", "text", "whitespace"]);
  });

  it("reports the truncated region as broken JavaScript", () => {
    const inner = js.parse(html.parse(source).match(script)!.get(body));
    expect(inner.hasErrors()).toBe(true);
    expect(inner.diagnostics[0]!.message).toMatch(/Unterminated string/);
  });

  it("rewrites nothing there, because no match may touch a broken region", () => {
    const result = html
      .parse(source)
      .inside((block) => code`<script${any()}>${block}</script>`, js, (inner) =>
        inner.replaceAll(code`const foo = ${any()}`, "const foo = 1"),
      );
    expect(result.text()).toBe(source);
  });

  it("works exactly as expected once the source escapes the sequence", () => {
    const escaped = String.raw`<script>const foo = "bar<\/script>"; </script>`;
    const result = html
      .parse(escaped)
      .inside((block) => code`<script${any()}>${block}</script>`, js, (inner) =>
        inner.replaceAll(code`const foo = ${any()}`, "const foo = 1"),
      );
    expect(result.text()).toBe("<script>const foo = 1; </script>");
  });

  it("applies the same rule to style elements", () => {
    const styles = `<style>.a::after { content: "</style>"; }</style>`;
    expect(html.parse(styles).match(style)!.get(body).text()).toBe('.a::after { content: "');
    const result = html
      .parse(styles)
      .inside((block) => code`<style${any()}>${block}</style>`, css, (inner) =>
        inner.replaceAll(code`color: red`, "color: blue"),
      );
    expect(result.text()).toBe(styles);
  });

  it("still rewrites a script that happens to end early but parses", () => {
    const odd = `<script>const a = [1];</script> stray </script>`;
    const result = html
      .parse(odd)
      .inside((block) => code`<script${any()}>${block}</script>`, js, (inner) =>
        inner.replaceAll(code`[1]`, "[2]"),
      );
    expect(result.text()).toBe(`<script>const a = [2];</script> stray </script>`);
  });
});
