# @codestring/cli

`cs` — structural grep and rewrite for any adapter.

```bash
cs find    -l twig       -p '{% block $name %}$$$body{% endblock %}' templates/
cs find    -l javascript -p 'console.log($$$args)' src/ --json
cs replace -l javascript -p 'foo($x)' -r 'bar($x)' --write src/
cs debug   -l html       -p '<template>$$$inner</template>'
cs languages
```

| hole | meaning |
|---|---|
| `$name` | exactly one node, captured |
| `$$$name` | a run of sibling nodes, captured |
| `$_`, `$$$_` | the same, without capturing |

In a replacement, `$name` inserts the captured source verbatim. With no paths, `cs` reads stdin. Built-in
adapters load lazily, so a Twig search never pays for acorn; `--adapter ./my-adapter.js` uses one of your own.

Other options: `--ext`, `--trivia`, `--on-parse-error`, `--write`, `--json`. `find` and `replace` exit `1` when
nothing matched, so they compose in shell pipelines.
