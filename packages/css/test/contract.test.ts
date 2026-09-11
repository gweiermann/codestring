import { runAdapterContractSuite } from "@codestring/testing";
import { cssAdapter } from "@codestring/css";

runAdapterContractSuite(cssAdapter, {
  valid: [
    ".a { color: red; }",
    "a,\nb { margin: 0 auto; padding: 1px }",
    "@media (min-width: 600px) { .a { color: blue; } }",
    "/* a comment */\n.a { color: red }",
    ":root { --danger: #c00; }",
    "@import 'other.css';",
    ".a { background: url(a.png) no-repeat; }",
  ],
  malformed: [".a { color: red", "}", ".a { ; }", "@media {"],
  unicode: [".🎉 { content: '🎉'; }", "/* 🎉 */"],
  placeholderContexts: [
    { before: ".a { color: ", after: "; }" },
    { before: ".a { ", after: ": red; }" },
    { before: "", after: " { color: red; }" },
  ],
});
