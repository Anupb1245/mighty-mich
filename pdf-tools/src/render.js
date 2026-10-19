// pdf.js wrapper: thumbnails and full page renders. Browser only.
import * as pdfjs from "../vendor/pdf.mjs";
import { linesOf } from "./tools/lines.js";
export { linesOf };

pdfjs.GlobalWorkerOptions.workerSrc = new URL("../vendor/pdf.worker.mjs", import.meta.url).href;

const docCache = new Map(); // bytes -> PDFDocumentProxy

async function open(bytes, password) {
  if (docCache.has(bytes)) return docCache.get(bytes);
  const task = pdfjs.getDocument({ data: bytes.slice(), password, isEvalSupported: false, disableFontFace: false });
  const doc = await task.promise;
  docCache.set(bytes, doc);
  return doc;
}

export function forget(bytes) {
  const doc = docCache.get(bytes);
  if (doc) {
    doc.destroy();
    docCache.delete(bytes);
  }
}

/** Page count, or throws { needsPassword: true } when locked. */
export async function inspectPdf(bytes, password) {
  try {
    const doc = await open(bytes, password);
    return { pageCount: doc.numPages };
  } catch (err) {
    if (err?.name === "PasswordException") {
      const e = new Error(password ? "Wrong password." : "This PDF needs a password.");
      e.needsPassword = true;
      e.wrong = !!password;
      throw e;
    }
    throw new Error("Could not read this PDF.");
  }
}

async function renderToCanvas(bytes, pageIndex, { scale = 1, rotation = 0, password } = {}) {
  const doc = await open(bytes, password);
  const page = await doc.getPage(pageIndex + 1);
  const viewport = page.getViewport({ scale, rotation: (page.rotate + rotation) % 360 });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  page.cleanup();
  return canvas;
}

/** Small data-URL thumbnail, longest edge ~ `edge` px. */
export async function thumbnail(bytes, pageIndex, { edge = 220, password } = {}) {
  const doc = await open(bytes, password);
  const page = await doc.getPage(pageIndex + 1);
  const base = page.getViewport({ scale: 1 });
  const scale = edge / Math.max(base.width, base.height);
  const canvas = await renderToCanvas(bytes, pageIndex, { scale, password });
  return canvas.toDataURL("image/jpeg", 0.8);
}

function canvasToBytes(canvas, format, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? blob.arrayBuffer().then((b) => resolve(new Uint8Array(b))) : reject(new Error("encode failed"))),
      format === "png" ? "image/png" : "image/jpeg",
      quality
    );
  });
}

/** Full page render -> JPEG/PNG bytes. Matches the ctx.renderPage contract the tools expect. */
export async function renderPage(bytes, pageIndex, { scale = 2, format = "jpeg", quality = 0.9, rotation = 0, password } = {}) {
  const canvas = await renderToCanvas(bytes, pageIndex, { scale, rotation, password });
  return canvasToBytes(canvas, format, quality);
}

/** Any browser-decodable image -> PNG bytes. */
export async function toPng(bytes, name = "") {
  const blob = new Blob([bytes]);
  const bmp = await createImageBitmap(blob).catch(() => null);
  if (!bmp) throw new Error(`${name || "This image"} could not be decoded by your browser.`);
  const canvas = document.createElement("canvas");
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  canvas.getContext("2d").drawImage(bmp, 0, 0);
  bmp.close();
  return canvasToBytes(canvas, "png");
}

/** Preview data URL for an image file. */
export async function imagePreview(bytes, edge = 220) {
  const bmp = await createImageBitmap(new Blob([bytes])).catch(() => null);
  if (!bmp) return null;
  const scale = Math.min(1, edge / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bmp.width * scale));
  canvas.height = Math.max(1, Math.round(bmp.height * scale));
  canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  return canvas.toDataURL("image/jpeg", 0.8);
}

/** Re-encode a JPEG smaller. Matches the ctx.resizeJpeg contract in compress.js. */
export async function resizeJpeg(bytes, { maxEdge = 1600, quality = 0.75 } = {}) {
  const bmp = await createImageBitmap(new Blob([bytes], { type: "image/jpeg" })).catch(() => null);
  if (!bmp) return null;
  const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const out = await canvasToBytes(canvas, "jpeg", quality);
  return { bytes: out, width: w, height: h };
}

/**
 * Text of every page with positions, for PDF -> Word/Excel, search and AI.
 * Returns [{ width, height, items: [{ str, x, y, w, h, size, bold }] , text }] (y measured from the top).
 */
export async function extractText(bytes, { password } = {}) {
  const doc = await open(bytes, password);
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const items = [];
    for (const it of tc.items) {
      if (!("str" in it)) continue;
      const [a, b, c, d, e, f] = it.transform;
      const size = Math.hypot(b, d) || Math.abs(d) || 10;
      const style = tc.styles[it.fontName];
      items.push({
        str: it.str,
        x: e,
        y: vp.height - f, // baseline from top
        w: it.width,
        h: it.height || size,
        size,
        bold: /bold|black|heavy|semibold/i.test(style?.fontFamily || "") || /bold/i.test(it.fontName || ""),
        eol: !!it.hasEOL,
      });
    }
    pages.push({ width: vp.width, height: vp.height, items, text: linesOf(items).map((l) => l.text).join("\n") });
    page.cleanup();
  }
  return pages;
}

/** Plain text of the whole document. */
export async function textOf(bytes, opts) {
  const pages = await extractText(bytes, opts);
  return pages.map((p) => p.text).join("\n\n");
}

/**
 * Scanner-style enhancement for a photographed page. mode: "document" (auto levels + mild sharpen),
 * "grayscale", "bw" (adaptive threshold). Returns JPEG bytes.
 */
export async function enhanceImage(bytes, mode = "document", { maxEdge = 2200, quality = 0.85 } = {}) {
  const bmp = await createImageBitmap(new Blob([bytes])).catch(() => null);
  if (!bmp) return bytes;
  const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const hgt = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = hgt;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, w, hgt);
  bmp.close();
  const img = ctx.getImageData(0, 0, w, hgt);
  const d = img.data;
  // luminance histogram for auto levels
  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) hist[(d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000 | 0]++;
  const total = w * hgt;
  let lo = 0, hi = 255, acc = 0;
  for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc > total * 0.01) { lo = i; break; } }
  acc = 0;
  for (let i = 255; i >= 0; i--) { acc += hist[i]; if (acc > total * 0.02) { hi = i; break; } }
  const range = Math.max(1, hi - lo);
  for (let i = 0; i < d.length; i += 4) {
    if (mode === "document") {
      for (let c = 0; c < 3; c++) d[i + c] = Math.max(0, Math.min(255, ((d[i + c] - lo) * 255) / range));
    } else {
      const g = Math.max(0, Math.min(255, (((d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000 - lo) * 255) / range));
      d[i] = d[i + 1] = d[i + 2] = g;
    }
  }
  if (mode === "bw") {
    // adaptive threshold on a coarse local mean
    const block = 32;
    const means = [];
    for (let by = 0; by < hgt; by += block) {
      const row = [];
      for (let bx = 0; bx < w; bx += block) {
        let sum = 0, n = 0;
        for (let y = by; y < Math.min(hgt, by + block); y += 2) for (let x = bx; x < Math.min(w, bx + block); x += 2) { sum += d[(y * w + x) * 4]; n++; }
        row.push(sum / Math.max(1, n));
      }
      means.push(row);
    }
    for (let y = 0; y < hgt; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const m = means[(y / block) | 0][(x / block) | 0];
      const v = d[i] < m - 12 ? 0 : 255;
      d[i] = d[i + 1] = d[i + 2] = v;
    }
  }
  ctx.putImageData(img, 0, 0);
  if (mode === "document") {
    // mild unsharp mask via a second canvas blur
    const c2 = document.createElement("canvas");
    c2.width = w; c2.height = hgt;
    const x2 = c2.getContext("2d");
    x2.filter = "blur(1.5px)";
    x2.drawImage(canvas, 0, 0);
    const blur = x2.getImageData(0, 0, w, hgt).data;
    const sharp = ctx.getImageData(0, 0, w, hgt);
    const s = sharp.data;
    for (let i = 0; i < s.length; i += 4) for (let c = 0; c < 3; c++) s[i + c] = Math.max(0, Math.min(255, s[i + c] + (s[i + c] - blur[i + c]) * 0.6));
    ctx.putImageData(sharp, 0, 0);
  }
  return canvasToBytes(canvas, "jpeg", quality);
}
