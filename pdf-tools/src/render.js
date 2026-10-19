// pdf.js wrapper: thumbnails and full page renders. Browser only.
import * as pdfjs from "../vendor/pdf.mjs";

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
