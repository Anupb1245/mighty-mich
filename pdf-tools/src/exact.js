// Exact-layout Office -> PDF. Browser only.
// A real layout engine renders the document inside a hidden host element, each page is
// rasterized exactly as it looks, and an invisible text layer taken from the DOM keeps the
// PDF searchable and selectable. Nothing leaves the browser.
import { PDFDocument, TextRenderingMode, pushGraphicsState, popGraphicsState, setTextRenderingMode } from "../vendor/pdf-lib.esm.js";
import { result, baseName, ToolError } from "./tools/core.js";
import { fontsFor } from "./tools/text.js";

const PX2PT = 72 / 96;
const PIXEL_RATIO = 2; // 192 dpi raster: crisp on screen and in print, bounded memory
const JPEG_QUALITY = 0.92;

let hostEl = null;
function host() {
  if (hostEl && hostEl.isConnected) return hostEl;
  hostEl = document.createElement("div");
  hostEl.id = "exact-host";
  // Off-screen but laid out: html-to-image needs real geometry and computed styles.
  hostEl.style.cssText = "position:fixed;left:-30000px;top:0;width:auto;height:auto;overflow:visible;background:#fff;color:#000;z-index:-1;";
  document.body.append(hostEl);
  return hostEl;
}

function mount() {
  const wrap = document.createElement("div");
  wrap.style.cssText = "display:inline-block;background:#fff;";
  host().append(wrap);
  return { wrap, unmount: () => wrap.remove() };
}

const RENDER_TIMEOUT_MS = 90_000;
function withTimeout(promise, what) {
  let t;
  const timeout = new Promise((_, reject) => (t = setTimeout(() => reject(new ToolError(`${what} took too long to render.`, "render_timeout")), RENDER_TIMEOUT_MS)));
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

async function settle(root) {
  await (document.fonts?.ready || Promise.resolve());
  const imgs = [...root.querySelectorAll("img")].filter((i) => !i.complete);
  await Promise.all(imgs.map((i) => new Promise((r) => (i.onload = i.onerror = r))));
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
}

async function rasterize(el) {
  const { toCanvas } = await import("../vendor/html-to-image.esm.js");
  const canvas = await toCanvas(el, { pixelRatio: PIXEL_RATIO, backgroundColor: "#ffffff", cacheBust: false, skipAutoScale: true });
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? b.arrayBuffer().then((a) => resolve(new Uint8Array(a))) : reject(new Error("rasterize failed"))), "image/jpeg", JPEG_QUALITY));
}

/** Word-level text runs under `pageEl`, positions in CSS px relative to the page box. */
function textRuns(pageEl) {
  const base = pageEl.getBoundingClientRect();
  const runs = [];
  const walker = document.createTreeWalker(pageEl, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.nodeValue.trim() && !/^(SCRIPT|STYLE)$/.test(n.parentElement?.tagName) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });
  let node;
  while ((node = walker.nextNode())) {
    const text = node.nodeValue;
    const cs = getComputedStyle(node.parentElement);
    if (cs.visibility === "hidden" || cs.display === "none") continue;
    const size = parseFloat(cs.fontSize) || 12;
    const re = /\S+/g;
    let m;
    while ((m = re.exec(text))) {
      const range = document.createRange();
      range.setStart(node, m.index);
      range.setEnd(node, m.index + m[0].length);
      const rects = range.getClientRects();
      if (!rects.length) continue;
      const r = rects[0];
      if (r.width <= 0 || r.height <= 0) continue;
      runs.push({ text: m[0], x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height, size });
    }
  }
  return runs;
}

/** Rasterize page elements into a PDF with an invisible, selectable text layer. */
export async function pagesToPdf(pageEls, { onProgress } = {}) {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const { regular } = await fontsFor(doc);
  let i = 0;
  for (const el of pageEls) {
    const rect = el.getBoundingClientRect();
    const wpt = Math.max(1, rect.width * PX2PT);
    const hpt = Math.max(1, rect.height * PX2PT);
    const runs = textRuns(el);
    const jpg = await rasterize(el);
    const img = await doc.embedJpg(jpg);
    const page = doc.addPage([wpt, hpt]);
    page.drawImage(img, { x: 0, y: 0, width: wpt, height: hpt });
    if (runs.length) {
      page.pushOperators(pushGraphicsState(), setTextRenderingMode(TextRenderingMode.Invisible));
      for (const r of runs) {
        const size = Math.max(1, r.size * PX2PT);
        // fit the run to its box so selection highlights line up with the pixels
        let text = r.text;
        let width;
        try {
          width = regular.widthOfTextAtSize(text, size);
        } catch {
          text = text.replace(/[^\x20-\x7E -ɏͰ-ϿЀ-ӿ]/g, "?");
          width = regular.widthOfTextAtSize(text, size);
        }
        const target = r.w * PX2PT;
        const scale = width > 0 ? Math.min(1.6, Math.max(0.5, target / width)) : 1;
        page.drawText(text, { x: r.x * PX2PT, y: hpt - (r.y + r.h * 0.82) * PX2PT, size, font: regular, ...(scale !== 1 ? { horizontalScale: scale * 100 } : {}) });
      }
      page.pushOperators(popGraphicsState());
    }
    i++;
    onProgress?.(i / pageEls.length);
  }
  return doc;
}

async function finish(doc, file, kind, pages) {
  const bytes = await doc.save({ useObjectStreams: true, addDefaultPage: false });
  const r = result(`${baseName(file.name)}.pdf`, bytes, { sizeBefore: file.size, pageCount: doc.getPageCount() });
  r.stats = { mode: "exact", kind, pages };
  return r;
}

/* ---------------- Word ---------------- */

export async function docxToPdf(files, o = {}, ctx = {}) {
  const file = files[0];
  const { renderAsync } = await import("../vendor/docx-preview.mjs");
  const { wrap, unmount } = mount();
  try {
    const body = document.createElement("div");
    const styles = document.createElement("div");
    wrap.append(styles, body);
    try {
      await withTimeout(renderAsync(file.bytes, body, styles, {
        inWrapper: false,
        breakPages: true,
        ignoreWidth: false,
        ignoreHeight: false,
        ignoreLastRenderedPageBreak: false,
        renderHeaders: true,
        renderFooters: true,
        renderFootnotes: true,
        renderEndnotes: true,
        useBase64URL: true,
        experimental: true,
      }), "The document");
    } catch (err) {
      throw new ToolError(`${file.name} could not be rendered: ${String(err?.message || err).slice(0, 120)}`, "render_failed");
    }
    await settle(body);
    const pages = [...body.querySelectorAll("section.docx")];
    if (!pages.length) throw new ToolError("The document rendered no pages.", "empty");
    const doc = await pagesToPdf(pages, { onProgress: ctx.onProgress });
    return finish(doc, file, "docx", pages.length);
  } finally {
    unmount();
  }
}

/* ---------------- Excel ---------------- */

const THEME = ["#FFFFFF", "#000000", "#E7E6E6", "#44546A", "#4472C4", "#ED7D31", "#A5A5A5", "#FFC000", "#5B9BD5", "#70AD47"];
function color(c, fallback) {
  if (!c) return fallback;
  if (c.argb) return "#" + c.argb.slice(-6);
  if (typeof c.theme === "number") {
    const base = THEME[c.theme] || fallback;
    const t = Number(c.tint || 0);
    if (!t) return base;
    const n = parseInt(base.slice(1), 16);
    const mix = (v) => Math.round(t > 0 ? v + (255 - v) * t : v * (1 + t));
    return "#" + [16, 8, 0].map((s) => mix((n >> s) & 255).toString(16).padStart(2, "0")).join("");
  }
  return fallback;
}
const BORDER = { thin: "1px solid", medium: "2px solid", thick: "3px solid", dotted: "1px dotted", dashed: "1px dashed", double: "3px double", hair: "1px solid" };

function sheetToTable(ws) {
  const colW = (i) => Math.round(((ws.getColumn(i + 1).width || 8.43) * 7 + 5));
  const merges = new Map();
  const covered = new Set();
  for (const ref of Object.keys(ws._merges || {})) {
    const m = ws._merges[ref]?.model || ws._merges[ref];
    if (!m) continue;
    const { top, left, bottom, right } = m;
    if (top == null) continue;
    merges.set(`${top}:${left}`, { rows: bottom - top + 1, cols: right - left + 1 });
    for (let r = top; r <= bottom; r++) for (let c = left; c <= right; c++) if (r !== top || c !== left) covered.add(`${r}:${c}`);
  }
  const rows = [];
  // rowCount/columnCount include styled-but-empty and merged cells; the "actual" counts drop them
  const maxCol = Math.max(1, ws.columnCount || ws.actualColumnCount || 1);
  const maxRow = Math.max(1, ws.rowCount || ws.actualRowCount || 1);
  const grid = ws.views?.[0]?.showGridLines !== false;
  const table = document.createElement("table");
  table.style.cssText = `border-collapse:collapse;table-layout:fixed;font-family:Calibri,Carlito,Arial,sans-serif;font-size:11pt;color:#000;background:#fff;`;
  const colgroup = document.createElement("colgroup");
  let totalW = 0;
  for (let c = 0; c < maxCol; c++) {
    const col = document.createElement("col");
    const w = colW(c);
    totalW += w;
    col.style.width = `${w}px`;
    colgroup.append(col);
  }
  table.append(colgroup);
  for (let r = 1; r <= maxRow; r++) {
    const row = ws.getRow(r);
    const tr = document.createElement("tr");
    const hpx = Math.round(((row.height || 15) * 96) / 72);
    tr.style.height = `${hpx}px`;
    for (let c = 1; c <= maxCol; c++) {
      if (covered.has(`${r}:${c}`)) continue;
      const cell = row.getCell(c);
      const td = document.createElement("td");
      const m = merges.get(`${r}:${c}`);
      if (m) {
        if (m.rows > 1) td.rowSpan = m.rows;
        if (m.cols > 1) td.colSpan = m.cols;
      }
      const f = cell.font || {};
      const al = cell.alignment || {};
      const fill = cell.fill && cell.fill.type === "pattern" && cell.fill.pattern !== "none" ? color(cell.fill.fgColor, "") : "";
      const b = cell.border || {};
      const side = (s) => (s && s.style ? `${BORDER[s.style] || "1px solid"} ${color(s.color, "#000")}` : grid ? "1px solid #d9d9d9" : "none");
      td.style.cssText = [
        `padding:1px 3px`,
        `overflow:hidden`,
        `white-space:${al.wrapText ? "normal" : "nowrap"}`,
        `vertical-align:${al.vertical === "top" ? "top" : al.vertical === "middle" ? "middle" : "bottom"}`,
        `text-align:${al.horizontal === "center" || al.horizontal === "centerContinuous" ? "center" : al.horizontal === "right" ? "right" : typeof cell.value === "number" || (cell.value && cell.value.result !== undefined && typeof cell.value.result === "number") ? "right" : "left"}`,
        f.bold ? "font-weight:bold" : "",
        f.italic ? "font-style:italic" : "",
        f.underline ? "text-decoration:underline" : "",
        f.strike ? "text-decoration:line-through" : "",
        f.size ? `font-size:${f.size}pt` : "",
        f.name ? `font-family:"${f.name}",Calibri,Arial,sans-serif` : "",
        f.color ? `color:${color(f.color, "#000")}` : "",
        fill ? `background:${fill}` : "",
        `border-top:${side(b.top)}`,
        `border-left:${side(b.left)}`,
        `border-bottom:${side(b.bottom)}`,
        `border-right:${side(b.right)}`,
      ]
        .filter(Boolean)
        .join(";");
      let text = "";
      try {
        text = cell.text ?? "";
      } catch {
        text = String(cell.value ?? "");
      }
      td.textContent = text;
      tr.append(td);
    }
    rows.push(tr);
    table.append(tr);
  }
  return { table, totalW, rows };
}

export async function xlsxToPdf(files, o = {}, ctx = {}) {
  const file = files[0];
  const ExcelJS = (await import("../vendor/exceljs.esm.js")).default;
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(file.bytes.buffer.slice(file.bytes.byteOffset, file.bytes.byteOffset + file.bytes.byteLength));
  } catch (err) {
    throw new ToolError(`${file.name} could not be read: ${String(err?.message || err).slice(0, 120)}`, "read_failed");
  }
  const { wrap, unmount } = mount();
  try {
    const pageEls = [];
    const MARGIN = 36; // px
    const MAX_H = 1400; // px of rows per page
    for (const ws of wb.worksheets) {
      if (ws.state && ws.state !== "visible") continue;
      const { table, totalW, rows } = sheetToTable(ws);
      // Paginate rows by height, repeating nothing (a long sheet becomes tall pages of equal width).
      let chunk = [];
      let hsum = 0;
      const flush = () => {
        if (!chunk.length) return;
        const pageEl = document.createElement("div");
        pageEl.style.cssText = `background:#fff;padding:${MARGIN}px;display:inline-block;`;
        const t = table.cloneNode(false);
        t.append(table.querySelector("colgroup").cloneNode(true));
        for (const tr of chunk) t.append(tr.cloneNode(true));
        const title = document.createElement("div");
        title.style.cssText = "font:bold 10pt Calibri,Arial,sans-serif;color:#555;margin:0 0 6px;";
        title.textContent = ws.name;
        pageEl.append(title, t);
        wrap.append(pageEl);
        pageEls.push(pageEl);
        chunk = [];
        hsum = 0;
      };
      for (const tr of rows) {
        const h = parseInt(tr.style.height, 10) || 20;
        if (hsum + h > MAX_H && chunk.length) flush();
        chunk.push(tr);
        hsum += h;
      }
      flush();
      void totalW;
    }
    if (!pageEls.length) throw new ToolError("The workbook has no visible sheets.", "empty");
    await settle(wrap);
    const doc = await pagesToPdf(pageEls, { onProgress: ctx.onProgress });
    return finish(doc, file, "xlsx", pageEls.length);
  } finally {
    unmount();
  }
}

/* ---------------- PowerPoint ---------------- */

export async function pptxToPdf(files, o = {}, ctx = {}) {
  const file = files[0];
  const mod = await import("../vendor/pptx-preview.esm.js");
  const lib = mod.default || mod.pptxPreview;
  if (!lib?.init) throw new ToolError("The slide renderer failed to load.", "render_failed");
  const { wrap, unmount } = mount();
  try {
    const container = document.createElement("div");
    const W = 1280;
    const H = 720;
    container.style.cssText = `width:${W}px;`;
    wrap.append(container);
    const previewer = lib.init(container, { width: W, height: H, mode: "list" });
    // The renderer parses optional parts (e.g. defaultTextStyle) on a detached promise and can
    // reject there for minimal decks; those rejections do not affect the slides it already drew.
    const swallow = (e) => {
      if (/pptx-preview/.test(String(e.reason?.stack || ""))) e.preventDefault();
    };
    window.addEventListener("unhandledrejection", swallow);
    try {
      await withTimeout(previewer.preview(file.bytes.buffer.slice(file.bytes.byteOffset, file.bytes.byteOffset + file.bytes.byteLength)), "The presentation");
      await settle(container);
    } catch (err) {
      throw new ToolError(`${file.name} could not be rendered: ${String(err?.message || err).slice(0, 120)}`, "render_failed");
    } finally {
      setTimeout(() => window.removeEventListener("unhandledrejection", swallow), 2000);
    }
    const slides = findSlides(container);
    if (!slides.length) throw new ToolError("The presentation rendered no slides.", "empty");
    const doc = await pagesToPdf(slides, { onProgress: ctx.onProgress });
    return finish(doc, file, "pptx", slides.length);
  } finally {
    unmount();
  }
}

/** The slide elements the renderer produced: the largest repeated same-size boxes inside the container. */
function findSlides(container) {
  const known = [...container.querySelectorAll(".pptx-preview-slide-wrapper")];
  if (known.length) return known;
  const candidates = [...container.querySelectorAll("*")].filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width >= 600 && r.height >= 300 && Math.abs(r.width / r.height - 16 / 9) < 0.35 || (r.width >= 600 && r.height >= 400 && Math.abs(r.width / r.height - 4 / 3) < 0.2);
  });
  // group by size, prefer the group with most members, then the outermost elements in it
  const groups = new Map();
  for (const el of candidates) {
    const r = el.getBoundingClientRect();
    const key = `${Math.round(r.width)}x${Math.round(r.height)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(el);
  }
  let best = [];
  for (const g of groups.values()) if (g.length > best.length) best = g;
  // drop nested duplicates: keep elements that have no ancestor in the set
  const set = new Set(best);
  return best.filter((el) => ![...set].some((o) => o !== el && o.contains(el)));
}
