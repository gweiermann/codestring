import { runAdapterContractSuite } from "@codestring/testing";
import { javascriptAdapter } from "@codestring/javascript";

runAdapterContractSuite(javascriptAdapter, {
  valid: [
    "const a = 1;",
    "foo(bar(1, 2));",
    "function f(a, b) { return a + b; }",
    "class A { method() {} }",
    "// a comment\nconst b = 2;",
    "/* block */ f();",
    "import x from 'y';\nexport default x;",
    "const t = `template ${value} literal`;",
    "for (const item of items) { use(item); }",
  ],
  malformed: ["const = ;", "function (", "})", "const a = ;"],
  unicode: ["const emoji = '🎉';", "const 𝑥 = 1;", "// 🎉\n"],
  placeholderContexts: [
    { before: "foo(", after: ")" },
    { before: "function f() { ", after: " }" },
    { before: "const a = ", after: ";" },
    { before: "", after: "" },
  ],
});
