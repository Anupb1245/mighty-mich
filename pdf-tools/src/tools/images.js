import { PDFDocument, result, baseName, loadDoc, pagesOf, ToolError, degrees, saveDoc } from "./core.js";
import { zipFiles } from "../zip.js";

const PAGE_SIZES = {
  fit: null,
  a4: [595.28, 841.89],
  letter: [612, 792],
};
const MARGINS = { none: 0, small: 24, big: 56 };

function sniff(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  return "other";
}

/**
 * Images -> PDF. One image per page. ctx.toPng(bytes) converts anything that
 * is not JPEG/PNG (webp, gif, bmp, heic where the browser can decode it).
 */
export async function imagesToPdf(files, { pageSize = "fit", orientation = "auto", margin = "none" } = {}, ctx = {}) {
  if (!files.length) throw new ToolError("Add at least one image.", "no_files");
  const doc = await PDFDocument.create({ updateMetadata: false });
  const pad = MARGINS[margin] ?? 0;
  for (const file of files) {
    let bytes = file.bytes;
    let kind = sniff(bytes);
    if (kind === "other") {
      if (!ctx.toPng) throw new ToolError(`${file.name}: only JPG and PNG are supported here.`, "bad_image");
      bytes = await ctx.toPng(bytes, file.name);
      kind = "png";
    }
    const img = kind === "jpeg" ? await doc.embedJpg(bytes) : await doc.embedPng(bytes);
    const rotation = (file.pages && file.pages[0]?.rotation) || 0;
    const iw = img.width;
    const ih = img.height;
    const landscapeImg = iw > ih;
    let pw, ph;
    if (!PAGE_SIZES[pageSize]) {
      pw = iw + pad * 2;
      ph = ih + pad * 2;
    } else {
      [pw, ph] = PAGE_SIZES[pageSize];
      const wantLandscape = orientation === "landscape" || (orientation === "auto" && landscapeImg);
      if (wantLandscape) [pw, ph] = [ph, pw];
    }
    const page = doc.addPage([pw, ph]);
    const scale = Math.min((pw - pad * 2) / iw, (ph - pad * 2) / ih);
    const w = iw * scale;
    const h = ih * scale;
    page.drawImage(img, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
    if (rotation) page.setRotation(degrees(rotation));
  }
  const name = files.length === 1 ? `${baseName(files[0].name)}.pdf` : "images.pdf";
  return result(name, await saveDoc(doc), {
    sizeBefore: files.reduce((n, f) => n + f.size, 0),
    pageCount: doc.getPageCount(),
  });
}

/**
 * PDF -> images. Needs ctx.renderPage(bytes, pageIndex, { scale, format, quality })
 * -> Uint8Array (pdf.js + canvas in the browser). Selected pages only if any are selected.
 */
export async function pdfToImages(files, { format = "jpeg", quality = 0.9, dpi = 150 } = {}, ctx = {}) {
  if (!ctx.renderPage) throw new ToolError("Rendering needs a browser.", "no_renderer");
  const file = files[0];
  const doc = await loadDoc(file);
  let pages = await pagesOf(file, doc);
  if (pages.some((p) => p.selected)) pages = pages.filter((p) => p.selected);
  const scale = Number(dpi) / 72;
  const ext = format === "png" ? "png" : "jpg";
  const base = baseName(file.name);
  const entries = [];
  const pad = String(doc.getPageCount()).length;
  for (const p of pages) {
    const data = await ctx.renderPage(file.bytes, p.index, { scale, format, quality: Number(quality), rotation: p.rotation, password: file.password });
    entries.push({ name: `${base}-${String(p.index + 1).padStart(pad, "0")}.${ext}`, data });
    ctx.onProgress?.(entries.length / pages.length);
  }
  if (entries.length === 1) {
    return result(entries[0].name, entries[0].data, { kind: "image", mime: format === "png" ? "image/png" : "image/jpeg", sizeBefore: file.size });
  }
  return result(`${base}-images.zip`, zipFiles(entries), {
    kind: "zip",
    mime: "application/zip",
    sizeBefore: file.size,
    files: entries.map((e) => ({ name: e.name, size: e.data.length })),
  });
}
