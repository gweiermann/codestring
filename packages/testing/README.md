# @codestring/testing

The compliance suite every language adapter should run.

```ts
import { runAdapterContractSuite } from "@codestring/testing";
import { myAdapter } from "../src/index.js";

runAdapterContractSuite(myAdapter, {
  valid: ["a = 1"],
  malformed: ["a = "],
  unicode: ["a = '🎉'"],
  placeholderContexts: [{ before: "a = ", after: "" }],
});
```

It checks valid ranges, source ordering, parent containment, root coverage, UTF-16 offsets, trivia classes,
diagnostics shape, malformed input and placeholder round-tripping. It asserts nothing about matching — that is
the core's job. Needs `vitest` as a peer.
