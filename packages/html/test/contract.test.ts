import { runAdapterContractSuite } from "@codestring/testing";
import { htmlAdapter } from "@codestring/html";

runAdapterContractSuite(htmlAdapter, {
  valid: [
    "<p>hello</p>",
    '<div class="a" id="b"><span>x</span></div>',
    "<template><p>x</p></template>",
    "<br>",
    "<img src='a.png'/>",
    "<!-- a comment -->",
    "text only",
    "<ul>\n  <li>one</li>\n  <li>two</li>\n</ul>",
    "<input disabled>",
  ],
  malformed: ["<div><span></div>", "<p", "</p>", "<div class=>", "<a href='unclosed>"],
  unicode: ["<p>🎉</p>", '<div title="🎉">x</div>', "🎉"],
  placeholderContexts: [
    { before: "<div ", after: "></div>" },
    { before: "<div>", after: "</div>" },
    { before: "<template>", after: "</template>" },
  ],
});
