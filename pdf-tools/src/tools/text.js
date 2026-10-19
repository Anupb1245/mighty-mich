// Text layout onto PDF pages: wrapping, paragraphs, headings, page breaks.
// Shared by TXT / CSV / RTF / HTML / EPUB / Office conversions.
import { PDFDocument, StandardFonts, rgb } from "./core.js";
import { embedUnicodeFont } from "./font.js";

export const PAGE = { a4: [595.28, 841.89], letter: [612, 792] };

/**
 * blocks: [{ text, size?, bold?, italic?, align?: "left"|"center"|"right", spaceAfter?, indent?, mono?, color? }]
 * A block with text "" is a blank line; { pageBreak: true } starts a new page.
 * { image: Uint8Array, width?, height?, align? } draws a JPEG/PNG scaled to fit (ctx.toPng may be given via
 * opts.toPng for other formats); { table: string[][] } draws a simple grid.
 * pageSize may be a key of PAGE or a [width, height] array in points. Returns the document.
 */
export async function layoutBlocks(doc, blocks, { pageSize = "a4", margin = 56, size = 11, lineHeight = 1.4, fontFamily, toPng } = {}) {
  const { regular, bold, mono } = await fontsFor(doc, fontFamily);
  const [pw, ph] = Array.isArray(pageSize) ? pageSize : PAGE[pageSize] || PAGE.a4;
  let page = null;
  let y = 0;
  const newPage = () => {
    page = doc.addPage([pw, ph]);
    y = ph - margin;
  };
  newPage();
  const maxW = pw - margin * 2;

  for (const b of blocks) {
    if (b.pageBreak) {
      newPage();
      continue;
    }
    if (b.image) {
      const img = await embedAnyImage(doc, b.image, toPng).catch(() => null);
      if (!img) continue;
      let w = b.width || img.width;
      let hgt = b.height || img.height * (w / img.width);
      const scale = Math.min(1, maxW / w, (ph - margin * 2) / hgt);
      w *= scale;
      hgt *= scale;
      if (y - hgt < margin) newPage();
      let x = margin;
      if (b.align === "center") x = margin + (maxW - w) / 2;
      if (b.align === "right") x = margin + maxW - w;
      page.drawImage(img, { x, y: y - hgt, width: w, height: hgt });
      y -= hgt + (b.spaceAfter ?? size * 0.6);
      continue;
    }
    if (b.table) {
      y = drawGrid(page, b.table, { x: margin, y, maxW, size: b.size || size * 0.85, regular, bold: b.headerBold !== false ? bold : regular, margin, newPage: () => (newPage(), y), getPage: () => page, setY: (v) => (y = v) });
      y -= b.spaceAfter ?? size * 0.6;
      continue;
    }
    const fs = b.size || size;
    const font = b.mono ? mono : b.bold ? bold : regular;
    const lh = fs * lineHeight;
    const indent = b.indent || 0;
    const text = String(b.text ?? "");
    if (text === "") {
      y -= lh * 0.6;
      continue;
    }
    const lines = wrap(text, font, fs, maxW - indent);
    for (const line of lines) {
      if (y - lh < margin) newPage();
      const w = widthOf(line, font, fs);
      let x = margin + indent;
      if (b.align === "center") x = margin + (maxW - w) / 2;
      if (b.align === "right") x = margin + maxW - w;
      try {
        page.drawText(line, { x, y: y - fs, size: fs, font, color: b.color || rgb(0.1, 0.1, 0.12) });
      } catch {
        page.drawText(sanitize(line), { x, y: y - fs, size: fs, font: regular, color: rgb(0.1, 0.1, 0.12) });
      }
      y -= lh;
    }
    y -= (b.spaceAfter ?? fs * 0.5);
  }
  return doc;
}

export function widthOf(text, font, size) {
  try {
    return font.widthOfTextAtSize(text, size);
  } catch {
    return font.widthOfTextAtSize(sanitize(text), size);
  }
}

/** Replace characters the font cannot encode so a stray glyph never aborts a whole document. */
export function sanitize(s) {
  return String(s).replace(/[^\x09\x20-\x7E -ÿ–—‘’“”•…]/g, "?");
}

/** Greedy word wrap; breaks very long words by character. */
export function wrap(text, font, size, maxW) {
  const out = [];
  for (const para of String(text).split(/\r?\n/)) {
    const words = para.split(/(\s+)/).filter((w) => w !== "");
    let line = "";
    for (const w of words) {
      const candidate = line + w;
      if (widthOf(candidate, font, size) <= maxW) {
        line = candidate;
        continue;
      }
      if (line.trim()) out.push(line.replace(/\s+$/, ""));
      line = "";
      if (widthOf(w, font, size) <= maxW) {
        line = w.trimStart();
      } else {
        let chunk = "";
        for (const ch of w) {
          if (widthOf(chunk + ch, font, size) > maxW) {
            out.push(chunk);
            chunk = ch;
          } else chunk += ch;
        }
        line = chunk;
      }
    }
    out.push(line.replace(/\s+$/, ""));
  }
  return out.length ? out : [""];
}

const fontCache = new WeakMap();
export async function fontsFor(doc, family) {
  if (fontCache.has(doc)) return fontCache.get(doc);
  let regular, bold;
  const uni = await embedUnicodeFont(doc, family).catch(() => null);
  if (uni) ({ regular, bold } = uni);
  else {
    regular = await doc.embedFont(StandardFonts.Helvetica);
    bold = await doc.embedFont(StandardFonts.HelveticaBold);
  }
  const mono = await doc.embedFont(StandardFonts.Courier);
  const set = { regular, bold, mono };
  fontCache.set(doc, set);
  return set;
}

/** Convenience: plain text -> PDF document. */
export async function textToDoc(text, opts = {}) {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const blocks = String(text)
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => ({ text: line, spaceAfter: 0, mono: !!opts.mono }));
  await layoutBlocks(doc, blocks, { lineHeight: 1.35, ...opts });
  return doc;
}

function sniffImage(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "png";
  return "other";
}

export async function embedAnyImage(doc, bytes, toPng) {
  let kind = sniffImage(bytes);
  if (kind === "other") {
    if (!toPng) throw new Error("unsupported image");
    bytes = await toPng(bytes);
    kind = "png";
  }
  return kind === "jpeg" ? doc.embedJpg(bytes) : doc.embedPng(bytes);
}

/** Inline grid for layoutBlocks' table blocks. Returns the new y. */
function drawGrid(page, rows, o) {
  const cols = Math.max(0, ...rows.map((r) => r.length));
  if (!cols) return o.y;
  const pad = 3;
  const nat = Array(cols).fill(0);
  for (const r of rows) r.forEach((c, i) => (nat[i] = Math.max(nat[i], widthOf(String(c ?? ""), o.regular, o.size) + pad * 2, o.size * 2)));
  const total = nat.reduce((a, b) => a + b, 0);
  const widths = total <= o.maxW ? nat : nat.map((w) => Math.max(o.size * 3, (w / total) * o.maxW));
  const lh = o.size * 1.3;
  let y = o.y;
  let pg = page;
  rows.forEach((cells, ri) => {
    const font = ri === 0 ? o.bold : o.regular;
    const lines = cells.map((c, i) => wrap(String(c ?? ""), font, o.size, widths[i] - pad * 2));
    const hgt = Math.max(1, ...lines.map((l) => l.length)) * lh + pad * 2;
    if (y - hgt < o.margin) {
      y = o.newPage();
      pg = o.getPage();
    }
    let x = o.x;
    for (let i = 0; i < cols; i++) {
      pg.drawRectangle({ x, y: y - hgt, width: widths[i], height: hgt, borderColor: rgb(0.8, 0.8, 0.82), borderWidth: 0.5 });
      (lines[i] || []).forEach((line, li) => {
        try {
          pg.drawText(line, { x: x + pad, y: y - pad - o.size - li * lh, size: o.size, font });
        } catch {
          /* unencodable glyph */
        }
      });
      x += widths[i];
    }
    y -= hgt;
  });
  o.setY(y);
  return y;
}
