# @codestring/vue

Vue template adapter, backed by [`@vue/compiler-dom`](https://github.com/vuejs/core).

It reads what Vue reads, rather than the markup underneath — so a pattern can say `v-if` and mean
the directive, not an attribute that happens to be spelled that way.

```ts
import { capture, code, createLanguage } from "@codestring/core";
import { vueAdapter } from "@codestring/vue";

const vue = createLanguage(vueAdapter);
const body = capture("body");

vue.parse(template).matchAll(code`<${any()} v-if="ok">${body}</${any()}>`);
```

Node kinds: `root`, `element:<tag>`, `component:<tag>`, `tag-open`, `tag-close`, `attributes`,
`attribute`, `attribute-value`, `directive:<name>`, `directive-argument`, `expression`,
`interpolation`, `text`, `whitespace`, `comment`.

`v-if`, `:value`, `@click` and `#slot` all arrive as `directive:<name>` with the shorthand resolved,
and an element Vue resolves to a component is `component:<tag>` rather than `element:<tag>`.
`NodeRef.raw` is the compiler's own node, for anything the normalized tree does not carry.
