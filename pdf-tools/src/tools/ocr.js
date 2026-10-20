// OCR: make a scanned PDF or a photo searchable. The engine (tesseract.js, browser only) is
// injected as ctx.ocrPage so the composition logic here is testable in Node.
import { PDFDocument, result, baseName, loadDoc, saveDoc, ToolError, degrees, pagesOf } from "./core.js";

export const LANGUAGES = [
  ["eng", "English (offline)"],
  ["deu", "German"],
  ["fra", "French"],
  ["spa", "Spanish"],
  ["por", "Portuguese"],
  ["ita", "Italian"],
  ["nld", "Dutch"],
  ["rus", "Russian"],
  ["chi_sim", "Chinese (simplified)"],
  ["jpn", "Japanese"],
  ["ara", "Arabic"],
  ["hin", "Hindi"],
];

const SCALE = 2; // render at 144 dpi: good accuracy, bounded memory
const DPI = 72 * SCALE;
const FIT_WIDTH = 595.28; // photos are fitted to A4 width

/** Display size of a PDF page after its /Rotate is applied. */
export function displayedSize(width, height, rotation) {
  const r = ((rotation % 360) + 360) % 360;
  return r === 90 || r === 270 ? [height, width] : [width, height];
}

/**
 * Draw a text layer that was produced from the *displayed* (rotated) image back into a page
 * whose content is in unrotated coordinates. See the rotation mapping notes in the tests.
 */
export function placeTextLayer(page, textEmb, { rotation, width, height }) {
  const r = ((rotation % 360) + 360) % 360;
  const [dw, dh] = displayedSize(width, height, r);
  if (r === 0) page.drawPage(textEmb, { x: 0, y: 0, width: dw, height: dh });
  else if (r === 90) page.drawPage(textEmb, { x: width, y: 0, width: dw, height: dh, rotate: degrees(90) });
  else if (r === 180) page.drawPage(textEmb, { x: width, y: height, width: dw, height: dh, rotate: degrees(180) });
  else page.drawPage(textEmb, { x: 0, y: height, width: dw, height: dh, rotate: degrees(-90) });
}

async function engine(ctx, onStatus) {
  if (ctx.ocrPage) return ctx.ocrPage;
  const mod = await import("./ocrEngine.js");
  return (bytes, opts) => mod.ocrImage(bytes, { ...opts, onStatus });
}

/**
 * Make a PDF (or an image) searchable. ctx.ocrPage(imageBytes, { lang, dpi, mime }) -> { text, pdf }
 * where pdf is a one-page text-only PDF whose page is the displayed image. Output "pdf" keeps the
 * original vector content and adds an invisible text layer; output "txt" returns the text.
 */
export async function ocr(files, { lang = "eng", output = "pdf" } = {}, ctx = {}) {
  const file = files[0];
  if (!file) throw new ToolError("Add a PDF or an image.", "no_files");
  let status = "";
  const recognize = await engine(ctx, (m) => {
    if (m?.status && m.status !== status) {
      status = m.status;
      ctx.onStatus?.(status);
    }
  });
  const out = await PDFDocument.create({ updateMetadata: false });
  const texts = [];

  if (file.kind === "image" || !isPdfBytes(file.bytes)) {
    const bytes = sniff(file.bytes) === "other" ? await (ctx.toPng ? ctx.toPng(file.bytes, file.name) : Promise.reject(new ToolError(`${file.name}: only JPG and PNG are supported.`))) : file.bytes;
    const kind = sniff(bytes);
    const img = kind === "jpeg" ? await out.embedJpg(bytes) : await out.embedPng(bytes);
    const scale = FIT_WIDTH / img.width;
    const w = img.width * scale;
    const h = img.height * scale;
    const dpi = (img.width / w) * 72;
    const { text, pdf } = await recognize(bytes, { lang, dpi, mime: kind === "jpeg" ? "image/jpeg" : "image/png" });
    texts.push(text);
    if (output === "pdf") {
      const page = out.addPage([w, h]);
      page.drawImage(img, { x: 0, y: 0, width: w, height: h });
      const textEmb = await embedFirstPage(out, pdf);
      if (textEmb) placeTextLayer(page, textEmb, { rotation: 0, width: w, height: h });
    }
    ctx.onProgress?.(1);
  } else {
    if (!ctx.renderPage) throw new ToolError("OCR needs a browser to render pages.", "no_renderer");
    const src = await loadDoc(file);
    const pages = await pagesOf(file, src);
    const total = pages.length;
    for (let i = 0; i < total; i++) {
      const p = pages[i];
      const srcPage = src.getPage(p.index);
      const { width, height } = srcPage.getSize();
      const rotation = (srcPage.getRotation().angle + (p.rotation || 0)) % 360;
      const png = await ctx.renderPage(file.bytes, p.index, { scale: SCALE, format: "png", rotation: p.rotation || 0, password: file.password });
      const { text, pdf } = await recognize(png, { lang, dpi: DPI, mime: "image/png" });
      texts.push(text);
      if (output === "pdf") {
        const emb = await embedPage(out, src, p.index);
        const page = out.addPage([width, height]);
        if (emb) page.drawPage(emb, { x: 0, y: 0, width, height });
        const textEmb = await embedFirstPage(out, pdf);
        if (textEmb) placeTextLayer(page, textEmb, { rotation, width, height });
        page.setRotation(degrees(rotation));
      }
      ctx.onProgress?.((i + 1) / total);
    }
  }

  const base = baseName(file.name);
  if (output === "txt") {
    const text = texts.map((t) => t.trim()).join("\n\n\f\n").replace(/\f/g, "");
    const bytes = new TextEncoder().encode(text);
    const r = result(`${base}.txt`, bytes, { kind: "txt", mime: "text/plain;charset=utf-8", sizeBefore: file.size });
    r.stats = { pages: texts.length, characters: text.length };
    return r;
  }
  const r = result(`${base}-searchable.pdf`, await saveDoc(out), { sizeBefore: file.size, pageCount: out.getPageCount() });
  r.stats = { pages: texts.length, characters: texts.join("").length };
  return r;
}

/**
 * embedPdf refuses pages without a content stream (blank pages) and only fails at save time,
 * so check for contents up front; a blank page simply draws nothing.
 */
function hasContents(doc, index) {
  try {
    return !!doc.getPage(index).node.Contents();
  } catch {
    return false;
  }
}
async function embedPage(out, src, index) {
  if (!hasContents(src, index)) return null;
  const [emb] = await out.embedPdf(src, [index]);
  return emb;
}
async function embedFirstPage(out, bytes) {
  if (!bytes || !bytes.length) return null;
  try {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    if (!doc.getPageCount() || !hasContents(doc, 0)) return null;
    const [emb] = await out.embedPdf(doc, [0]);
    return emb;
  } catch {
    return null; // an unreadable text layer never blocks the output
  }
}

function isPdfBytes(b) {
  return b && b.length > 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46;
}
function sniff(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  return "other";
}
