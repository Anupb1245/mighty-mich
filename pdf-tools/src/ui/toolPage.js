import { byId, TOOLS, categoryOf } from "../registry.js";
import * as render from "../render.js";
import { pageImages } from "../pageImages.js";
import { h, toast, download, readFile, formatBytes, prompt } from "./dom.js";
import { dropzone, pageDrop } from "./dropzone.js";
import { optionsForm } from "./options.js";
import { fileList, pageGrid } from "./fileList.js";
import { icons } from "../icons.js";
import { defaultPages, isPdf, ToolError } from "../tools/core.js";
import { toolCard } from "../site.js";

const WARN_BYTES = 200 * 1024 * 1024;

export function mountTool(root, toolId, initialFiles = []) {
  const tool = byId[toolId];
  if (!tool) {
    root.replaceChildren(h("div", { class: "wrap section" }, h("h1", {}, "That tool does not exist."), h("a", { href: "tools.html" }, "See all tools")));
    return;
  }
  const cat = categoryOf(tool);
  if (tool.styles && !document.querySelector(`link[data-tool-style="${tool.id}"]`)) {
    document.head.append(h("link", { rel: "stylesheet", href: tool.styles, dataset: { toolStyle: tool.id } }));
  }
  document.title = `${tool.name} — Inkfold`;
  document.querySelector('meta[name="description"]')?.setAttribute("content", `${tool.tagline} Runs in your browser; nothing is uploaded.`);

  const state = { files: [], status: "idle", result: null, error: null, progress: 0 };
  let custom = null; // handle returned by a custom tool UI
  const single = tool.mode !== "files";
  const maxFiles = single ? 1 : tool.maxFiles || 50;
  let options = optionsForm(tool.options || []);

  // --- file intake -------------------------------------------------------
  async function addFiles(raw) {
    const incoming = [...raw];
    if (single && incoming.length > 1) toast("This tool takes one file at a time. Using the first one.", "error");
    const take = single ? incoming.slice(0, 1) : incoming.slice(0, Math.max(0, maxFiles - state.files.length));
    if (!single && take.length < incoming.length) toast(`Up to ${maxFiles} files. The rest were skipped.`, "error");
    let added = 0;
    for (const f of take) {
      try {
        const loaded = await loadOne(f);
        if (!loaded) continue;
        if (single) {
          state.files.forEach((x) => render.forget(x.bytes));
          state.files = [loaded];
        } else state.files.push(loaded);
        added++;
      } catch (err) {
        toast(err.message || "Could not read that file.", "error");
      }
    }
    if (added && tool.hub) {
      const files = state.files.map((f) => new File([f.bytes], f.name, { type: "application/pdf" }));
      const target = tool.hub.map((id) => byId[id]).find((t) => t && (t.kinds || []).includes("pdf"));
      if (target) {
        history.pushState({}, "", `tool.html?tool=${target.id}`);
        mountTool(root, target.id, files);
        return;
      }
    }
    if (added) {
      state.error = null;
      state.status = "loaded";
      paint();
    }
  }

  const EXT = (name) => (String(name).match(/\.([a-z0-9]+)$/i) || [, ""])[1].toLowerCase();
  const IMAGE_EXT = /^(jpe?g|png|webp|gif|bmp|avif|svg)$/;

  async function loadOne(f) {
    const bytes = await readFile(f);
    const ext = EXT(f.name);
    const file = { name: f.name, bytes, size: bytes.length, pageCount: 0, pages: [], thumb: null, password: undefined, kind: "pdf", ext };
    const kinds = tool.kinds || ["pdf"];
    const isImage = /^image\//.test(f.type) || IMAGE_EXT.test(ext);
    const pdf = isPdf(file);
    const acceptsExt = kinds.includes("any") || kinds.includes(ext);

    if (pdf && kinds.includes("pdf")) {
      // fall through to the PDF path below
    } else if (isImage && kinds.includes("image")) {
      file.kind = "image";
      file.pageCount = 1;
      file.pages = defaultPages(1);
      file.thumb = await render.imagePreview(bytes);
      if (!file.thumb) throw new ToolError(`${f.name} could not be opened by your browser.`);
      return file;
    } else if (acceptsExt) {
      file.kind = ext || "file";
      return file;
    } else {
      const want = kinds.includes("pdf") ? "a PDF" : kinds.includes("image") ? "an image" : kinds.map((k) => `.${k}`).join(", ");
      throw new ToolError(`${f.name} is not ${want}.`);
    }

    if (bytes.length > WARN_BYTES) toast(`${f.name} is ${formatBytes(bytes.length)}. Large files can be slow in the browser.`);
    // locked?
    for (;;) {
      try {
        const info = await render.inspectPdf(bytes, file.password);
        file.pageCount = info.pageCount;
        break;
      } catch (err) {
        if (!err.needsPassword) throw new ToolError(`${f.name}: ${err.message}`);
        if (tool.allowEncrypted) {
          file.locked = true;
          break; // the tool will ask for the password itself
        }
        const pw = await prompt({ title: "This PDF is locked", label: `Password for ${f.name}`, okLabel: "Open", error: file.password ? "Wrong password, try again." : "" });
        if (pw == null) return null;
        file.password = pw;
      }
    }
    file.pages = defaultPages(file.pageCount);
    if (!file.locked) file.thumb = await render.thumbnail(bytes, 0, { edge: 120, password: file.password }).catch(() => null);
    return file;
  }

  // --- run ----------------------------------------------------------------
  async function run() {
    const v = options.validate();
    if (v) return showError(v);
    if (state.files.length < (tool.minFiles || 1)) return showError(`Add at least ${tool.minFiles || 1} file${(tool.minFiles || 1) > 1 ? "s" : ""}.`);
    state.status = "working";
    state.progress = 0;
    state.error = null;
    paint();
    const ctx = {
      renderPage: render.renderPage,
      resizeJpeg: render.resizeJpeg,
      toPng: render.toPng,
      thumbnail: render.thumbnail,
      extractText: render.extractText,
      pageImages,
      enhanceImage: render.enhanceImage,
      exact: () => import("../exact.js"), // exact-layout Office rendering, loaded on demand
      inspectPdf: render.inspectPdf,
      onProgress: (p) => {
        state.progress = p;
        const bar = root.querySelector(".bar i");
        if (bar) bar.style.width = `${Math.round(p * 100)}%`;
      },
    };
    try {
      const files = state.files.map((f) => ({ ...f, pages: f.pages.map((p) => ({ ...p })) }));
      const extra = custom?.collect ? await custom.collect() : {};
      state.result = await tool.run(files, { ...options.values(), ...extra }, ctx);
      state.status = "done";
    } catch (err) {
      if (!(err instanceof ToolError)) console.error(err);
      state.status = "loaded";
      state.error = err instanceof ToolError ? err.message : "Something went wrong with this file. Try again or try another file.";
    }
    paint();
  }

  function showError(msg) {
    state.error = msg;
    paint();
    root.querySelector(".alert.error")?.scrollIntoView({ block: "nearest" });
  }

  function reset() {
    custom?.destroy?.();
    custom = null;
    state.files.forEach((x) => render.forget(x.bytes));
    state.files = [];
    state.result = null;
    state.error = null;
    state.status = "idle";
    options = optionsForm(tool.options || []);
    paint();
  }

  function continueWith(otherId) {
    const r = state.result;
    history.pushState({}, "", `tool.html?tool=${otherId}`);
    mountTool(root, otherId, [new File([r.bytes], r.name, { type: r.mime })]);
  }

  // --- paint --------------------------------------------------------------
  function head() {
    return h(
      "header",
      { class: "tool-head wrap", style: `--cat:${cat.color}` },
      h("div", { class: "ic", html: icons[tool.icon] }),
      h("h1", {}, tool.name),
      h("p", {}, tool.tagline)
    );
  }

  function zone(compact = false) {
    const kinds = tool.kinds || ["pdf"];
    const what = kinds.includes("pdf") ? (single ? "a PDF" : "PDFs") : kinds.includes("image") ? "images" : tool.dropLabel || `a ${kinds.filter((k) => k !== "any").map((k) => k.toUpperCase()).join(" / ") || "file"} file`;
    return dropzone({
      accept: tool.accept,
      multiple: !single,
      capture: tool.capture,
      compact,
      label: compact ? "Add more files" : `Drop ${what} here`,
      hint: "or click to choose. Nothing is uploaded; it all runs on your device.",
      onFiles: addFiles,
    });
  }

  // What a custom tool UI gets to work with.
  const api = {
    render,
    h,
    toast,
    download,
    formatBytes,
    prompt,
    icons,
    setError: showError,
    setResult(result) {
      state.result = result;
      state.status = "done";
      paint();
    },
    reset,
    get files() {
      return state.files;
    },
    get options() {
      return options.values();
    },
    run,
  };

  function main() {
    if (tool.mode === "custom") {
      custom?.destroy?.();
      const container = h("div", { class: "panel custom" });
      custom = tool.ui({ file: state.files[0], files: state.files, container, api }) || null;
      return container;
    }
    if (tool.mode === "files") {
      const list = fileList(state.files, {
        onChange: () => list.render(),
        onRemove: (i) => {
          render.forget(state.files[i].bytes);
          state.files.splice(i, 1);
          state.files.length ? list.render() : reset();
        },
      });
      return h("div", { class: "panel" }, h("div", { class: "toolbar" }, h("span", { class: "count" }, `${state.files.length} file${state.files.length === 1 ? "" : "s"} · drag to reorder`)), list.el, h("div", { style: "margin-top:14px" }, zone(true)));
    }
    const file = state.files[0];
    if (tool.mode === "pages") {
      const grid = pageGrid(file, {
        selectable: true,
        removable: tool.id === "organize-pdf" || tool.id === "rotate-pdf",
        loadThumb: (i) => render.thumbnail(file.bytes, i, { edge: 220, password: file.password }),
        onChange: () => {
          grid.render();
          count.textContent = counter();
          // Clicking pages on Split means "only these pages"; switch the mode for them.
          if (tool.id === "split-pdf" && file.pages.some((p) => p.selected) && options.values().mode !== "extract") options.set("mode", "extract");
        },
      });
      const counter = () => {
        const sel = file.pages.filter((p) => p.selected).length;
        return `${file.pages.length} page${file.pages.length === 1 ? "" : "s"}${sel ? ` · ${sel} selected` : ""}`;
      };
      const count = h("span", { class: "count" }, counter());
      const all = (v) => (file.pages.forEach((p) => (p.selected = v)), grid.render(), (count.textContent = counter()));
      const rotAll = (d) => (file.pages.forEach((p) => (p.rotation = (((p.rotation + d) % 360) + 360) % 360)), grid.render());
      return h(
        "div",
        { class: "panel" },
        h(
          "div",
          { class: "toolbar" },
          count,
          h("span", { class: "spacer" }),
          h("button", { class: "btn secondary", style: "padding:8px 12px;font-size:14px", onclick: () => all(true) }, "Select all"),
          h("button", { class: "btn secondary", style: "padding:8px 12px;font-size:14px", onclick: () => all(false) }, "Clear"),
          h("button", { class: "iconbtn", title: "Rotate all left", "aria-label": "Rotate all pages left", html: icons.rotl, onclick: () => rotAll(-90) }),
          h("button", { class: "iconbtn", title: "Rotate all right", "aria-label": "Rotate all pages right", html: icons.rotr, onclick: () => rotAll(90) })
        ),
        tool.selectLabel && h("p", { class: "muted", style: "font-size:14px" }, tool.selectLabel),
        grid.el
      );
    }
    // single
    return h(
      "div",
      { class: "panel" },
      h(
        "div",
        { class: "file" },
        h("img", { class: "thumb", src: file.thumb || "", alt: "" }),
        h("div", { class: "meta" }, h("b", {}, file.name), h("span", {}, [file.pageCount ? `${file.pageCount} page${file.pageCount === 1 ? "" : "s"} · ` : file.locked ? "locked · " : file.kind !== "pdf" ? `${file.kind.toUpperCase()} · ` : "", formatBytes(file.size)].join(""))),
        h("button", { class: "iconbtn danger", title: "Remove", "aria-label": "Remove file", html: icons.x, onclick: reset })
      ),
      h("div", { style: "margin-top:14px" }, zone(true))
    );
  }

  function side() {
    return h(
      "aside",
      { class: "side" },
      h("div", { class: "panel" }, h("h3", {}, "Options"), (tool.options || []).length ? options.el : h("p", { class: "muted", style: "font-size:14px" }, tool.noRun ? "Everything happens in the workspace on the left." : "No options. Just go."), state.error && h("div", { class: "alert error", role: "alert" }, state.error), !tool.noRun && h("button", { class: "btn lg block", id: "run", style: "margin-top:8px", onclick: run }, tool.action)),
      h("div", { class: "alert info", html: `${icons.shield} <span>Processed on your device. Nothing is uploaded.</span>`, style: "display:flex;gap:8px;align-items:center" }),
      h("button", { class: "btn ghost block", onclick: reset }, "Start over")
    );
  }

  function progress() {
    return h("div", { class: "panel progress" }, h("div", { class: "spinner" }), h("div", { style: "font-weight:600" }, `${tool.action}…`), h("div", { class: "muted", style: "font-size:14px" }, "Working in your browser"), h("div", { class: "bar" }, h("i", { style: `width:${Math.round(state.progress * 100)}%` })));
  }

  function resultCard() {
    const r = state.result;
    const saved = r.sizeBefore ? 1 - r.sizeAfter / r.sizeBefore : 0;
    const sizeText =
      tool.id === "compress-pdf"
        ? r.stats?.unchanged
          ? `${formatBytes(r.sizeBefore)} · already as small as this method gets`
          : `${formatBytes(r.sizeBefore)} → ${formatBytes(r.sizeAfter)} `
        : formatBytes(r.sizeAfter) + (r.pageCount ? ` · ${r.pageCount} page${r.pageCount === 1 ? "" : "s"}` : "");
    const next = TOOLS.filter((t) => t.id !== tool.id && !t.hidden && ((r.kind === "pdf" && (t.kinds || []).includes("pdf") && t.mode !== "files") || (r.kind === "image" && (t.kinds || []).includes("image"))));
    return h(
      "div",
      { class: "panel result" },
      h("div", { class: "ok", html: icons.check }),
      h("div", { class: "fname", id: "result-name" }, r.name),
      h("div", { class: "sizes", id: "result-size" }, sizeText, tool.id === "compress-pdf" && !r.stats?.unchanged && saved > 0 && h("b", {}, `−${Math.round(saved * 100)}%`)),
      r.stats?.fallbackFrom && h("div", { class: "alert info", style: "display:inline-block;margin:0 0 16px;font-size:13px" }, "The layout engine could not read this file, so it was converted as text instead."),
      h(
        "div",
        { class: "actions" },
        h("button", { class: "btn lg", id: "download", html: `${icons.download}<span>Download</span>`, onclick: () => download(r.bytes, r.name, r.mime) }),
        h("button", { class: "btn secondary lg", onclick: reset }, "Start over")
      ),
      r.files && h("ul", { class: "zip-list" }, r.files.slice(0, 12).map((f) => h("li", {}, h("span", {}, f.name), h("span", {}, formatBytes(f.size)))), r.files.length > 12 && h("li", {}, `… and ${r.files.length - 12} more`)),
      next.length ? h("div", { class: "continue" }, h("div", { class: "muted", style: "font-size:14px" }, "Continue with this file"), h("div", { class: "chips" }, next.slice(0, 7).map((t) => h("button", { class: "chip", html: `${icons[t.icon]}<span>${t.name}</span>`, onclick: () => continueWith(t.id) })))) : null
    );
  }

  function paint() {
    let body;
    if (tool.hub && state.status === "idle") body = h("div", { class: "wrap" }, h("div", { class: "grid" }, tool.hub.map((id) => byId[id]).filter(Boolean).map(toolCard)), h("p", { class: "muted", style: "margin-top:16px;text-align:center;font-size:14px" }, "Or drop a PDF here to start with PDF to Word."), zone(true));
    else if (state.status === "idle") body = h("div", { class: "wrap" }, zone());
    else if (state.status === "working") body = h("div", { class: "wrap" }, progress());
    else if (state.status === "done") body = h("div", { class: "wrap" }, resultCard());
    else if (tool.layout === "full") body = h("div", { class: "wrap work full" }, main(), state.error && h("div", { class: "alert error", role: "alert" }, state.error));
    else body = h("div", { class: "wrap work" }, main(), side());
    root.replaceChildren(head(), body, extras());
  }

  function extras() {
    return h(
      "div",
      { class: "wrap" },
      h("section", { class: "howto section" }, h("h2", {}, `How to ${tool.name.toLowerCase().replace(/ pdf$/, " a PDF")}`), h("div", { class: "steps" }, tool.howto.map((s, i) => h("div", { class: "step" }, h("div", { class: "n" }, String(i + 1)), h("p", {}, s))))),
      tool.faq?.length && h("section", { class: "faq section" }, h("h2", {}, "Questions"), tool.faq.map(([q, a]) => h("details", {}, h("summary", {}, q), h("p", {}, a)))),
      tool.related?.length && h("section", { class: "related section" }, h("h2", {}, "Related tools"), h("div", { class: "grid" }, tool.related.map((id) => byId[id]).filter(Boolean).map(toolCard)))
    );
  }

  paint();
  if (initialFiles.length) addFiles(initialFiles);
  return { addFiles };
}

export function boot() {
  const root = document.getElementById("tool");
  const id = new URLSearchParams(location.search).get("tool") || "merge-pdf";
  const app = mountTool(root, id);
  pageDrop((files) => {
    const current = root.querySelector(".drop");
    if (current) app.addFiles(files);
  });
  window.addEventListener("popstate", () => mountTool(root, new URLSearchParams(location.search).get("tool") || "merge-pdf"));
}
