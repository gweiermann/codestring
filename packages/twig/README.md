# @codestring/twig

Twig adapter, with its own dependency-free parser: text, `{{ output }}`, `{# comments #}`, and `{% tags %}`
paired by their `{% end... %}` counterpart (`block`, `if`, `for`, `embed`, `apply`, `with`, `macro`, `filter`,
`autoescape`, `sandbox`, `spaceless`, `verbatim`, and `set` without `=`). Whitespace control (`{%- -%}`) is
understood; a `verbatim` body stays raw.

```ts
const twig = createLanguage(twigAdapter);
const name = capture();
const body = capture();

twig.pattern`{% block ${name} %}${body}{% endblock %}`;
```

Exported types: `TwigNode`, `TwigParsed`, and `parseTwig` for direct use.

Node kinds: `document`, `text`, `whitespace`, `comment`, `output`, `args`, `body`, `tag:<name>`, plus the
expression token kinds `name`, `number`, `string` and `operator`.

A hole must be a whole text run between two tags, a whole tag argument, or a token inside one — the parser
folds `before ${x} after` into a single text node, and compiling that is an error rather than a pattern that
never matches.
