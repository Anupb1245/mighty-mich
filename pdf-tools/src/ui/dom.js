export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "html") el.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (k in el && typeof v !== "string") el[k] = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function formatBytes(n) {
  if (!Number.isFinite(n)) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 2 : 1)} MB`;
}

let toastTimer;
export function toast(message, kind = "info") {
  document.querySelectorAll(".toast").forEach((t) => t.remove());
  const el = h("div", { class: `toast ${kind}`, role: "status" }, message);
  document.body.append(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), kind === "error" ? 6000 : 3500);
}

export function download(bytes, name, mime = "application/octet-stream") {
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = h("a", { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function readFile(file) {
  return new Uint8Array(await file.arrayBuffer());
}

/** Minimal modal that resolves with the typed value or null. */
export function prompt({ title, label, type = "password", okLabel = "OK", error = "" }) {
  return new Promise((resolve) => {
    const input = h("input", { type, autocomplete: "off", "aria-label": label });
    const errEl = h("div", { class: "hintline", style: "color: var(--danger)" }, error);
    const close = (v) => {
      bg.remove();
      resolve(v);
    };
    const bg = h(
      "div",
      { class: "modal-bg", onclick: (e) => e.target === bg && close(null) },
      h(
        "form",
        {
          class: "modal",
          onsubmit: (e) => {
            e.preventDefault();
            close(input.value);
          },
        },
        h("h3", {}, title),
        h("div", { class: "opt" }, h("label", {}, label), input, errEl),
        h("div", { class: "row" }, h("button", { type: "button", class: "btn secondary", onclick: () => close(null) }, "Cancel"), h("button", { type: "submit", class: "btn" }, okLabel))
      )
    );
    document.body.append(bg);
    input.focus();
  });
}
