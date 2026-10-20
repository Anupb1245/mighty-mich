// Browser-only: raster images of a PDF page with their placement, for PDF -> Word.
// Walks the pdf.js operator list, tracks the CTM, and exports each painted image as PNG.
import * as pdfjs from "../vendor/pdf.mjs";

if (!pdfjs.GlobalWorkerOptions.workerSrc) {
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("../vendor/pdf.worker.mjs", import.meta.url).href;
}

const OPS = pdfjs.OPS;
const MAX_IMAGES = 60;
const MIN_PT = 8;

const mul = (m, n) => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];

function canvasToPng(canvas) {
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? blob.arrayBuffer().then((b) => resolve(new Uint8Array(b))) : reject(new Error("encode failed"))), "image/png")
  );
}

/** pdf.js image object ({ bitmap } or { data, width, height, kind }) -> canvas. mask=true paints set bits black. */
function toCanvas(img, { mask = false } = {}) {
  const w = img.width;
  const h = img.height;
  if (!w || !h) return null;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (img.bitmap) {
    ctx.drawImage(img.bitmap, 0, 0);
    return canvas;
  }
  const data = img.data;
  if (!data) return null;
  const out = ctx.createImageData(w, h);
  const o = out.data;
  const n = w * h;
  if (mask || img.kind === 1) {
    // 1 bit per pixel, rows padded to bytes. For masks, sample 0 paints (default Decode).
    const rowBytes = Math.ceil(w / 8);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const bit = (data[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1;
        const i = (y * w + x) * 4;
        if (mask) {
          o[i] = o[i + 1] = o[i + 2] = 0;
          o[i + 3] = bit ? 0 : 255;
        } else {
          o[i] = o[i + 1] = o[i + 2] = bit ? 255 : 0;
          o[i + 3] = 255;
        }
      }
    }
  } else if (img.kind === 2 || data.length === n * 3) {
    for (let p = 0, i = 0; p < n; p++, i += 4) {
      o[i] = data[p * 3];
      o[i + 1] = data[p * 3 + 1];
      o[i + 2] = data[p * 3 + 2];
      o[i + 3] = 255;
    }
  } else if (data.length === n * 4) {
    o.set(data);
  } else if (data.length === n) {
    for (let p = 0, i = 0; p < n; p++, i += 4) {
      o[i] = o[i + 1] = o[i + 2] = data[p];
      o[i + 3] = 255;
    }
  } else return null;
  ctx.putImageData(out, 0, 0);
  return canvas;
}

function lookup(page, id) {
  try {
    if (page.objs.has(id)) return page.objs.get(id);
  } catch {
    /* unresolved */
  }
  try {
    if (page.commonObjs.has(id)) return page.commonObjs.get(id);
  } catch {
    /* unresolved */
  }
  return null;
}

/**
 * pageImages(bytes, pageIndex, { password }) -> [{ bytes, x, y, w, h }] in page points, y from the top.
 * The returned array also carries `vectorOps` (number of path-painting operators) so callers can
 * decide whether a vector-heavy page deserves a rendered background.
 */
export async function pageImages(bytes, pageIndex, { password } = {}) {
  const task = pdfjs.getDocument({ data: bytes.slice(), password, isEvalSupported: false });
  const doc = await task.promise;
  try {
    const page = await doc.getPage(pageIndex + 1);
    const [x0, y0, x1, y1] = page.view;
    const pageH = y1 - y0;
    const ops = await page.getOperatorList();
    const out = [];
    let vectorOps = 0;
    let ctm = [1, 0, 0, 1, 0, 0];
    const stack = [];
    const PAINT = new Set([OPS.fill, OPS.eoFill, OPS.stroke, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke, OPS.closeStroke, OPS.shadingFill]);
    for (let i = 0; i < ops.fnArray.length; i++) {
      const fn = ops.fnArray[i];
      const args = ops.argsArray[i];
      if (fn === OPS.save) stack.push(ctm);
      else if (fn === OPS.restore) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
      else if (fn === OPS.transform) ctm = mul(ctm, args);
      else if (PAINT.has(fn)) vectorOps++;
      else if (fn === OPS.paintImageXObject || fn === OPS.paintImageMaskXObject || fn === OPS.paintInlineImageXObject || fn === OPS.paintJpegXObject) {
        if (out.length >= MAX_IMAGES) continue;
        // the image unit square maps through the CTM
        const [a, b, c, d, e, f] = ctm;
        const xs = [e, a + e, c + e, a + c + e];
        const ys = [f, b + f, d + f, b + d + f];
        const w = Math.max(...xs) - Math.min(...xs);
        const h = Math.max(...ys) - Math.min(...ys);
        if (w < MIN_PT || h < MIN_PT) continue;
        let img = null;
        let mask = false;
        if (fn === OPS.paintImageMaskXObject) {
          img = args[0];
          mask = !img?.bitmap;
        } else if (fn === OPS.paintInlineImageXObject) img = args[0];
        else img = lookup(page, args[0]);
        if (!img) continue;
        let canvas;
        try {
          canvas = toCanvas(img, { mask });
        } catch {
          canvas = null;
        }
        if (!canvas) continue;
        // An upright placement has a > 0 and d > 0 (the unit square's top edge is the image's top row).
        // Mirrored placements are normalised so the exported bitmap reads the right way up.
        if (d < 0 || a < 0) {
          const c2 = document.createElement("canvas");
          c2.width = canvas.width;
          c2.height = canvas.height;
          const g = c2.getContext("2d");
          g.translate(a < 0 ? canvas.width : 0, d < 0 ? canvas.height : 0);
          g.scale(a < 0 ? -1 : 1, d < 0 ? -1 : 1);
          g.drawImage(canvas, 0, 0);
          canvas = c2;
        }
        out.push({
          bytes: await canvasToPng(canvas),
          x: Math.min(...xs) - x0,
          y: pageH - (Math.max(...ys) - y0),
          w,
          h,
          px: canvas.width,
          py: canvas.height,
        });
      }
    }
    page.cleanup();
    out.vectorOps = vectorOps;
    return out;
  } finally {
    await doc.destroy();
  }
}
