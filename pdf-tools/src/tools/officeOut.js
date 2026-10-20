// PDF -> docx / xlsx / pptx writers. Hand-written Office Open XML, zipped with fflate.
import { result, baseName, ToolError } from "./core.js";
import { linesOf } from "./lines.js";
import { zipFiles } from "../zip.js";

export const MIME = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

export const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
const enc = (s) => new TextEncoder().encode(s);
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

// ------------------------------------------------------------ structure --------
/**
 * Group a page's positioned items into paragraphs:
 * { text, size, bold, heading } using baseline gaps and font size.
 */
export function paragraphsOf(page) {
  const lines = linesOf(page.items);
  if (!lines.length) return [];
  const sizes = lines.map((l) => l.size).sort((a, b) => a - b);
  const median = sizes[Math.floor(sizes.length / 2)] || 10;
  const paras = [];
  let cur = null;
  for (const line of lines) {
    const text = line.text.trim();
    if (!text) continue;
    const bold = line.items.filter((i) => i.bold).length > line.items.length / 2;
    const heading = line.size >= median * 1.25;
    const gap = cur ? line.y - cur.lastY : 0;
    const same = cur && !heading && !cur.heading && gap < Math.max(cur.size, line.size) * 1.7 && Math.abs(line.size - cur.size) < 1.5 && cur.bold === bold;
    if (same) {
      cur.text += (cur.text.endsWith("-") ? "" : " ") + text;
      cur.lastY = line.y;
    } else {
      cur = { text, size: line.size, bold, heading, lastY: line.y };
      paras.push(cur);
    }
  }
  return paras.map(({ text, size, bold, heading }) => ({ text, size, bold, heading }));
}

/** Split a line's items into cells wherever the horizontal gap is wide. */
export function cellsOf(line) {
  const cells = [];
  let cur = "";
  let lastEnd = null;
  for (const it of line.items) {
    if (lastEnd !== null && it.x - lastEnd > it.size * 1.2 && cur.trim()) {
      cells.push(cur.trim());
      cur = "";
    }
    cur += (cur && !cur.endsWith(" ") && !it.str.startsWith(" ") && lastEnd !== null && it.x - lastEnd > it.size * 0.2 ? " " : "") + it.str;
    lastEnd = it.x + it.w;
  }
  if (cur.trim()) cells.push(cur.trim());
  return cells;
}

// ----------------------------------------------------------------- docx --------
const CT_DOCX = XML + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`;
const RELS_ROOT = (main) => XML + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="${main}"/></Relationships>`;
const STYLES_DOCX = XML + `<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="60"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style></w:styles>`;

export function buildDocx(pages) {
  let body = "";
  pages.forEach((page, pi) => {
    for (const p of paragraphsOf(page)) {
      const style = p.heading ? (p.size >= 18 ? "Heading1" : "Heading2") : null;
      const rPr = `<w:rPr>${p.bold && !style ? "<w:b/>" : ""}<w:sz w:val="${Math.round(Math.max(8, Math.min(48, p.size)) * 2)}"/></w:rPr>`;
      body += `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}<w:r>${rPr}<w:t xml:space="preserve">${esc(p.text)}</w:t></w:r></w:p>`;
    }
    if (pi < pages.length - 1) body += `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`;
  });
  if (!body) body = "<w:p/>";
  const document = XML + `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  return zipFiles(
    [
      { name: "[Content_Types].xml", data: enc(CT_DOCX) },
      { name: "_rels/.rels", data: enc(RELS_ROOT("word/document.xml")) },
      { name: "word/document.xml", data: enc(document) },
      { name: "word/styles.xml", data: enc(STYLES_DOCX) },
      { name: "word/_rels/document.xml.rels", data: enc(XML + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`) },
    ],
    { level: 6 }
  );
}

// ------------------------------------------------ exact layout (docx) --------
export const twips = (pt) => Math.round(pt * 20);
export const emu = (pt) => Math.round(pt * 12700);

/** Map a PDF font name to a Word font family. Unknown names fall back to Arial. */
export function fontFamilyOf(name = "") {
  const n = String(name).toLowerCase();
  if (/mono|courier|consolas|menlo|monaco/.test(n)) return "Courier New";
  if (/times|georgia|garamond|book|roman|minion|cambria|palatino|serif/.test(n) && !/sans/.test(n)) return "Times New Roman";
  return "Arial";
}

/** Where the top of a Word frame must sit so its first baseline lands on `baseline` with exact line spacing `gap`. */
export function frameTopOf(baseline, size, gap) {
  return baseline - size * 0.8 - Math.max(0, (gap - size * 1.15) / 2);
}

/** left | center | right from the lines' x extents on the page. */
export function alignOf(block, pageWidth) {
  const xs = block.lines.map((l) => l.x);
  const ends = block.lines.map((l) => l.xEnd);
  const centers = block.lines.map((l) => (l.x + l.xEnd) / 2);
  const spread = (a) => Math.max(...a) - Math.min(...a);
  const tol = Math.max(2, block.size * 0.6);
  if (block.lines.length === 1) {
    const [c] = centers;
    return Math.abs(c - pageWidth / 2) <= Math.max(3, block.size * 0.4) && block.x > pageWidth * 0.1 ? "center" : "left";
  }
  if (spread(xs) <= tol) return "left";
  if (spread(centers) <= tol) return "center";
  if (spread(ends) <= tol) return "right";
  return "left";
}

/** Split a baseline into side-by-side segments wherever the horizontal gap is tab-like (> 2× font size). */
export function segmentsOf(line) {
  const segs = [];
  let cur = null;
  let lastEnd = null;
  for (const it of line.items) {
    if (cur && it.x - lastEnd > it.size * 2) {
      segs.push(cur);
      cur = null;
    }
    if (!cur) cur = { y: line.y, x: it.x, xEnd: it.x + it.w, size: it.size, items: [], text: "" };
    const space = cur.text && it.x - lastEnd > it.size * 0.25 && !cur.text.endsWith(" ") && !it.str.startsWith(" ") ? " " : "";
    cur.text += space + it.str;
    cur.xEnd = Math.max(cur.xEnd, it.x + it.w);
    cur.items.push(it);
    lastEnd = it.x + it.w;
  }
  if (cur) segs.push(cur);
  return segs.filter((sg) => sg.text.trim());
}

/**
 * Group a page's text into positioned blocks: same size/weight/font, aligned, regular line gap.
 * Side-by-side columns are separate blocks because each baseline is split into segments first and
 * a segment may continue any recent block, not just the last one.
 */
export function blocksOf(page) {
  const segments = linesOf(page.items).flatMap(segmentsOf);
  const blocks = [];
  for (const seg of segments) {
    const bold = seg.items.filter((i) => i.bold).length > seg.items.length / 2;
    const font = fontFamilyOf(seg.items[0]?.fontFamily || seg.items[0]?.fontName || "");
    const fits = (cur) => {
      const prev = cur.lines[cur.lines.length - 1];
      const gap = seg.y - prev.y;
      const sameSize = Math.abs(seg.size - cur.size) < 1.2;
      const near = gap > 0 && gap <= Math.max(cur.size, seg.size) * 1.6;
      const regular = cur.lines.length < 2 || Math.abs(gap - cur.gap) <= Math.max(1.5, cur.size * 0.25);
      const tol = cur.size * 1.5;
      const aligned = Math.abs(seg.x - cur.x) <= tol || Math.abs((seg.x + seg.xEnd) / 2 - (cur.x + cur.xEnd) / 2) <= tol || Math.abs(seg.xEnd - cur.xEnd) <= tol;
      // a continuation must not sit beside the block (that would be a neighbouring column)
      const overlapsX = seg.x < cur.xEnd + cur.size && seg.xEnd > cur.x - cur.size;
      return sameSize && near && regular && aligned && overlapsX && cur.bold === bold && cur.font === font;
    };
    const home = blocks.slice(-12).reverse().find(fits);
    if (home) {
      home.lines.push(seg);
      home.x = Math.min(home.x, seg.x);
      home.xEnd = Math.max(home.xEnd, seg.xEnd);
      home.gap = (seg.y - home.lines[0].y) / (home.lines.length - 1);
      continue;
    }
    blocks.push({ lines: [seg], x: seg.x, xEnd: seg.xEnd, size: seg.size, bold, font, gap: seg.size * 1.2 });
  }
  // reading order: top to bottom, then left to right
  blocks.sort((a, b) => a.lines[0].y - b.lines[0].y || a.x - b.x);
  return blocks.map((b) => {
    const gap = Math.max(b.gap, b.size * 1.15);
    return {
      lines: b.lines.map((l) => l.text),
      x: b.x,
      xEnd: b.xEnd,
      top: frameTopOf(b.lines[0].y, b.size, gap),
      width: b.xEnd - b.x,
      height: gap * b.lines.length,
      size: b.size,
      bold: b.bold,
      font: b.font,
      gap,
      align: alignOf(b, page.width),
    };
  });
}

const NS_DOCX = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
const REL_IMG = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";

function imageExt(bytes) {
  return bytes[0] === 0xff && bytes[1] === 0xd8 ? "jpeg" : "png";
}

function picXml(rId, id, name, cx, cy) {
  return `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${id}" name="${esc(name)}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic>`;
}

function sectXml(page) {
  const w = twips(page.width);
  const h = twips(page.height);
  return `<w:type w:val="nextPage"/><w:pgSz w:w="${w}" w:h="${h}"${w > h ? ' w:orient="landscape"' : ""}/><w:pgMar w:top="0" w:right="0" w:bottom="0" w:left="0" w:header="0" w:footer="0" w:gutter="0"/>`;
}

/** A positioned paragraph (Word frame) anchored to the page. x, y, w, h in points. */
export function frameXml({ x, y, w, h, inner, line = 240, lineRule = "auto", jc = "left" }) {
  const pPr = `<w:framePr w:w="${twips(w)}" w:h="${twips(h)}" w:hRule="exact" w:hSpace="0" w:vSpace="0" w:wrap="none" w:hAnchor="page" w:vAnchor="page" w:x="${twips(Math.max(0, x))}" w:y="${twips(Math.max(0, y))}"/><w:spacing w:before="0" w:after="0" w:line="${line}" w:lineRule="${lineRule}"/>${jc !== "left" ? `<w:jc w:val="${jc}"/>` : ""}`;
  return `<w:p><w:pPr>${pPr}</w:pPr>${inner}</w:p>`;
}

/**
 * Exact-layout docx: one section per page at the page's size, text blocks as positioned frames,
 * raster images in place, optional rendered page background behind everything.
 * pages: from ctx.extractText; images: [[{ bytes, x, y, w, h }]] per page; backgrounds: [bytes|null] per page.
 */
export function buildDocxExact(pages, { images = [], backgrounds = [] } = {}) {
  let body = "";
  const media = [];
  let rels = `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`;
  let nextRel = 2;
  let drawingId = 1;
  const addMedia = (bytes, label) => {
    const ext = imageExt(bytes);
    const name = `image${media.length + 1}.${ext}`;
    media.push({ name: `word/media/${name}`, data: bytes });
    const rId = `rId${nextRel++}`;
    rels += `<Relationship Id="${rId}" Type="${REL_IMG}" Target="media/${name}"/>`;
    return { rId, label };
  };
  const stats = { blocks: 0, images: 0, backgrounds: 0 };

  pages.forEach((page, pi) => {
    let content = "";
    const bg = backgrounds[pi];
    if (bg) {
      const { rId } = addMedia(bg, `Page ${pi + 1} background`);
      const id = drawingId++;
      content += `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/></w:pPr><w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="0" behindDoc="1" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionV><wp:extent cx="${emu(page.width)}" cy="${emu(page.height)}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/><wp:docPr id="${id}" name="Page ${pi + 1} background"/><wp:cNvGraphicFramePr/>${picXml(rId, id, `Page ${pi + 1} background`, emu(page.width), emu(page.height))}</wp:anchor></w:drawing></w:r></w:p>`;
      stats.backgrounds++;
    }
    for (const img of images[pi] || []) {
      if (!img?.bytes?.length) continue;
      const { rId } = addMedia(img.bytes, `Image ${stats.images + 1}`);
      const id = drawingId++;
      const inner = `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${emu(img.w)}" cy="${emu(img.h)}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="${id}" name="Image ${stats.images + 1}"/><wp:cNvGraphicFramePr/>${picXml(rId, id, `Image ${stats.images + 1}`, emu(img.w), emu(img.h))}</wp:inline></w:drawing></w:r>`;
      content += frameXml({ x: img.x, y: img.y, w: img.w, h: img.h, inner });
      stats.images++;
    }
    for (const b of blocksOf(page)) {
      const sz = Math.round(Math.max(4, Math.min(200, b.size)) * 2);
      const rPr = `<w:rPr><w:rFonts w:ascii="${b.font}" w:hAnsi="${b.font}" w:cs="${b.font}"/>${b.bold ? "<w:b/>" : ""}<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/></w:rPr>`;
      const runs = b.lines.map((t, i) => `<w:r>${rPr}<w:t xml:space="preserve">${esc(t)}</w:t>${i < b.lines.length - 1 ? "<w:br/>" : ""}</w:r>`).join("");
      // Word measures with its own fonts: give the frame slack so lines never wrap before their <w:br/>
      const extra = b.width * 0.15 + b.size * 2;
      let x = b.x;
      let w = b.width + extra;
      if (b.align === "center") x = b.x - extra / 2;
      else if (b.align === "right") x = b.x - extra;
      x = Math.max(0, x);
      w = Math.min(w, page.width - x);
      content += frameXml({ x, y: b.top, w, h: b.height, inner: runs, line: twips(b.gap), lineRule: "exact", jc: b.align });
      stats.blocks++;
    }
    if (!content) content = "<w:p/>";
    body += content;
    if (pi < pages.length - 1) body += `<w:p><w:pPr><w:sectPr>${sectXml(page)}</w:sectPr></w:pPr></w:p>`;
  });
  const last = pages[pages.length - 1] || { width: 595.28, height: 841.89 };
  const document = XML + `<w:document ${NS_DOCX}><w:body>${body || "<w:p/>"}<w:sectPr>${sectXml(last)}</w:sectPr></w:body></w:document>`;
  const ct = XML + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`;
  const bytes = zipFiles(
    [
      { name: "[Content_Types].xml", data: enc(ct) },
      { name: "_rels/.rels", data: enc(RELS_ROOT("word/document.xml")) },
      { name: "word/document.xml", data: enc(document) },
      { name: "word/styles.xml", data: enc(STYLES_DOCX) },
      { name: "word/_rels/document.xml.rels", data: enc(XML + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`) },
      ...media,
    ],
    { level: 6 }
  );
  return { bytes, stats };
}

/** Should a page get a rendered background in "auto" mode? Vector-heavy or nearly empty pages, never pages with raster images. */
export function wantsBackground(page, images, mode = "auto") {
  if (mode === "always") return true;
  if (mode === "never") return false;
  if (images.length) return false;
  const chars = page.items.reduce((n, i) => n + i.str.length, 0);
  const vectorOps = images.vectorOps || 0;
  return chars < 40 || vectorOps > 200;
}

/**
 * layout: "exact" (default) keeps every block, image and page where it was; "flow" produces plain
 * paragraphs. background: "auto" | "always" | "never" renders the page behind the text (exact only).
 */
export async function pdfToDocx(files, { layout = "exact", background = "auto" } = {}, ctx = {}) {
  if (!ctx.extractText) throw new ToolError("Text extraction needs a browser.", "no_renderer");
  const file = files[0];
  const pages = await ctx.extractText(file.bytes, { password: file.password });
  if (layout === "flow") {
    const bytes = buildDocx(pages);
    const r = result(`${baseName(file.name)}.docx`, bytes, { kind: "docx", mime: MIME.docx, sizeBefore: file.size, pageCount: pages.length });
    r.stats = { layout, paragraphs: pages.reduce((n, p) => n + paragraphsOf(p).length, 0), scanned: pages.every((p) => !p.items.length) };
    return r;
  }
  const images = [];
  const backgrounds = [];
  for (let i = 0; i < pages.length; i++) {
    let imgs = [];
    if (ctx.pageImages) {
      try {
        imgs = await ctx.pageImages(file.bytes, i, { password: file.password });
      } catch {
        imgs = [];
      }
    }
    images.push(imgs);
    let bg = null;
    if (ctx.renderPage && wantsBackground(pages[i], imgs, background)) {
      try {
        bg = await ctx.renderPage(file.bytes, i, { scale: 2, format: "jpeg", quality: 0.85, password: file.password });
      } catch {
        bg = null;
      }
    }
    backgrounds.push(bg);
    ctx.onProgress?.((i + 1) / pages.length);
  }
  const { bytes, stats } = buildDocxExact(pages, { images, backgrounds });
  const r = result(`${baseName(file.name)}.docx`, bytes, { kind: "docx", mime: MIME.docx, sizeBefore: file.size, pageCount: pages.length });
  r.stats = { layout, ...stats, scanned: pages.every((p) => !p.items.length) };
  return r;
}

// ----------------------------------------------------------------- xlsx --------
export function colLetter(i) {
  let s = "";
  i++;
  while (i > 0) {
    const m = (i - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    i = Math.floor((i - 1) / 26);
  }
  return s;
}

/** "1,234.56", "$ 1.234,56", "(12)", "45 %" -> number; anything else -> null. */
export function parseNumber(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  let s = String(v ?? "").trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/^[-+]?\s*[$€£¥₹]\s*/, (m) => (m.includes("-") ? "-" : "")).replace(/\s*[$€£¥₹]$/, "").replace(/\s*%$/, "").replace(/\s+/g, "");
  if (!/^[-+]?[\d.,]+$/.test(s) || !/\d/.test(s)) return null;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    s = lastComma > lastDot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (lastComma >= 0) {
    const after = s.length - lastComma - 1;
    s = (s.match(/,/g) || []).length === 1 && after !== 3 ? s.replace(",", ".") : s.replace(/,/g, "");
  } else if ((s.match(/\./g) || []).length > 1) s = s.replace(/\./g, "");
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

/**
 * Column boundaries shared by a set of table lines: x positions where (almost) no row has ink.
 * Returns ascending x values; a cell belongs to the column counted by boundaries left of its centre.
 */
export function columnBoundaries(lines, { minGap = 4, emptyRatio = 0.3 } = {}) {
  const items = lines.flatMap((l) => l.items);
  if (!items.length || lines.length < 1) return [];
  const minX = Math.floor(Math.min(...items.map((i) => i.x)));
  const maxX = Math.ceil(Math.max(...items.map((i) => i.x + i.w)));
  const width = Math.max(1, maxX - minX);
  const cover = new Uint16Array(width + 1);
  for (const l of lines) {
    const row = new Uint8Array(width + 1);
    for (const it of l.items) {
      const a = Math.max(0, Math.floor(it.x - minX));
      const b = Math.min(width, Math.ceil(it.x + it.w - minX));
      for (let x = a; x <= b; x++) row[x] = 1;
    }
    for (let x = 0; x <= width; x++) cover[x] += row[x];
  }
  const limit = lines.length * emptyRatio;
  const bounds = [];
  let runStart = -1;
  for (let x = 0; x <= width + 1; x++) {
    const empty = x <= width && cover[x] <= limit;
    if (empty && runStart < 0) runStart = x;
    if (!empty && runStart >= 0) {
      const len = x - runStart;
      if (runStart > 0 && len >= minGap) bounds.push(minX + runStart + len / 2);
      runStart = -1;
    }
  }
  return bounds;
}

const colIndex = (bounds, x) => bounds.filter((b) => b < x).length;

/**
 * A page as a grid: table rows (lines with 2+ gap-separated cells) share page-wide column
 * boundaries; other lines become one cell. Returns { rows, header, widths }.
 */
export function tableOf(page) {
  const lines = linesOf(page.items).filter((l) => l.text.trim());
  const isTable = lines.map((l) => cellsOf(l).length >= 2);
  const first = isTable.indexOf(true);
  const last = isTable.lastIndexOf(true);
  const tableLines = lines.filter((_, i) => isTable[i]);
  const bounds = tableLines.length ? columnBoundaries(tableLines) : [];
  const rows = [];
  let header = -1;
  lines.forEach((line, i) => {
    const inRegion = first >= 0 && i >= first && i <= last;
    if (!inRegion || !bounds.length) {
      rows.push([line.text.trim()]);
      return;
    }
    const cells = [];
    for (const it of line.items) {
      const c = colIndex(bounds, it.x + it.w / 2);
      const prev = cells[c];
      cells[c] = prev === undefined ? it.str : prev + (prev.endsWith(" ") || it.str.startsWith(" ") || it.x - (prev.end ?? 0) < it.size * 0.2 ? "" : " ") + it.str;
    }
    const row = Array.from({ length: bounds.length + 1 }, (_, c) => (cells[c] ?? "").trim());
    if (header < 0 && isTable[i]) {
      const bold = line.items.filter((x) => x.bold).length > line.items.length / 2;
      const numeric = row.filter((c) => c && parseNumber(c) !== null).length;
      const next = lines[i + 1];
      const nextNumeric = next ? cellsOf(next).filter((c) => parseNumber(c) !== null).length : 0;
      if (bold || (numeric === 0 && nextNumeric > 0)) header = rows.length;
    }
    rows.push(row);
  });
  const cols = Math.max(1, ...rows.map((r) => r.length));
  const widths = Array.from({ length: cols }, (_, c) => Math.min(60, Math.max(8, ...rows.map((r) => String(r[c] ?? "").length + 2))));
  return { rows, header, widths };
}

const STYLES_XLSX = XML + `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

/**
 * sheets: [{ name, rows: (string|number)[][], header?: rowIndex (bold), widths?: number[] (chars) }]
 */
export function buildXlsx(sheets) {
  const files = [];
  let sheetsXml = "";
  let relsXml = `<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`;
  let overrides = "";
  sheets.forEach((sh, i) => {
    const n = i + 1;
    let rows = "";
    sh.rows.forEach((cells, ri) => {
      let cs = "";
      cells.forEach((v, ci) => {
        const ref = `${colLetter(ci)}${ri + 1}`;
        const style = sh.header === ri ? ' s="1"' : "";
        const num = typeof v === "number" ? v : /^-?\d+(\.\d+)?$/.test(String(v).trim()) ? Number(v) : parseNumber(v);
        if (v === "" || v == null) return;
        cs += num !== null && Number.isFinite(num) ? `<c r="${ref}"${style}><v>${num}</v></c>` : `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
      });
      rows += `<row r="${ri + 1}">${cs}</row>`;
    });
    const cols = sh.widths?.length ? `<cols>${sh.widths.map((w, c) => `<col min="${c + 1}" max="${c + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>` : "";
    files.push({ name: `xl/worksheets/sheet${n}.xml`, data: enc(XML + `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${cols}<sheetData>${rows}</sheetData></worksheet>`) });
    sheetsXml += `<sheet name="${esc(sh.name.slice(0, 31))}" sheetId="${n}" r:id="rId${n}"/>`;
    relsXml += `<Relationship Id="rId${n}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${n}.xml"/>`;
    overrides += `<Override PartName="/xl/worksheets/sheet${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`;
  });
  files.push(
    { name: "[Content_Types].xml", data: enc(XML + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${overrides}</Types>`) },
    { name: "_rels/.rels", data: enc(RELS_ROOT("xl/workbook.xml")) },
    { name: "xl/workbook.xml", data: enc(XML + `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheetsXml}</sheets></workbook>`) },
    { name: "xl/styles.xml", data: enc(STYLES_XLSX) },
    { name: "xl/_rels/workbook.xml.rels", data: enc(XML + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relsXml}</Relationships>`) }
  );
  return zipFiles(files, { level: 6 });
}

export async function pdfToXlsx(files, {} = {}, ctx = {}) {
  if (!ctx.extractText) throw new ToolError("Text extraction needs a browser.", "no_renderer");
  const file = files[0];
  const pages = await ctx.extractText(file.bytes, { password: file.password });
  const sheets = pages.map((p, i) => ({ name: `Page ${i + 1}`, ...tableOf(p) }));
  const bytes = buildXlsx(sheets.length ? sheets : [{ name: "Page 1", rows: [] }]);
  const r = result(`${baseName(file.name)}.xlsx`, bytes, { kind: "xlsx", mime: MIME.xlsx, sizeBefore: file.size, pageCount: pages.length });
  r.stats = { rows: sheets.reduce((n, s) => n + s.rows.length, 0), tables: sheets.filter((s) => s.header >= 0).length };
  return r;
}

// ----------------------------------------------------------------- pptx --------
const NS_P = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const REL_SLIDE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide";
const REL_NOTES = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide";
const REL_IMAGE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";
const REL_LAYOUT = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout";
const REL_MASTER = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster";
const REL_NMASTER = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster";
const REL_THEME = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme";
const rel = (id, type, target) => `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`;
const RELS = (inner) => XML + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${inner}</Relationships>`;
const THEME = XML + `<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Inkfold"><a:themeElements><a:clrScheme name="Inkfold"><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1B1F2A"/></a:dk2><a:lt2><a:srgbClr val="F1EFE9"/></a:lt2><a:accent1><a:srgbClr val="1F5EFF"/></a:accent1><a:accent2><a:srgbClr val="1A7F4B"/></a:accent2><a:accent3><a:srgbClr val="9A6700"/></a:accent3><a:accent4><a:srgbClr val="7C3AED"/></a:accent4><a:accent5><a:srgbClr val="C62828"/></a:accent5><a:accent6><a:srgbClr val="0E7490"/></a:accent6><a:hlink><a:srgbClr val="1F5EFF"/></a:hlink><a:folHlink><a:srgbClr val="7C3AED"/></a:folHlink></a:clrScheme><a:fontScheme name="Inkfold"><a:majorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Inkfold"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;
const EMPTY_TREE = `<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld>`;
const MASTER = XML + `<p:sldMaster ${NS_P}>${EMPTY_TREE}<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`;
const LAYOUT = XML + `<p:sldLayout ${NS_P} type="blank" preserve="1">${EMPTY_TREE}<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;
const NOTES_MASTER = XML + `<p:notesMaster ${NS_P}>${EMPTY_TREE}<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/></p:notesMaster>`;

/**
 * slides: [{ image: Uint8Array (JPEG), width, height, notes }]
 * The slide size follows the first page's aspect ratio (10in wide).
 */
export function buildPptx(slides) {
  const first = slides[0] || { width: 4, height: 3 };
  const cx = 9144000;
  const cy = Math.round((cx * first.height) / first.width);
  const files = [];
  let sldIds = "";
  let presRels = rel("rId1", REL_MASTER, "slideMasters/slideMaster1.xml") + rel("rId2", REL_NMASTER, "notesMasters/notesMaster1.xml") + rel("rId3", REL_THEME, "theme/theme1.xml");
  let overrides = "";
  slides.forEach((s, i) => {
    const n = i + 1;
    const rid = `rId${n + 3}`;
    sldIds += `<p:sldId id="${256 + n}" r:id="${rid}"/>`;
    presRels += rel(rid, REL_SLIDE, `slides/slide${n}.xml`);
    // fit the picture on the slide, centred
    const scale = Math.min(cx / s.width, cy / s.height);
    const w = Math.round(s.width * scale);
    const h = Math.round(s.height * scale);
    const x = Math.round((cx - w) / 2);
    const y = Math.round((cy - h) / 2);
    const slide = XML + `<p:sld ${NS_P}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr><p:pic><p:nvPicPr><p:cNvPr id="2" name="Page ${n}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
    files.push({ name: `ppt/slides/slide${n}.xml`, data: enc(slide) });
    files.push({ name: `ppt/slides/_rels/slide${n}.xml.rels`, data: enc(RELS(rel("rId1", REL_LAYOUT, "../slideLayouts/slideLayout1.xml") + rel("rId2", REL_IMAGE, `../media/image${n}.jpeg`) + rel("rId3", REL_NOTES, `../notesSlides/notesSlide${n}.xml`))) });
    files.push({ name: `ppt/media/image${n}.jpeg`, data: s.image });
    const notes = XML + `<p:notes ${NS_P}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr><p:sp><p:nvSpPr><p:cNvPr id="2" name="Notes"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>${(s.notes || "").split("\n").filter((l) => l.trim()).map((l) => `<a:p><a:r><a:rPr lang="en-US"/><a:t>${esc(l)}</a:t></a:r></a:p>`).join("") || "<a:p/>"}</p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`;
    files.push({ name: `ppt/notesSlides/notesSlide${n}.xml`, data: enc(notes) });
    files.push({ name: `ppt/notesSlides/_rels/notesSlide${n}.xml.rels`, data: enc(RELS(rel("rId1", REL_NMASTER, "../notesMasters/notesMaster1.xml") + rel("rId2", REL_SLIDE, `../slides/slide${n}.xml`))) });
    overrides += `<Override PartName="/ppt/slides/slide${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/><Override PartName="/ppt/notesSlides/notesSlide${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>`;
  });
  files.push(
    { name: "[Content_Types].xml", data: enc(XML + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpeg" ContentType="image/jpeg"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/notesMasters/notesMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>${overrides}</Types>`) },
    { name: "_rels/.rels", data: enc(RELS_ROOT("ppt/presentation.xml")) },
    { name: "ppt/presentation.xml", data: enc(XML + `<p:presentation ${NS_P}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:notesMasterIdLst><p:notesMasterId r:id="rId2"/></p:notesMasterIdLst><p:sldIdLst>${sldIds}</p:sldIdLst><p:sldSz cx="${cx}" cy="${cy}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`) },
    { name: "ppt/_rels/presentation.xml.rels", data: enc(RELS(presRels)) },
    { name: "ppt/slideMasters/slideMaster1.xml", data: enc(MASTER) },
    { name: "ppt/slideMasters/_rels/slideMaster1.xml.rels", data: enc(RELS(rel("rId1", REL_LAYOUT, "../slideLayouts/slideLayout1.xml") + rel("rId2", REL_THEME, "../theme/theme1.xml"))) },
    { name: "ppt/slideLayouts/slideLayout1.xml", data: enc(LAYOUT) },
    { name: "ppt/slideLayouts/_rels/slideLayout1.xml.rels", data: enc(RELS(rel("rId1", REL_MASTER, "../slideMasters/slideMaster1.xml"))) },
    { name: "ppt/notesMasters/notesMaster1.xml", data: enc(NOTES_MASTER) },
    { name: "ppt/notesMasters/_rels/notesMaster1.xml.rels", data: enc(RELS(rel("rId1", REL_THEME, "../theme/theme1.xml"))) },
    { name: "ppt/theme/theme1.xml", data: enc(THEME) }
  );
  return zipFiles(files, { level: 6 });
}

export async function pdfToPptx(files, { dpi = 110 } = {}, ctx = {}) {
  if (!ctx.renderPage || !ctx.extractText) throw new ToolError("Rendering needs a browser.", "no_renderer");
  const file = files[0];
  const pages = await ctx.extractText(file.bytes, { password: file.password });
  const slides = [];
  for (let i = 0; i < pages.length; i++) {
    const image = await ctx.renderPage(file.bytes, i, { scale: Number(dpi) / 72, format: "jpeg", quality: 0.85, password: file.password });
    slides.push({ image, width: pages[i].width, height: pages[i].height, notes: pages[i].text });
    ctx.onProgress?.((i + 1) / pages.length);
  }
  const bytes = buildPptx(slides);
  return result(`${baseName(file.name)}.pptx`, bytes, { kind: "pptx", mime: MIME.pptx, sizeBefore: file.size, pageCount: slides.length });
}
