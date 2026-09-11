import { runAdapterContractSuite } from "@codestring/testing";
import { toyAdapter } from "./toy-language.js";

runAdapterContractSuite(toyAdapter, {
  valid: ["(a)", "(sum 1 2)", "(a (b (c)))", "; comment only\n", '(say "hello world")'],
  malformed: ["(unclosed", "closed)", '(string "'],
  unicode: ['(emoji "🎉")', "(🎉 1)"],
  placeholderContexts: [
    { before: "(call ", after: ")" },
    { before: "", after: "" },
  ],
});
