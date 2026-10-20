// Page-canvas editor UI shared by Edit, Annotate, Sign, Crop and Redact, plus the form filler.
// Items are kept in display points (see src/tools/editor.js). No top-level DOM access so the
// catalog can import this module under Node.
import { pageFrames, listFields } from "../tools/editor.js";

const PRESETS = {
  edit: ["select", "text", "highlight", "rect", "ellipse", "line", "pen", "image", "whiteout"],
  annotate: ["select", "highlight", "underline", "pen", "note", "text", "rect"],
  sign: ["select", "signature", "text"],
  crop: ["crop"],
  redact: ["redact", "select"],
};

const TOOL_META = {
  select: { label: "Select", icon: "cursor", hint: "Click an item to select it. Drag to move, corners to resize. Delete removes it." },
  text: { label: "Text", icon: "font", hint: "Click on the page to add a text box, then type." },
  highlight: { label: "Highlight", icon: "highlight", hint: "Drag over text to highlight it." },
  underline: { label: "Underline", icon: "underline", hint: "Drag a line under the text." },
  rect: { label: "Rectangle", icon: "rect", hint: "Drag to draw a rectangle." },
  ellipse: { label: "Ellipse", icon: "ellipse", hint: "Drag to draw an ellipse." },
  line: { label: "Line", icon: "line", hint: "Drag to draw a line." },
  pen: { label: "Pen", icon: "pen", hint: "Draw freehand." },
  image: { label: "Image", icon: "image", hint: "Pick a PNG or JPEG to place on the page." },
  whiteout: { label: "White-out", icon: "whiteout", hint: "Drag to cover something with white." },
  note: { label: "Note", icon: "note", hint: "Click to add a sticky note." },
  signature: { label: "Place signature", icon: "sign", hint: "Click on the page to place your signature." },
  crop: { label: "Crop", icon: "crop", hint: "Drag the area to keep. Drag the box or its corners to adjust." },
  redact: { label: "Redact", icon: "redact", hint: "Drag boxes over anything to remove. Applying turns those pages into images with the boxes burned in." },
};

const ICONS = {
  cursor: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M5 3l14 8-6 2-3 6z"/></svg>',
  font: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 20L11 4h2l6 16M8 14h8"/></svg>',
  highlight: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 18h16"/><path d="M8 14l8-8 2 2-8 8H8z" fill="currentColor" fill-opacity=".3"/></svg>',
  underline: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M7 4v7a5 5 0 0 0 10 0V4M5 20h14"/></svg>',
  rect: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="5" width="16" height="14" rx="1"/></svg>',
  ellipse: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><ellipse cx="12" cy="12" rx="8" ry="6"/></svg>',
  line: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 19L19 5"/></svg>',
  pen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 20c3-8 6-10 9-7s6 1 7-5"/></svg>',
  image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M21 16l-5-5-8 8"/></svg>',
  whiteout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="5" width="16" height="14" rx="1" stroke-dasharray="3 2"/><path d="M8 12h8"/></svg>',
  note: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M4 4h16v11l-5 5H4z"/><path d="M15 20v-5h5"/></svg>',
  sign: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 17c3-6 5-6 6-2s3 2 5-3 3-2 7 2"/><path d="M3 21h18"/></svg>',
  crop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M2 6h14a2 2 0 0 1 2 2v14"/></svg>',
  redact: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 5h16v14H4z"/><path d="M7 9h10v6H7z" fill="currentColor"/></svg>',
  undo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-1"/></svg>',
  redo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h1"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  zoomIn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.5-4.5M11 8v6M8 11h6"/></svg>',
  zoomOut: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.5-4.5M8 11h6"/></svg>',
  left: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M15 5l-7 7 7 7"/></svg>',
  right: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M9 5l7 7-7 7"/></svg>',
};

let seq = 1;
const uid = () => `it${seq++}_${Date.now().toString(36)}`;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const todayISO = () => new Date().toISOString().slice(0, 10);

/** Paint opaque black boxes into a JPEG (pixel coordinates). Used by Redact so the pixels underneath are gone. */
export async function paintBoxes(jpgBytes, boxes) {
  const bmp = await createImageBitmap(new Blob([jpgBytes], { type: "image/jpeg" }));
  const canvas = document.createElement("canvas");
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const g = canvas.getContext("2d");
  g.drawImage(bmp, 0, 0);
  bmp.close();
  g.fillStyle = "#000";
  for (const b of boxes) g.fillRect(Math.floor(b.x), Math.floor(b.y), Math.ceil(b.w), Math.ceil(b.h));
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? blob.arrayBuffer().then((buf) => resolve(new Uint8Array(buf))) : reject(new Error("encode failed"))), "image/jpeg", 0.92));
}

function trimCanvas(canvas) {
  const g = canvas.getContext("2d");
  const { width, height } = canvas;
  const d = g.getImageData(0, 0, width, height).data;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (d[(y * width + x) * 4 + 3] > 10) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
  if (maxX < 0) return null;
  const pad = 6;
  const out = document.createElement("canvas");
  out.width = maxX - minX + 1 + pad * 2;
  out.height = maxY - minY + 1 + pad * 2;
  out.getContext("2d").drawImage(canvas, minX - pad, minY - pad, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

const pngOf = (canvas) => new Promise((resolve) => canvas.toBlob((b) => b.arrayBuffer().then((buf) => resolve(new Uint8Array(buf))), "image/png"));

/** Signature dialog: draw, type or upload. Resolves { bytes, w, h } (PNG) or null. */
export function signatureDialog(api) {
  const { h } = api;
  return new Promise((resolve) => {
    let tab = "draw";
    let color = "#1b1f2a";
    const close = (v) => {
      bg.remove();
      resolve(v);
    };
    const body = h("div", { class: "sig-body" });
    const tabs = h(
      "div",
      { class: "sig-tabs", role: "tablist" },
      ["draw", "type", "upload"].map((t) => h("button", { type: "button", class: "sig-tab", role: "tab", dataset: { tab: t }, "aria-selected": String(t === tab), onclick: () => ((tab = t), render()) }, t[0].toUpperCase() + t.slice(1)))
    );
    const colors = h(
      "div",
      { class: "sig-colors" },
      [["#1b1f2a", "Black"], ["#1f3fbf", "Blue"]].map(([c, label]) => h("button", { type: "button", class: "sig-color", title: label, "aria-label": label, style: `background:${c}`, onclick: () => ((color = c), render()) }))
    );
    const err = h("div", { class: "hintline", style: "color:var(--danger)" });
    let getResult = async () => null;

    function render() {
      tabs.querySelectorAll(".sig-tab").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === tab)));
      body.replaceChildren();
      err.textContent = "";
      if (tab === "draw") {
        const canvas = h("canvas", { class: "sig-canvas", width: 600, height: 220, "aria-label": "Draw your signature" });
        const g = canvas.getContext("2d");
        g.lineWidth = 3.2;
        g.lineCap = "round";
        g.lineJoin = "round";
        g.strokeStyle = color;
        let drawing = false;
        let last = null;
        const pos = (e) => {
          const r = canvas.getBoundingClientRect();
          return [((e.clientX - r.left) / r.width) * canvas.width, ((e.clientY - r.top) / r.height) * canvas.height];
        };
        canvas.addEventListener("pointerdown", (e) => {
          drawing = true;
          canvas.setPointerCapture(e.pointerId);
          last = pos(e);
          g.beginPath();
          g.moveTo(last[0], last[1]);
          g.lineTo(last[0] + 0.1, last[1]);
          g.stroke();
        });
        canvas.addEventListener("pointermove", (e) => {
          if (!drawing) return;
          const p = pos(e);
          g.beginPath();
          g.moveTo(last[0], last[1]);
          g.lineTo(p[0], p[1]);
          g.stroke();
          last = p;
        });
        const stop = () => (drawing = false);
        canvas.addEventListener("pointerup", stop);
        canvas.addEventListener("pointercancel", stop);
        body.append(canvas, h("div", { class: "sig-row" }, colors, h("button", { type: "button", class: "btn secondary", onclick: () => g.clearRect(0, 0, canvas.width, canvas.height) }, "Clear")));
        getResult = async () => {
          const t = trimCanvas(canvas);
          if (!t) return null;
          return { bytes: await pngOf(t), w: t.width, h: t.height };
        };
      } else if (tab === "type") {
        const input = h("input", { type: "text", class: "sig-input", placeholder: "Type your name", "aria-label": "Type your name", autocomplete: "name" });
        let font = "cursive";
        const preview = h("canvas", { class: "sig-canvas", width: 600, height: 160 });
        const fonts = [["cursive", "Script"], ["italic 500 'Georgia', serif", "Serif"], ["700 'Inter', system-ui, sans-serif", "Bold"]];
        const draw = () => {
          const g = preview.getContext("2d");
          g.clearRect(0, 0, preview.width, preview.height);
          g.fillStyle = color;
          g.font = `${font.includes(" ") ? font.replace(/^(italic |700 )?/, "$1") : ""}`.trim();
          g.font = (font === "cursive" ? "italic 64px cursive" : font.startsWith("italic") ? "italic 500 60px Georgia, serif" : "700 58px Inter, system-ui, sans-serif");
          g.textBaseline = "middle";
          g.fillText(input.value || "Your name", 24, preview.height / 2);
        };
        input.addEventListener("input", draw);
        const choices = h(
          "div",
          { class: "sig-row" },
          fonts.map(([f, label]) => h("button", { type: "button", class: "chip", onclick: () => ((font = f), draw()) }, label)),
          colors
        );
        body.append(input, preview, choices);
        draw();
        getResult = async () => {
          if (!input.value.trim()) return null;
          const t = trimCanvas(preview);
          return t ? { bytes: await pngOf(t), w: t.width, h: t.height } : null;
        };
      } else {
        let picked = null;
        const img = h("img", { class: "sig-preview", alt: "", hidden: true });
        const file = h("input", {
          type: "file",
          accept: "image/*",
          onchange: async () => {
            const f = file.files[0];
            if (!f) return;
            let bytes = new Uint8Array(await f.arrayBuffer());
            const isPng = bytes[0] === 0x89 && bytes[1] === 0x50;
            const isJpg = bytes[0] === 0xff && bytes[1] === 0xd8;
            if (!isPng && !isJpg) bytes = await api.render.toPng(bytes, f.name);
            const bmp = await createImageBitmap(new Blob([bytes])).catch(() => null);
            if (!bmp) return (err.textContent = "That image could not be opened.");
            picked = { bytes, w: bmp.width, h: bmp.height };
            bmp.close();
            img.src = URL.createObjectURL(new Blob([bytes]));
            img.hidden = false;
          },
        });
        body.append(h("p", { class: "muted", style: "font-size:14px" }, "A photo or scan of your signature. PNG with a transparent background works best."), file, img);
        getResult = async () => picked;
      }
    }
    render();
    const bg = h(
      "div",
      { class: "modal-bg", onclick: (e) => e.target === bg && close(null) },
      h(
        "div",
        { class: "modal sig-modal", role: "dialog", "aria-label": "Create signature" },
        h("h3", {}, "Create your signature"),
        tabs,
        body,
        err,
        h(
          "div",
          { class: "row" },
          h("button", { type: "button", class: "btn secondary", onclick: () => close(null) }, "Cancel"),
          h(
            "button",
            {
              type: "button",
              class: "btn",
              id: "sig-use",
              onclick: async () => {
                const r = await getResult();
                if (!r) return (err.textContent = "Draw, type or upload a signature first.");
                close(r);
              },
            },
            "Use signature"
          )
        )
      )
    );
    document.body.append(bg);
  });
}

/**
 * The editor. preset: "edit" | "annotate" | "sign" | "crop" | "redact".
 * Returns { collect(), destroy() } for the tool page.
 */
export function editorUI({ file, container, api, preset = "edit" }) {
  const { h, toast } = api;
  const dpr = Math.min(2.5, window.devicePixelRatio || 1);
  const st = {
    frames: [],
    cur: 0,
    scale: 1,
    items: [],
    selected: null,
    tool: PRESETS[preset][preset === "redact" ? 0 : preset === "crop" ? 0 : 0],
    undo: [],
    redo: [],
    defaults: { color: preset === "annotate" ? "#c62828" : "#1f5eff", fill: "none", stroke: 2, size: 14, opacity: 1 },
    signature: null,
    urls: new Map(),
    destroyed: false,
  };
  if (preset === "edit") st.tool = "text";
  if (preset === "annotate") st.tool = "highlight";
  if (preset === "sign") st.tool = "signature";

  // ---- DOM ---------------------------------------------------------------
  const stage = h("div", { class: "ed-stage", tabindex: 0, "aria-label": "Page" });
  const pageImg = h("img", { class: "ed-page", alt: "", draggable: false });
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "ed-svg");
  const html = h("div", { class: "ed-html" });
  stage.append(pageImg, svg, html);
  const stageWrap = h("div", { class: "ed-stage-wrap" }, stage);
  const strip = h("div", { class: "ed-strip", role: "list", "aria-label": "Pages" });
  const status = h("div", { class: "ed-status" });
  const hint = h("span", { class: "ed-hint" });
  const pageLabel = h("input", { type: "number", class: "ed-pageno", min: 1, value: 1, "aria-label": "Page number", onchange: () => goto(Number(pageLabel.value) - 1) });
  const pageTotal = h("span", { class: "ed-pagetotal" });
  const btn = (icon, title, onclick, extra = {}) => h("button", { type: "button", class: "ed-btn", title, "aria-label": title, html: ICONS[icon] || "", onclick, ...extra });

  const toolButtons = PRESETS[preset].map((t) =>
    h("button", { type: "button", class: "ed-tool", dataset: { tool: t }, title: TOOL_META[t].label, "aria-label": TOOL_META[t].label, "aria-pressed": "false", html: `${ICONS[TOOL_META[t].icon] || ""}<span>${TOOL_META[t].label}</span>`, onclick: () => setTool(t) })
  );

  const props = {
    color: h("input", { type: "color", class: "ed-color", title: "Colour", "aria-label": "Colour", value: st.defaults.color, oninput: (e) => applyProp("color", e.target.value) }),
    fill: h("input", { type: "color", class: "ed-color", title: "Fill", "aria-label": "Fill colour", value: "#ffffff", oninput: (e) => applyProp("fill", e.target.value) }),
    noFill: h("label", { class: "ed-check" }, h("input", { type: "checkbox", checked: true, onchange: (e) => applyProp("fill", e.target.checked ? "none" : props.fill.value) }), "No fill"),
    stroke: h("input", { type: "number", class: "ed-num", min: 0.5, max: 30, step: 0.5, value: st.defaults.stroke, title: "Line width", "aria-label": "Line width", oninput: (e) => applyProp("stroke", Number(e.target.value)) }),
    size: h("input", { type: "number", class: "ed-num", min: 6, max: 120, value: st.defaults.size, title: "Font size", "aria-label": "Font size", oninput: (e) => applyProp("size", Number(e.target.value)) }),
    opacity: h("input", { type: "range", class: "ed-range", min: 0.1, max: 1, step: 0.05, value: 1, title: "Opacity", "aria-label": "Opacity", oninput: (e) => applyProp("opacity", Number(e.target.value)) }),
  };
  const propBar = h("div", { class: "ed-props" }, h("span", { class: "ed-lbl" }, "Colour"), props.color, h("span", { class: "ed-lbl ed-p-fill" }, "Fill"), h("span", { class: "ed-p-fill" }, props.fill, props.noFill), h("span", { class: "ed-lbl ed-p-stroke" }, "Width"), props.stroke, h("span", { class: "ed-lbl ed-p-size" }, "Size"), props.size, h("span", { class: "ed-lbl" }, "Opacity"), props.opacity);

  const signBar =
    preset === "sign" &&
    h(
      "div",
      { class: "ed-signbar" },
      h("button", { type: "button", class: "btn secondary", id: "sig-create", onclick: () => createSignature() }, "Create signature"),
      h("button", { type: "button", class: "btn secondary", id: "sig-date", onclick: () => addQuickText(todayISO()) }, "Add date"),
      h("button", { type: "button", class: "btn secondary", id: "sig-initials", onclick: async () => addQuickText((await api.prompt({ title: "Initials", label: "Your initials", type: "text", okLabel: "Add" })) || "") }, "Add initials")
    );

  const toolbar = h(
    "div",
    { class: "ed-toolbar" },
    h("div", { class: "ed-tools" }, toolButtons),
    h("span", { class: "ed-sep" }),
    btn("undo", "Undo (Ctrl+Z)", () => undo(), { id: "ed-undo" }),
    btn("redo", "Redo (Ctrl+Y)", () => redo(), { id: "ed-redo" }),
    btn("trash", "Delete selected", () => deleteSelected(), { id: "ed-delete" }),
    h("span", { class: "ed-sep" }),
    btn("zoomOut", "Zoom out", () => setScale(st.scale / 1.25)),
    h("button", { type: "button", class: "ed-btn ed-zoom", title: "Fit width", onclick: () => fit() }, "Fit"),
    btn("zoomIn", "Zoom in", () => setScale(st.scale * 1.25)),
    h("span", { class: "ed-sep" }),
    btn("left", "Previous page", () => goto(st.cur - 1)),
    h("span", { class: "ed-pages" }, pageLabel, h("span", {}, " / "), pageTotal),
    btn("right", "Next page", () => goto(st.cur + 1))
  );

  container.append(toolbar, propBar, signBar || "", h("div", { class: "ed-body" }, stageWrap, strip), status);
  status.append(hint);

  // ---- helpers -----------------------------------------------------------
  const frame = () => st.frames[st.cur] || { W: 612, H: 792 };
  const toPt = (e) => {
    const r = stage.getBoundingClientRect();
    return [(e.clientX - r.left) / st.scale, (e.clientY - r.top) / st.scale];
  };
  const pageItems = () => st.items.filter((it) => it.page === st.cur);
  const byId = (id) => st.items.find((it) => it.id === id);
  const sel = () => (st.selected ? byId(st.selected) : null);

  function snapshot() {
    st.undo.push(st.items.map((it) => ({ ...it, points: it.points ? it.points.map((p) => [...p]) : undefined })));
    if (st.undo.length > 100) st.undo.shift();
    st.redo = [];
  }
  function undo() {
    if (!st.undo.length) return;
    st.redo.push(st.items);
    st.items = st.undo.pop();
    st.selected = null;
    renderItems();
  }
  function redo() {
    if (!st.redo.length) return;
    st.undo.push(st.items);
    st.items = st.redo.pop();
    st.selected = null;
    renderItems();
  }
  function deleteSelected() {
    const it = sel();
    if (!it) return;
    snapshot();
    st.items = st.items.filter((x) => x.id !== it.id);
    st.selected = null;
    renderItems();
  }
  function setTool(t) {
    st.tool = t;
    toolButtons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tool === t)));
    hint.textContent = TOOL_META[t]?.hint || "";
    stage.dataset.tool = t;
    if (t !== "select") {
      st.selected = null;
      renderItems();
    }
    if (t === "image") pickImage();
    if (t === "signature" && !st.signature) createSignature();
    updateProps();
  }
  function applyProp(key, value) {
    st.defaults[key] = value;
    const it = sel();
    if (it) {
      snapshot();
      if (key === "color" && (it.type === "highlight" || it.type === "whiteout" || it.type === "redact")) return;
      it[key] = value;
      renderItems();
    }
  }
  function updateProps() {
    const it = sel();
    const type = it?.type || { text: "text", note: "text", rect: "rect", ellipse: "rect", line: "line", underline: "line", pen: "path", signature: "image" }[st.tool] || st.tool;
    propBar.hidden = preset === "crop" || preset === "redact";
    const showFill = ["rect", "ellipse", "note"].includes(type);
    const showStroke = ["rect", "ellipse", "line", "path"].includes(type);
    const showSize = ["text", "note"].includes(type);
    propBar.querySelectorAll(".ed-p-fill").forEach((el) => (el.hidden = !showFill));
    propBar.querySelectorAll(".ed-p-stroke").forEach((el) => (el.hidden = !showStroke));
    props.stroke.hidden = !showStroke;
    propBar.querySelectorAll(".ed-p-size").forEach((el) => (el.hidden = !showSize));
    props.size.hidden = !showSize;
    if (it) {
      if (it.color && it.color !== "none") props.color.value = it.color;
      if (it.fill && it.fill !== "none") props.fill.value = it.fill;
      props.noFill.querySelector("input").checked = !it.fill || it.fill === "none";
      if (it.stroke) props.stroke.value = it.stroke;
      if (it.size) props.size.value = it.size;
      props.opacity.value = it.opacity ?? 1;
    }
  }

  // ---- rendering ---------------------------------------------------------
  async function renderPage() {
    const f = frame();
    stage.style.width = `${f.W * st.scale}px`;
    stage.style.height = `${f.H * st.scale}px`;
    svg.setAttribute("viewBox", `0 0 ${f.W} ${f.H}`);
    svg.setAttribute("width", f.W * st.scale);
    svg.setAttribute("height", f.H * st.scale);
    pageLabel.value = st.cur + 1;
    pageTotal.textContent = String(st.frames.length);
    const renderScale = Math.min(3, st.scale * dpr);
    const key = `${st.cur}:${renderScale.toFixed(2)}`;
    let url = st.urls.get(key);
    if (!url) {
      const bytes = await api.render.renderPage(file.bytes, st.cur, { scale: renderScale, format: "png", password: file.password });
      if (st.destroyed) return;
      url = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
      st.urls.set(key, url);
      if (st.urls.size > 12) {
        const first = st.urls.keys().next().value;
        URL.revokeObjectURL(st.urls.get(first));
        st.urls.delete(first);
      }
    }
    pageImg.src = url;
    renderItems();
    strip.querySelectorAll(".ed-thumb").forEach((t, i) => t.classList.toggle("current", i === st.cur));
  }

  function blobUrlFor(it) {
    if (!it._url) it._url = URL.createObjectURL(new Blob([it.imageBytes]));
    return it._url;
  }

  function renderItems() {
    const f = frame();
    const NS = "http://www.w3.org/2000/svg";
    const el = (tag, attrs) => {
      const e = document.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v);
      return e;
    };
    svg.replaceChildren();
    html.replaceChildren();
    for (const it of pageItems()) {
      const common = { "data-id": it.id, class: `ed-item ed-${it.type}${it.id === st.selected ? " selected" : ""}` };
      let node = null;
      switch (it.type) {
        case "rect":
          node = el("rect", { ...common, x: it.x, y: it.y, width: it.w, height: it.h, fill: it.fill && it.fill !== "none" ? it.fill : "none", stroke: it.color !== "none" ? it.color : "none", "stroke-width": it.stroke, opacity: it.opacity ?? 1 });
          break;
        case "ellipse":
          node = el("ellipse", { ...common, cx: it.x + it.w / 2, cy: it.y + it.h / 2, rx: it.w / 2, ry: it.h / 2, fill: it.fill && it.fill !== "none" ? it.fill : "none", stroke: it.color !== "none" ? it.color : "none", "stroke-width": it.stroke, opacity: it.opacity ?? 1 });
          break;
        case "highlight":
          node = el("rect", { ...common, x: it.x, y: it.y, width: it.w, height: it.h, fill: it.color || "#ffeb3b", opacity: it.opacity ?? 0.4 });
          break;
        case "whiteout":
          node = el("rect", { ...common, x: it.x, y: it.y, width: it.w, height: it.h, fill: "#fff", stroke: "#bbb", "stroke-dasharray": "3 2", "stroke-width": 0.8 });
          break;
        case "redact":
          node = el("rect", { ...common, x: it.x, y: it.y, width: it.w, height: it.h, fill: "#000", opacity: 0.85 });
          break;
        case "crop": {
          const mask = el("path", { class: "ed-cropmask", d: `M0 0H${f.W}V${f.H}H0Z M${it.x} ${it.y}H${it.x + it.w}V${it.y + it.h}H${it.x}Z`, "fill-rule": "evenodd", fill: "rgba(0,0,0,.45)" });
          svg.append(mask);
          node = el("rect", { ...common, x: it.x, y: it.y, width: it.w, height: it.h, fill: "none", stroke: "#1f5eff", "stroke-width": 1.5, "stroke-dasharray": "6 4" });
          break;
        }
        case "line":
          node = el("line", { ...common, x1: it.x, y1: it.y, x2: it.x + it.w, y2: it.y + it.h, stroke: it.color, "stroke-width": it.stroke, "stroke-linecap": "round", opacity: it.opacity ?? 1 });
          break;
        case "path":
          node = el("polyline", { ...common, points: it.points.map((p) => p.join(",")).join(" "), fill: "none", stroke: it.color, "stroke-width": it.stroke, "stroke-linecap": "round", "stroke-linejoin": "round", opacity: it.opacity ?? 1 });
          break;
        case "image":
        case "signature":
          node = el("image", { ...common, href: blobUrlFor(it), x: it.x, y: it.y, width: it.w, height: it.h, preserveAspectRatio: "none", opacity: it.opacity ?? 1 });
          break;
        case "text":
        case "note": {
          const div = h("div", {
            class: `ed-text${it.type === "note" ? " ed-note" : ""}${it.id === st.selected ? " selected" : ""}`,
            dataset: { id: it.id },
            contenteditable: "true",
            spellcheck: "false",
            style: `left:${it.x * st.scale}px;top:${it.y * st.scale}px;width:${it.w * st.scale}px;min-height:${Math.max(it.size * 1.25, it.h) * st.scale}px;font-size:${it.size * st.scale}px;color:${it.color};opacity:${it.opacity ?? 1};${it.type === "note" ? `background:${it.background || "#fff59d"};` : ""}padding:${(it.type === "note" ? 4 : 0) * st.scale}px`,
            oninput: (e) => {
              it.text = e.target.innerText.replace(/\n$/, "");
              it.h = e.target.offsetHeight / st.scale;
              const box = html.querySelector(".ed-selbox");
              if (box) box.style.height = `${it.h * st.scale}px`;
            },
            onfocus: () => {
              if (st.selected !== it.id) select(it.id, false);
            },
          });
          div.innerText = it.text || "";
          html.append(div);
          break;
        }
        default:
          break;
      }
      if (node) svg.append(node);
    }
    // selection box + handles
    const it = sel();
    if (it && it.type !== "crop") {
      const b = bounds(it);
      const box = h("div", { class: "ed-selbox", style: `left:${b.x * st.scale}px;top:${b.y * st.scale}px;width:${b.w * st.scale}px;height:${b.h * st.scale}px` });
      if (it.type === "text" || it.type === "note") box.append(h("div", { class: "ed-grip", dataset: { grip: "move" }, title: "Drag to move" }));
      if (it.type !== "path") for (const d of ["nw", "ne", "sw", "se"]) box.append(h("div", { class: `ed-handle ${d}`, dataset: { dir: d } }));
      html.append(box);
    }
    if (preset === "crop") {
      const c = st.items.find((x) => x.type === "crop" && x.page === st.cur);
      if (c) {
        const box = h("div", { class: "ed-selbox crop", style: `left:${c.x * st.scale}px;top:${c.y * st.scale}px;width:${c.w * st.scale}px;height:${c.h * st.scale}px` });
        for (const d of ["nw", "ne", "sw", "se"]) box.append(h("div", { class: `ed-handle ${d}`, dataset: { dir: d, crop: "1" } }));
        html.append(box);
        const mm = (v) => (v * 25.4) / 72;
        status.querySelector(".ed-cropsize")?.remove();
        status.append(h("span", { class: "ed-cropsize" }, `Crop: ${Math.round(c.w)} × ${Math.round(c.h)} pt · ${mm(c.w).toFixed(0)} × ${mm(c.h).toFixed(0)} mm · ${(c.w / 72).toFixed(2)} × ${(c.h / 72).toFixed(2)} in`));
      } else status.querySelector(".ed-cropsize")?.remove();
    }
    updateProps();
  }

  function bounds(it) {
    if (it.type === "path") {
      const xs = it.points.map((p) => p[0]);
      const ys = it.points.map((p) => p[1]);
      return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    }
    if (it.type === "line") return { x: Math.min(it.x, it.x + it.w), y: Math.min(it.y, it.y + it.h), w: Math.abs(it.w), h: Math.abs(it.h) };
    return { x: it.x, y: it.y, w: it.w, h: it.h };
  }

  function select(id, focusText = false) {
    st.selected = id;
    renderItems();
    if (focusText) {
      const d = html.querySelector(`.ed-text[data-id="${id}"]`);
      if (d) {
        d.focus();
        const range = document.createRange();
        range.selectNodeContents(d);
        range.collapse(false);
        const s = window.getSelection();
        s.removeAllRanges();
        s.addRange(range);
      }
    }
  }

  // ---- pointer interaction --------------------------------------------------
  let drag = null;
  stage.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    const [x, y] = toPt(e);
    const target = e.target;
    const f = frame();
    const handle = target.closest?.(".ed-handle");
    const grip = target.closest?.(".ed-grip");
    const itemEl = target.closest?.("[data-id]");
    const itemId = itemEl?.dataset?.id;
    stage.focus({ preventScroll: true });

    if (handle) {
      const it = handle.dataset.crop ? st.items.find((c) => c.type === "crop" && c.page === st.cur) : sel();
      if (!it) return;
      if (!handle.dataset.crop) snapshot();
      drag = { kind: "resize", it, dir: handle.dataset.dir, start: [x, y], orig: { ...it } };
      stage.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }
    if (preset === "crop") {
      const c = st.items.find((it) => it.type === "crop" && it.page === st.cur);
      if (c && x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h) {
        drag = { kind: "move", it: c, start: [x, y], orig: { ...c } };
      } else {
        st.items = st.items.filter((it) => !(it.type === "crop" && it.page === st.cur));
        const it = { id: uid(), page: st.cur, type: "crop", x, y, w: 0, h: 0 };
        st.items.push(it);
        drag = { kind: "draw", it, start: [x, y] };
      }
      stage.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }
    if (st.tool === "select" || grip || (itemId && st.tool !== "pen")) {
      if (itemId && (st.tool === "select" || grip || itemEl.classList.contains("ed-text"))) {
        const it = byId(itemId);
        if (!it) return;
        if (st.selected !== itemId) select(itemId, false);
        if (itemEl.classList.contains("ed-text") && !grip) return; // let the text box take focus for editing
        snapshot();
        drag = { kind: "move", it, start: [x, y], orig: { ...it, points: it.points?.map((p) => [...p]) } };
        stage.setPointerCapture(e.pointerId);
        e.preventDefault();
        return;
      }
      if (st.tool === "select") {
        st.selected = null;
        renderItems();
        return;
      }
    }
    // creation tools
    if (st.tool === "text" || st.tool === "note") {
      e.preventDefault(); // keep focus on the new text box, not the stage
      snapshot();
      const size = st.defaults.size;
      const it = { id: uid(), page: st.cur, type: st.tool, x: clamp(x, 0, f.W - 40), y: clamp(y, 0, f.H - size * 1.4), w: Math.min(240, f.W - clamp(x, 0, f.W - 40)), h: size * 1.4, text: "", size, color: st.tool === "note" ? "#1b1f2a" : st.defaults.color, opacity: st.defaults.opacity, background: "#fff59d" };
      st.items.push(it);
      setTool("select");
      select(it.id, true);
      return;
    }
    if (st.tool === "signature") {
      if (!st.signature) return createSignature();
      placeSignature(x, y);
      return;
    }
    if (st.tool === "image") return pickImage();
    if (st.tool === "pen") {
      snapshot();
      const it = { id: uid(), page: st.cur, type: "path", points: [[x, y]], color: st.defaults.color, stroke: st.defaults.stroke, opacity: st.defaults.opacity };
      st.items.push(it);
      drag = { kind: "pen", it };
      stage.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }
    const shape = { highlight: "highlight", rect: "rect", ellipse: "ellipse", line: "line", underline: "line", whiteout: "whiteout", redact: "redact" }[st.tool];
    if (shape) {
      snapshot();
      const it = { id: uid(), page: st.cur, type: shape, x, y, w: 0, h: 0, color: st.tool === "underline" ? st.defaults.color : shape === "highlight" ? "#ffeb3b" : st.defaults.color, fill: st.defaults.fill, stroke: st.tool === "underline" ? 1.5 : st.defaults.stroke, opacity: shape === "highlight" ? 0.4 : st.defaults.opacity };
      st.items.push(it);
      drag = { kind: "draw", it, start: [x, y], straight: st.tool === "underline" };
      stage.setPointerCapture(e.pointerId);
      e.preventDefault();
    }
  });

  stage.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const [x, y] = toPt(e);
    const f = frame();
    const it = drag.it;
    if (drag.kind === "pen") {
      const last = it.points[it.points.length - 1];
      if (Math.hypot(x - last[0], y - last[1]) > 1) it.points.push([clamp(x, 0, f.W), clamp(y, 0, f.H)]);
    } else if (drag.kind === "draw") {
      const [sx, sy] = drag.start;
      if (it.type === "line") {
        it.w = x - sx;
        it.h = drag.straight ? 0 : y - sy;
      } else {
        it.x = clamp(Math.min(sx, x), 0, f.W);
        it.y = clamp(Math.min(sy, y), 0, f.H);
        it.w = Math.min(Math.abs(x - sx), f.W - it.x);
        it.h = Math.min(Math.abs(y - sy), f.H - it.y);
      }
    } else if (drag.kind === "move") {
      const dx = x - drag.start[0];
      const dy = y - drag.start[1];
      if (it.type === "path") it.points = drag.orig.points.map((p) => [p[0] + dx, p[1] + dy]);
      else {
        it.x = drag.orig.x + dx;
        it.y = drag.orig.y + dy;
        if (it.type === "crop") {
          it.x = clamp(it.x, 0, f.W - it.w);
          it.y = clamp(it.y, 0, f.H - it.h);
        }
      }
    } else if (drag.kind === "resize") {
      const o = drag.orig;
      const dx = x - drag.start[0];
      const dy = y - drag.start[1];
      const d = drag.dir;
      if (it.type === "line") {
        if (d === "nw" || d === "sw") {
          it.x = o.x + dx;
          it.y = o.y + dy;
          it.w = o.w - dx;
          it.h = o.h - dy;
        } else {
          it.w = o.w + dx;
          it.h = o.h + dy;
        }
      } else {
        let nx = o.x, ny = o.y, nw = o.w, nh = o.h;
        if (d.includes("e")) nw = o.w + dx;
        if (d.includes("s")) nh = o.h + dy;
        if (d.includes("w")) {
          nx = o.x + dx;
          nw = o.w - dx;
        }
        if (d.includes("n")) {
          ny = o.y + dy;
          nh = o.h - dy;
        }
        if (it.type === "image" || it.type === "signature") {
          const ratio = o.w / o.h;
          if (Math.abs(nw / ratio - nh) > 0.5) nh = nw / ratio;
          if (d.includes("n")) ny = o.y + o.h - nh;
        }
        if (nw > 4 && nh > 4) Object.assign(it, { x: nx, y: ny, w: nw, h: nh });
        if (it.type === "crop") {
          it.x = clamp(it.x, 0, f.W);
          it.y = clamp(it.y, 0, f.H);
          it.w = Math.min(it.w, f.W - it.x);
          it.h = Math.min(it.h, f.H - it.y);
        }
      }
    }
    renderItems();
  });

  const endDrag = () => {
    if (!drag) return;
    const it = drag.it;
    if (drag.kind === "draw" && it.type !== "line" && (it.w < 3 || it.h < 3) && it.type !== "crop") st.items = st.items.filter((x) => x !== it);
    else if (drag.kind === "draw" && it.type === "crop" && (it.w < 8 || it.h < 8)) st.items = st.items.filter((x) => x !== it);
    else if (drag.kind === "draw" && it.type === "line" && Math.hypot(it.w, it.h) < 3) st.items = st.items.filter((x) => x !== it);
    else if (drag.kind === "pen" && it.points.length < 2) st.items = st.items.filter((x) => x !== it);
    else if (drag.kind === "draw" && preset !== "crop" && preset !== "redact" && st.tool !== "highlight" && st.tool !== "pen") {
      // one-shot shape tools go back to select so the item can be adjusted
      st.selected = it.id;
      setTool("select");
    }
    drag = null;
    renderItems();
  };
  stage.addEventListener("pointerup", endDrag);
  stage.addEventListener("pointercancel", endDrag);

  stage.addEventListener("keydown", (e) => {
    if (e.target.closest(".ed-text")) {
      if (e.key === "Escape") e.target.blur();
      return;
    }
    if ((e.key === "Delete" || e.key === "Backspace") && st.selected) {
      e.preventDefault();
      deleteSelected();
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      e.shiftKey ? redo() : undo();
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
      e.preventDefault();
      redo();
    }
  });
  html.addEventListener("focusout", () => {
    // drop empty text boxes
    const before = st.items.length;
    st.items = st.items.filter((it) => !((it.type === "text" || it.type === "note") && !String(it.text || "").trim()));
    if (st.items.length !== before) {
      if (sel() == null) st.selected = null;
      renderItems();
    }
  });

  // ---- images / signatures ---------------------------------------------------
  function pickImage() {
    const input = h("input", { type: "file", accept: "image/*", style: "display:none" });
    input.onchange = async () => {
      const f = input.files[0];
      input.remove();
      setTool("select");
      if (!f) return;
      let bytes = new Uint8Array(await f.arrayBuffer());
      const isPng = bytes[0] === 0x89 && bytes[1] === 0x50;
      const isJpg = bytes[0] === 0xff && bytes[1] === 0xd8;
      if (!isPng && !isJpg) bytes = await api.render.toPng(bytes, f.name).catch(() => null);
      if (!bytes) return toast("That image could not be opened.", "error");
      const bmp = await createImageBitmap(new Blob([bytes])).catch(() => null);
      if (!bmp) return toast("That image could not be opened.", "error");
      const fr = frame();
      const w = Math.min(fr.W * 0.5, bmp.width);
      const hgt = (w / bmp.width) * bmp.height;
      bmp.close();
      snapshot();
      const it = { id: uid(), page: st.cur, type: "image", x: (fr.W - w) / 2, y: (fr.H - hgt) / 2, w, h: hgt, imageBytes: bytes, opacity: 1 };
      st.items.push(it);
      select(it.id);
    };
    document.body.append(input);
    input.click();
  }
  async function createSignature() {
    const sig = await signatureDialog(api);
    if (!sig) return;
    st.signature = sig;
    const fr = frame();
    placeSignature(fr.W / 2, fr.H * 0.8);
  }
  function placeSignature(x, y) {
    const fr = frame();
    const w = Math.min(180, fr.W * 0.5);
    const hgt = (w / st.signature.w) * st.signature.h;
    snapshot();
    const it = { id: uid(), page: st.cur, type: "signature", x: clamp(x - w / 2, 0, fr.W - w), y: clamp(y - hgt / 2, 0, fr.H - hgt), w, h: hgt, imageBytes: st.signature.bytes, opacity: 1 };
    st.items.push(it);
    setTool("select");
    select(it.id);
  }
  function addQuickText(text) {
    if (!text) return;
    const fr = frame();
    snapshot();
    const it = { id: uid(), page: st.cur, type: "text", x: fr.W * 0.55, y: fr.H * 0.86, w: 160, h: 18, text, size: 12, color: "#1b1f2a", opacity: 1 };
    st.items.push(it);
    setTool("select");
    select(it.id);
  }

  // ---- pages / zoom ------------------------------------------------------------
  function goto(i) {
    if (!st.frames.length) return;
    st.cur = clamp(i | 0, 0, st.frames.length - 1);
    st.selected = null;
    renderPage();
  }
  function setScale(s) {
    st.scale = clamp(s, 0.25, 4);
    renderPage();
  }
  function fit() {
    const f = frame();
    const avail = Math.max(240, stageWrap.clientWidth - 24);
    setScale(Math.min(1.6, avail / f.W));
  }
  async function buildStrip() {
    strip.replaceChildren(
      ...st.frames.map((f, i) => {
        const img = h("img", { alt: `Page ${i + 1}`, loading: "lazy" });
        api.render.thumbnail(file.bytes, i, { edge: 110, password: file.password }).then((u) => (img.src = u)).catch(() => {});
        return h("button", { type: "button", class: `ed-thumb${i === st.cur ? " current" : ""}`, role: "listitem", "aria-label": `Go to page ${i + 1}`, onclick: () => goto(i) }, img, h("span", {}, String(i + 1)));
      })
    );
  }

  // ---- boot --------------------------------------------------------------------
  (async () => {
    try {
      st.frames = await pageFrames(file);
    } catch (err) {
      api.setError(err.message || "Could not read this PDF.");
      return;
    }
    if (st.destroyed) return;
    buildStrip();
    setTool(st.tool);
    fit();
    if (st.frames.length <= 1) strip.hidden = true;
  })();
  const onResize = () => {};
  window.addEventListener("resize", onResize);

  const serialize = (it) => {
    const { _url, ...rest } = it;
    return rest;
  };

  return {
    collect() {
      if (preset === "crop") {
        const c = st.items.find((it) => it.type === "crop" && it.page === st.cur) || st.items.find((it) => it.type === "crop");
        return { box: c ? { x: c.x, y: c.y, w: c.w, h: c.h } : null, page: c ? c.page : st.cur };
      }
      if (preset === "redact") return { boxes: st.items.filter((it) => it.type === "redact").map(({ page, x, y, w, h }) => ({ page, x, y, w, h })) };
      return { items: st.items.filter((it) => it.type !== "crop").map(serialize) };
    },
    destroy() {
      st.destroyed = true;
      window.removeEventListener("resize", onResize);
      for (const u of st.urls.values()) URL.revokeObjectURL(u);
      for (const it of st.items) if (it._url) URL.revokeObjectURL(it._url);
    },
  };
}

/** Form filler: one input per AcroForm field. collect() -> { values }. */
export function formUI({ file, container, api }) {
  const { h } = api;
  const values = {};
  const list = h("div", { class: "ff-list" }, h("p", { class: "muted", style: "padding:18px" }, "Reading form fields…"));
  container.append(list);
  listFields(file.bytes, { password: file.password })
    .then((fields) => {
      const usable = fields.filter((f) => ["text", "checkbox", "radio", "dropdown", "optionlist"].includes(f.type));
      if (!usable.length) {
        list.replaceChildren(
          h(
            "div",
            { class: "ff-empty" },
            h("h3", {}, "No form fields in this PDF"),
            h("p", { class: "muted" }, "This file has no fillable fields. You can still type on it with Edit PDF, or draw a signature with Sign PDF."),
            h("div", { style: "display:flex;gap:8px;justify-content:center;flex-wrap:wrap" }, h("a", { class: "btn", href: "tool.html?tool=edit-pdf" }, "Open Edit PDF"), h("a", { class: "btn secondary", href: "tool.html?tool=sign-pdf" }, "Open Sign PDF"))
          )
        );
        return;
      }
      list.replaceChildren(
        h("div", { class: "ff-head" }, h("h3", {}, `${usable.length} field${usable.length === 1 ? "" : "s"}`), h("span", { class: "muted", style: "font-size:13px" }, "Fill what you need, then apply.")),
        ...usable.map((f) => {
          values[f.name] = f.value;
          const id = `ff-${f.name.replace(/[^a-z0-9_-]/gi, "_")}`;
          let control;
          if (f.type === "text")
            control = f.multiline
              ? h("textarea", { id, name: f.name, rows: 3, readOnly: f.readOnly, oninput: (e) => (values[f.name] = e.target.value) }, f.value || "")
              : h("input", { id, name: f.name, type: "text", value: f.value || "", readOnly: f.readOnly, oninput: (e) => (values[f.name] = e.target.value) });
          else if (f.type === "checkbox") control = h("input", { id, name: f.name, type: "checkbox", checked: !!f.value, onchange: (e) => (values[f.name] = e.target.checked) });
          else if (f.type === "radio")
            control = h(
              "div",
              { class: "radios", role: "radiogroup" },
              f.options.map((o) => h("label", {}, h("input", { type: "radio", name: `${id}-r`, value: o, checked: o === f.value, onchange: () => (values[f.name] = o) }), h("span", {}, o)))
            );
          else if (f.type === "dropdown")
            control = h("select", { id, name: f.name, onchange: (e) => (values[f.name] = e.target.value) }, h("option", { value: "" }, "—"), f.options.map((o) => h("option", { value: o, selected: o === f.value }, o)));
          else
            control = h("select", { id, name: f.name, multiple: true, size: Math.min(5, f.options.length), onchange: (e) => (values[f.name] = [...e.target.selectedOptions].map((o) => o.value)) }, f.options.map((o) => h("option", { value: o, selected: (f.value || []).includes(o) }, o)));
          return h("div", { class: `opt ff-field ff-${f.type}` }, f.type === "checkbox" ? h("label", { class: "check-row", for: id }, control, h("span", {}, f.name)) : [h("label", { for: id }, f.name), control]);
        })
      );
    })
    .catch((err) => api.setError(err.message || "Could not read the form."));
  return { collect: () => ({ values }), destroy() {} };
}

/** Request signatures: honest explanation, no server flow. */
export function requestSignaturesUI({ container, api }) {
  const { h } = api;
  container.append(
    h(
      "div",
      { class: "ff-empty" },
      h("h3", {}, "Collecting signatures from other people needs a server"),
      h("p", { class: "muted" }, "A signing request means sending the document to someone else, tracking that they opened it, recording who signed what and when, and keeping that audit trail for years. That cannot happen on your device alone, and this site never uploads anything. So this tool is not offered here."),
      h("p", { class: "muted" }, "What you can do locally: sign the document yourself with Sign PDF, then send the signed file through your own email or messaging app. For legally binding multi-party signatures, use a dedicated e-signature service."),
      h("div", { style: "display:flex;gap:8px;justify-content:center;flex-wrap:wrap" }, h("a", { class: "btn", href: "tool.html?tool=sign-pdf" }, "Sign it yourself"), h("a", { class: "btn secondary", href: "tool.html?tool=share-pdf" }, "Share the file"))
    )
  );
  return { collect: () => ({}), destroy() {} };
}
