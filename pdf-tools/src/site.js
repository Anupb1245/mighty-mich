// Shared chrome: nav, footer, tool grids. Used by every page.
import { TOOLS, CATEGORIES, inCategory } from "./registry.js";
import { icons, logo } from "./icons.js";
import { h } from "./ui/dom.js";

export const SITE = { name: "Inkfold", tagline: "PDF tools that never leave your device." };

export function toolCard(t) {
  const cat = CATEGORIES.find((c) => c.id === t.category);
  return h(
    "a",
    { class: "card", href: `tool.html?tool=${t.id}`, style: `--cat:${cat.color}`, dataset: { tool: t.id } },
    h("span", { class: "ic", html: icons[t.icon] }),
    h("span", {}, h("b", {}, t.name), h("span", {}, t.tagline))
  );
}

export function toolGrid(ids) {
  const list = ids ? ids.map((id) => TOOLS.find((t) => t.id === id)).filter(Boolean) : TOOLS;
  return h("div", { class: "grid" }, list.map(toolCard));
}

export function groupedGrid() {
  const frag = document.createDocumentFragment();
  for (const c of CATEGORIES) {
    frag.append(h("div", { class: "cat-label", style: `--cat:${c.color}` }, c.name), toolGrid(inCategory(c.id).map((t) => t.id)));
  }
  return frag;
}

export function mountNav() {
  const nav = document.querySelector(".nav .wrap");
  if (!nav) return;
  nav.replaceChildren(
    h("a", { class: "brand", href: "index.html", html: `${logo}<span>${SITE.name}</span>` }),
    h(
      "nav",
      { class: "nav-links", "aria-label": "Main" },
      h("a", { href: "tools.html" }, "All tools"),
      h("a", { href: "tool.html?tool=merge-pdf", class: "optional" }, "Merge"),
      h("a", { href: "tool.html?tool=compress-pdf", class: "optional" }, "Compress"),
      h("a", { href: "tool.html?tool=split-pdf", class: "optional" }, "Split"),
      h("a", { href: "index.html#why", class: "optional" }, "Why local")
    )
  );
}

export function mountFooter() {
  const f = document.querySelector("footer .wrap");
  if (!f) return;
  f.replaceChildren(
    h("div", {}, `${SITE.name} · ${SITE.tagline}`),
    h("div", {}, "Free and open source (MIT). No uploads, no accounts, no tracking.")
  );
}

export function mountGrids() {
  document.querySelectorAll("[data-grid=all]").forEach((el) => el.replaceChildren(groupedGrid()));
  document.querySelectorAll("[data-grid=popular]").forEach((el) => el.replaceChildren(toolGrid(["merge-pdf", "compress-pdf", "split-pdf", "jpg-to-pdf", "pdf-to-jpg", "protect-pdf"])));
  const n = document.querySelector("[data-tool-count]");
  if (n) n.textContent = String(TOOLS.length);
}

mountNav();
mountFooter();
mountGrids();
