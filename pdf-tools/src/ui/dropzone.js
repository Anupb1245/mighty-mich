import { h } from "./dom.js";
import { icons } from "../icons.js";

/** Big drop target + hidden file input. onFiles(FileList|File[]). */
export function dropzone({ accept, multiple, label, hint, onFiles, compact = false, capture }) {
  const input = h("input", { type: "file", accept, multiple: !!multiple, onchange: () => input.files.length && (onFiles([...input.files]), (input.value = "")) });
  if (capture) input.setAttribute("capture", capture);
  const zone = h(
    "div",
    {
      class: "drop",
      role: "button",
      tabindex: 0,
      "aria-label": label,
      onclick: () => input.click(),
      onkeydown: (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), input.click()),
      ondragover: (e) => {
        e.preventDefault();
        zone.classList.add("over");
      },
      ondragleave: () => zone.classList.remove("over"),
      ondrop: (e) => {
        e.preventDefault();
        zone.classList.remove("over");
        const files = [...(e.dataTransfer?.files || [])];
        if (files.length) onFiles(files);
      },
    },
    h("div", { html: icons.upload }),
    h("div", { class: "big" }, label),
    h("div", { class: "hint" }, hint),
    h("div", { style: "margin-top:16px" }, h("span", { class: "btn" }, capture ? "Take a photo or choose files" : multiple ? "Choose files" : "Choose file")),
    input
  );
  if (compact) zone.style.padding = "24px";
  return zone;
}

/** Whole-page drag & drop so users can drop anywhere. */
export function pageDrop(onFiles) {
  let depth = 0;
  document.addEventListener("dragenter", (e) => {
    e.preventDefault();
    depth++;
    document.body.classList.add("dragging-files");
  });
  document.addEventListener("dragleave", () => {
    depth = Math.max(0, depth - 1);
    if (!depth) document.body.classList.remove("dragging-files");
  });
  document.addEventListener("dragover", (e) => e.preventDefault());
  document.addEventListener("drop", (e) => {
    e.preventDefault();
    depth = 0;
    document.body.classList.remove("dragging-files");
    const files = [...(e.dataTransfer?.files || [])];
    if (files.length) onFiles(files);
  });
}
