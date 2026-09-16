// Theme toggle, remembered per viewer. Wrapped because a browser set to block
// site data throws on the accessor itself rather than returning null.
(function () {
  const root = document.documentElement;
  let stored = null;
  try {
    stored = localStorage.getItem("codestring-theme");
  } catch {}
  if (stored === "dark" || stored === "light") root.setAttribute("data-theme", stored);

  const button = document.querySelector("[data-theme-toggle]");
  if (!button) return;

  const label = () => {
    const dark =
      root.getAttribute("data-theme") === "dark" ||
      (!root.hasAttribute("data-theme") && window.matchMedia("(prefers-color-scheme: dark)").matches);
    button.textContent = dark ? "☀ Light" : "☾ Dark";
  };

  label();
  button.addEventListener("click", () => {
    const dark =
      root.getAttribute("data-theme") === "dark" ||
      (!root.hasAttribute("data-theme") && window.matchMedia("(prefers-color-scheme: dark)").matches);
    const next = dark ? "light" : "dark";
    root.setAttribute("data-theme", next);
    try {
      localStorage.setItem("codestring-theme", next);
    } catch {}
    label();
  });
})();

// Build the sidebar contents from the headings actually on the page, so a new
// section never needs a second edit somewhere else.
(function () {
  const toc = document.querySelector("[data-toc]");
  if (!toc) return;

  const headings = document.querySelectorAll("main h2[id], main h3[id]");
  if (headings.length === 0) {
    toc.remove();
    return;
  }

  const list = document.createElement("div");
  headings.forEach((heading) => {
    const link = document.createElement("a");
    link.href = "#" + heading.id;
    link.textContent = heading.dataset.toc || heading.textContent;
    if (heading.tagName === "H3") link.className = "is-sub";
    list.appendChild(link);
  });
  toc.appendChild(list);
})();
