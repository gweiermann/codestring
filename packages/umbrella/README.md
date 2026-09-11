# codestring

One install for the core and every first-party adapter.

```ts
import { createLanguage, capture, twigAdapter, htmlAdapter, javascriptAdapter } from "codestring";
```

Subpath imports keep the bundle honest when you only need one language:

```ts
import { htmlAdapter } from "codestring/html";
```

To avoid pulling in parsers you do not use, depend on `@codestring/core` plus the individual adapter
packages instead.
