import { h, formatBytes } from "./dom.js";
import { icons } from "../icons.js";

function dnd(list, items, onReorder, selector) {
  let from = -1;
  for (const el of list.querySelectorAll(selector)) {
    el.draggable = true;
    el.addEventListener("dragstart", (e) => {
      from = Number(el.dataset.i);
      el.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(from));
    });
    el.addEventListener("dragend", () => {
      el.classList.remove("dragging");
      list.querySelectorAll(".over").forEach((x) => x.classList.remove("over"));
    });
    el.addEventListener("dragover", (e) => {
      e.preventDefault();
      el.classList.add("over");
    });
    el.addEventListener("dragleave", () => el.classList.remove("over"));
    el.addEventListener("drop", (e) => {
      e.preventDefault();
      const to = Number(el.dataset.i);
      if (from < 0 || from === to) return;
      const [moved] = items.splice(from, 1);
      items.splice(to, 0, moved);
      onReorder();
    });
  }
}

/** File chips with reorder/remove. */
export function fileList(files, { onChange, onRemove }) {
  const list = h("div", { class: "files", role: "list" });
  const render = () => {
    list.replaceChildren(
      ...files.map((f, i) =>
        h(
          "div",
          { class: "file", role: "listitem", dataset: { i } },
          h("span", { class: "handle", html: icons.grip, title: "Drag to reorder" }),
          h("img", { class: "thumb", src: f.thumb || "", alt: "" }),
          h("div", { class: "meta" }, h("b", {}, f.name), h("span", {}, [f.pageCount ? `${f.pageCount} page${f.pageCount === 1 ? "" : "s"} · ` : "", formatBytes(f.size)].join(""))),
          h(
            "div",
            { class: "acts" },
            h("button", { class: "iconbtn", title: "Move up", "aria-label": `Move ${f.name} up`, disabled: i === 0, html: icons.left, onclick: () => (files.splice(i - 1, 0, files.splice(i, 1)[0]), onChange()) }),
            h("button", { class: "iconbtn", title: "Move down", "aria-label": `Move ${f.name} down`, disabled: i === files.length - 1, html: icons.right, onclick: () => (files.splice(i + 1, 0, files.splice(i, 1)[0]), onChange()) }),
            h("button", { class: "iconbtn danger", title: "Remove", "aria-label": `Remove ${f.name}`, html: icons.x, onclick: () => onRemove(i) })
          )
        )
      )
    );
    dnd(list, files, onChange, ".file");
  };
  render();
  return { el: list, render };
}

/** Thumbnail grid for one file's pages. selectable: clicking toggles. */
export function pageGrid(file, { selectable = true, removable = true, onChange, loadThumb }) {
  const grid = h("div", { class: "pages", role: "list", "aria-label": "Pages" });
  const pending = new Set();
  const ensureThumb = async (p, img) => {
    if (p.thumb || pending.has(p.index)) {
      if (p.thumb) img.src = p.thumb;
      return;
    }
    pending.add(p.index);
    try {
      p.thumb = await loadThumb(p.index);
      img.src = p.thumb;
    } catch {
      /* leave blank */
    }
    pending.delete(p.index);
  };
  const render = () => {
    grid.replaceChildren(
      ...file.pages.map((p, i) => {
        const img = h("img", { alt: `Page ${p.index + 1}`, style: `transform: rotate(${p.rotation}deg)` });
        ensureThumb(p, img);
        const rot = (d) => {
          p.rotation = (((p.rotation + d) % 360) + 360) % 360;
          onChange();
        };
        return h(
          "div",
          {
            class: `page${p.selected ? " selected" : ""}`,
            role: "listitem",
            tabindex: 0,
            dataset: { i },
            "aria-pressed": selectable ? String(!!p.selected) : null,
            onclick: (e) => {
              if (e.target.closest("button")) return;
              if (!selectable) return;
              p.selected = !p.selected;
              onChange();
            },
            onkeydown: (e) => {
              if (e.target !== e.currentTarget) return;
              if ((e.key === "Enter" || e.key === " ") && selectable) (e.preventDefault(), (p.selected = !p.selected), onChange());
              if (e.key === "r") rot(90);
              if (e.key === "Delete" && removable) (file.pages.splice(i, 1), onChange());
            },
          },
          selectable && h("span", { class: "check", html: p.selected ? icons.check : "" }),
          h(
            "div",
            { class: "acts" },
            h("button", { class: "iconbtn", title: "Rotate left", "aria-label": `Rotate page ${p.index + 1} left`, html: icons.rotl, onclick: () => rot(-90) }),
            h("button", { class: "iconbtn", title: "Rotate right", "aria-label": `Rotate page ${p.index + 1} right`, html: icons.rotr, onclick: () => rot(90) }),
            removable && h("button", { class: "iconbtn danger", title: "Remove page", "aria-label": `Remove page ${p.index + 1}`, html: icons.x, onclick: () => (file.pages.splice(i, 1), onChange()) })
          ),
          h("div", { class: "img" }, img),
          h("div", { class: "num" }, String(p.index + 1))
        );
      })
    );
    dnd(grid, file.pages, onChange, ".page");
  };
  render();
  return { el: grid, render };
}
