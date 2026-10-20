// Shared chrome: nav, footer, tool grids. Used by every page.
import { TOOLS, CATEGORIES, inCategory, categoryOf } from "./registry.js";
import { icons, logo } from "./icons.js";
import { h } from "./ui/dom.js";

export const SITE = { name: "Inkfold", tagline: "PDF tools that never leave your device." };

export function toolCard(t) {
  const cat = categoryOf(t);
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
    const tools = inCategory(c.id).filter((t) => !t.hidden);
    if (!tools.length) continue;
    frag.append(h("div", { class: "cat-label", style: `--cat:${c.color}` }, c.name), toolGrid(tools.map((t) => t.id)));
  }
  return frag;
}

/** The "Tools" mega-menu: one column per category column, every tool with its icon. */
export function megaMenu() {
  const columns = [...new Set(CATEGORIES.map((c) => c.column))].sort().map((col) =>
    h(
      "div",
      { class: "mega-col" },
      CATEGORIES.filter((c) => c.column === col).map((c) => {
        const tools = inCategory(c.id).filter((t) => !t.hidden);
        if (!tools.length) return null;
        return h(
          "div",
          { class: "mega-group", style: `--cat:${c.color}` },
          h("div", { class: "mega-head" }, c.name),
          tools.map((t) => h("a", { href: `tool.html?tool=${t.id}`, class: "mega-item" }, h("span", { class: "ic", html: icons[t.icon] || icons.merge }), h("span", {}, t.name)))
        );
      })
    )
  );
  return h("div", { class: "mega", role: "menu", hidden: true }, h("div", { class: "wrap mega-grid" }, columns));
}

export function mountNav() {
  const nav = document.querySelector(".nav .wrap");
  if (!nav) return;
  const menu = megaMenu();
  const toggle = h(
    "button",
    { class: "nav-tools", "aria-expanded": "false", "aria-haspopup": "true", html: `${icons.grid}<span>Tools</span>` , onclick: () => setOpen(menu.hidden) }
  );
  const setOpen = (open) => {
    menu.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    toggle.classList.toggle("open", open);
  };
  document.addEventListener("click", (e) => {
    if (!menu.hidden && !menu.contains(e.target) && !toggle.contains(e.target)) setOpen(false);
  });
  document.addEventListener("keydown", (e) => e.key === "Escape" && setOpen(false));
  nav.replaceChildren(
    h("a", { class: "brand", href: "index.html", html: `${logo}<span>${SITE.name}</span>` }),
    toggle,
    h(
      "nav",
      { class: "nav-links", "aria-label": "Main" },
      h("a", { href: "tool.html?tool=compress-pdf", class: "optional" }, "Compress"),
      h("a", { href: "tool.html?tool=pdf-converter", class: "optional" }, "Convert"),
      h("a", { href: "tool.html?tool=merge-pdf", class: "optional" }, "Merge"),
      h("a", { href: "tool.html?tool=edit-pdf", class: "optional" }, "Edit"),
      h("a", { href: "tool.html?tool=sign-pdf", class: "optional" }, "Sign"),
      h("a", { href: "tool.html?tool=ai-assistant", class: "optional" }, "AI PDF"),
      h("a", { href: "tools.html" }, "All tools")
    )
  );
  document.querySelector(".nav").append(menu);
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
  document.querySelectorAll("[data-grid=popular]").forEach((el) => el.replaceChildren(toolGrid(["merge-pdf", "compress-pdf", "edit-pdf", "sign-pdf", "pdf-to-word", "word-to-pdf", "jpg-to-pdf", "ai-assistant"].filter((id) => TOOLS.some((t) => t.id === id)))));
  const n = document.querySelector("[data-tool-count]");
  if (n) n.textContent = String(TOOLS.length);
}

mountNav();
mountFooter();
mountGrids();
