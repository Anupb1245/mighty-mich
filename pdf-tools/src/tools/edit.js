import { StandardFonts, rgb, degrees, result, baseName, loadDoc, saveDoc, ToolError } from "./core.js";

const POSITIONS = {
  "bottom-center": (w, h, tw, m) => [(w - tw) / 2, m],
  "bottom-left": (w, h, tw, m) => [m, m],
  "bottom-right": (w, h, tw, m) => [w - tw - m, m],
  "top-center": (w, h, tw, m) => [(w - tw) / 2, h - m - 8],
  "top-left": (w, h, tw, m) => [m, h - m - 8],
  "top-right": (w, h, tw, m) => [w - tw - m, h - m - 8],
};

function hexToRgb(hex) {
  const m = String(hex || "#000000").match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return rgb(0, 0, 0);
  return rgb(parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255);
}

/** Stamp page numbers. format uses {n} and {total}. */
export async function numberPages(files, { position = "bottom-center", start = 1, format = "{n}", fontSize = 11, margin = 28, fromPage = 1 } = {}) {
  const file = files[0];
  const doc = await loadDoc(file);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const place = POSITIONS[position] || POSITIONS["bottom-center"];
  const pages = doc.getPages();
  const total = pages.length;
  const first = Math.max(1, Number(fromPage) || 1) - 1;
  let n = Number(start) || 1;
  for (let i = first; i < total; i++) {
    const page = pages[i];
    const text = String(format || "{n}").replace("{n}", String(n)).replace("{total}", String(total - first));
    const size = Number(fontSize) || 11;
    const tw = font.widthOfTextAtSize(text, size);
    const { width, height } = page.getSize();
    const [x, y] = place(width, height, tw, Number(margin) || 28);
    page.drawText(text, { x, y, size, font, color: rgb(0.12, 0.12, 0.16) });
    n++;
  }
  const r = result(`${baseName(file.name)}-numbered.pdf`, await saveDoc(doc), { sizeBefore: file.size, pageCount: total });
  r.stats = { numbered: total - first };
  return r;
}

/** Diagonal (or flat) text watermark on every page. */
export async function watermark(files, { text = "", opacity = 0.25, fontSize = 48, angle = 45, color = "#c62828" } = {}) {
  const file = files[0];
  if (!String(text).trim()) throw new ToolError("Enter the watermark text.", "no_text");
  const doc = await loadDoc(file);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const size = Number(fontSize) || 48;
  const tw = font.widthOfTextAtSize(text, size);
  const rad = ((Number(angle) || 0) * Math.PI) / 180;
  for (const page of doc.getPages()) {
    const { width, height } = page.getSize();
    // centre the rotated text box
    const x = width / 2 - (tw / 2) * Math.cos(rad) + (size / 2) * Math.sin(rad);
    const y = height / 2 - (tw / 2) * Math.sin(rad) - (size / 2) * Math.cos(rad);
    page.drawText(String(text), {
      x,
      y,
      size,
      font,
      color: hexToRgb(color),
      opacity: Math.min(1, Math.max(0.05, Number(opacity) || 0.25)),
      rotate: degrees(Number(angle) || 0),
    });
  }
  return result(`${baseName(file.name)}-watermarked.pdf`, await saveDoc(doc), { sizeBefore: file.size, pageCount: doc.getPageCount() });
}
