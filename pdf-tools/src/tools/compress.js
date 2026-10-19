import { PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFDict, result, baseName, loadDoc, saveDoc, ToolError, pagesOf } from "./core.js";

const LEVELS = {
  // max long edge in px, jpeg quality
  basic: { maxEdge: 1600, quality: 0.75, rasterScale: 1.6, rasterQuality: 0.7 },
  strong: { maxEdge: 1000, quality: 0.55, rasterScale: 1.1, rasterQuality: 0.5 },
};

function isImageStream(obj) {
  if (!(obj instanceof PDFRawStream)) return false;
  const d = obj.dict;
  return d.get(PDFName.of("Subtype")) === PDFName.of("Image");
}

function filterNames(dict) {
  const f = dict.get(PDFName.of("Filter"));
  if (!f) return [];
  if (f instanceof PDFName) return [f.decodeText ? f.decodeText() : f.toString().slice(1)];
  const arr = f.asArray ? f.asArray() : [];
  return arr.map((n) => (n.decodeText ? n.decodeText() : String(n).slice(1)));
}

/**
 * Downsample every JPEG (DCTDecode) image in the file in place, keeping text,
 * links and vectors intact. Images with soft masks are left alone so
 * transparency never breaks. ctx.resizeJpeg(bytes, { maxEdge, quality }) ->
 * { bytes, width, height } | null (null = could not decode / no gain).
 */
export async function shrinkImages(doc, level, ctx, stats) {
  const cfg = LEVELS[level] || LEVELS.basic;
  const objects = doc.context.enumerateIndirectObjects();
  for (const [, obj] of objects) {
    if (!isImageStream(obj)) continue;
    const dict = obj.dict;
    const filters = filterNames(dict);
    if (!filters.includes("DCTDecode") || filters.length !== 1) continue;
    if (dict.has(PDFName.of("SMask")) || dict.has(PDFName.of("Mask")) || dict.has(PDFName.of("Decode"))) continue;
    stats.images++;
    const before = obj.contents.length;
    const out = await ctx.resizeJpeg(obj.contents, cfg);
    if (!out || out.bytes.length >= before) continue;
    obj.contents = out.bytes;
    dict.set(PDFName.of("Width"), PDFNumber.of(out.width));
    dict.set(PDFName.of("Height"), PDFNumber.of(out.height));
    dict.set(PDFName.of("ColorSpace"), PDFName.of("DeviceRGB"));
    dict.set(PDFName.of("BitsPerComponent"), PDFNumber.of(8));
    dict.delete(PDFName.of("DecodeParms"));
    stats.shrunk++;
    stats.saved += before - out.bytes.length;
  }
}

/**
 * Compress. mode:
 *  - "lossless": re-save with object streams; drops unused objects. Text intact.
 *  - "basic" / "strong": lossless + downsample JPEG images in place. Text intact.
 *  - "rasterize": re-render every page to a JPEG (needs ctx.renderPage). Smallest, text becomes an image.
 */
export async function compress(files, { mode = "basic" } = {}, ctx = {}) {
  const file = files[0];
  const stats = { images: 0, shrunk: 0, saved: 0 };
  let bytes;
  if (mode === "rasterize") {
    if (!ctx.renderPage) throw new ToolError("Strong compression needs a browser.", "no_renderer");
    const cfg = LEVELS.strong;
    const src = await loadDoc(file);
    const pages = await pagesOf(file, src);
    const out = await PDFDocument.create({ updateMetadata: false });
    for (const p of pages) {
      const srcPage = src.getPage(p.index);
      const { width, height } = srcPage.getSize();
      const jpg = await ctx.renderPage(file.bytes, p.index, { scale: cfg.rasterScale, format: "jpeg", quality: cfg.rasterQuality, password: file.password });
      const img = await out.embedJpg(jpg);
      const rot = srcPage.getRotation().angle;
      const swap = rot === 90 || rot === 270;
      const page = out.addPage(swap ? [height, width] : [width, height]);
      page.drawImage(img, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
      ctx.onProgress?.((pages.indexOf(p) + 1) / pages.length);
    }
    bytes = await saveDoc(out);
  } else {
    const doc = await loadDoc(file);
    if (mode !== "lossless") {
      if (!ctx.resizeJpeg) throw new ToolError("Image compression needs a browser.", "no_renderer");
      await shrinkImages(doc, mode, ctx, stats);
    }
    bytes = await saveDoc(doc);
  }
  // Never hand back something bigger than what came in.
  const finalBytes = bytes.length < file.size ? bytes : file.bytes;
  const r = result(`${baseName(file.name)}-compressed.pdf`, finalBytes, { sizeBefore: file.size });
  r.stats = { ...stats, unchanged: finalBytes === file.bytes };
  return r;
}
