// Office Open XML readers (docx / xlsx / pptx) -> PDF, plus the tiny XML parser the
// other converters share. Everything is a ZIP of XML; no library needed.
import { PDFDocument, result, baseName, saveDoc, ToolError } from "./core.js";
import { layoutBlocks, PAGE } from "./text.js";
import { layoutTable } from "./table.js";
import { unzip, utf8 } from "../zip.js";
import { decodeEntities } from "./convertText.js";

// ---------------------------------------------------------------- XML --------
/** Minimal XML -> tree: { name, attrs, children, text? }. Namespace prefixes are kept in names. */
export function parseXml(src) {
  const root = { name: "#root", attrs: {}, children: [] };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/([^\s>]+)\s*>|<([^\s/>]+)((?:\s+[^\s=\/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(src))) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) top.children.push({ name: "#text", text: m[1] });
    else if (m[2]) {
      // closing tag: pop to the matching element
      for (let i = stack.length - 1; i > 0; i--) if (stack[i].name === m[2]) (stack.length = i), (i = 0);
    } else if (m[3]) {
      const attrs = {};
      const ar = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
      let a;
      while ((a = ar.exec(m[4] || ""))) attrs[a[1]] = decodeEntities(a[2] ?? a[3] ?? a[4] ?? "");
      const el = { name: m[3], attrs, children: [] };
      top.children.push(el);
      if (!m[5]) stack.push(el);
    } else if (m[6] !== undefined) {
      if (m[6].trim() || top.name !== "#root") top.children.push({ name: "#text", text: decodeEntities(m[6]) });
    }
  }
  return root;
}
const local = (n) => (n.includes(":") ? n.slice(n.indexOf(":") + 1) : n);
export function find(node, name) {
  for (const c of node.children || []) {
    if (c.name === name || local(c.name) === name) return c;
    const r = find(c, name);
    if (r) return r;
  }
  return null;
}
export function findAll(node, name, out = []) {
  for (const c of node.children || []) {
    if (c.name === name || local(c.name) === name) out.push(c);
    else findAll(c, name, out);
  }
  return out;
}
export function kids(node, name) {
  return (node.children || []).filter((c) => c.name === name || local(c.name) === name);
}
export function textOf(node) {
  if (!node) return "";
  if (node.name === "#text") return node.text;
  return (node.children || []).map(textOf).join("");
}
export const attr = (node, name) => {
  if (!node) return undefined;
  if (name in node.attrs) return node.attrs[name];
  for (const k of Object.keys(node.attrs)) if (local(k) === name) return node.attrs[k];
  return undefined;
};

// ------------------------------------------------------------ helpers --------
export function readZip(file, label) {
  try {
    return unzip(file.bytes);
  } catch {
    throw new ToolError(`${file.name} is not a ${label} file.`, "not_" + label);
  }
}
export function xmlOf(entries, path) {
  const e = entries[path];
  return e ? parseXml(utf8(e)) : null;
}
/** rels file -> { rId: target(path relative to base dir) } */
export function readRels(entries, relsPath, baseDir) {
  const out = {};
  const x = xmlOf(entries, relsPath);
  if (!x) return out;
  for (const r of findAll(x, "Relationship")) {
    let t = attr(r, "Target") || "";
    if (attr(r, "TargetMode") === "External") continue;
    t = t.startsWith("/") ? t.slice(1) : normalize(baseDir + "/" + t);
    out[attr(r, "Id")] = t;
  }
  return out;
}
export function normalize(p) {
  const parts = [];
  for (const seg of p.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg && seg !== ".") parts.push(seg);
  }
  return parts.join("/");
}
const EMU = 12700; // EMU per point
export const HEADING_SIZE = { 1: 22, 2: 18, 3: 15, 4: 13, 5: 12, 6: 11 };

// --------------------------------------------------------------- docx --------
export function docxToBlocks(entries) {
  const doc = xmlOf(entries, "word/document.xml");
  if (!doc) throw new ToolError("No word/document.xml inside. Is this really a .docx?", "bad_docx");
  const rels = readRels(entries, "word/_rels/document.xml.rels", "word");
  const numFmt = numberingFormats(entries);
  const body = find(doc, "body");
  const blocks = [];
  const counters = {};
  const walk = (node) => {
    for (const el of node.children || []) {
      const n = local(el.name);
      if (n === "p") blocks.push(...paragraph(el, rels, entries, numFmt, counters));
      else if (n === "tbl") blocks.push({ table: tableRows(el) , spaceAfter: 8 });
      else if (n === "sdt" || n === "sdtContent" || n === "smartTag" || n === "ins") walk(el);
      else if (n === "sectPr" || n === "del") continue;
    }
  };
  walk(body);
  return blocks.length ? blocks : [{ text: "" }];
}

function numberingFormats(entries) {
  const x = xmlOf(entries, "word/numbering.xml");
  const abstracts = {};
  const nums = {};
  if (!x) return nums;
  for (const a of findAll(x, "abstractNum")) {
    const lvls = {};
    for (const l of kids(a, "w:lvl")) lvls[attr(l, "ilvl")] = attr(find(l, "numFmt"), "val") || "bullet";
    abstracts[attr(a, "abstractNumId")] = lvls;
  }
  for (const nnode of findAll(x, "num")) {
    const aid = attr(find(nnode, "abstractNumId"), "val");
    nums[attr(nnode, "numId")] = abstracts[aid] || {};
  }
  return nums;
}

function tableRows(tbl) {
  return findAll(tbl, "tr").map((tr) => kids(tr, "w:tc").map((tc) => findAll(tc, "p").map((p) => textOf(p)).join(" ").trim()));
}

function paragraph(p, rels, entries, numFmt, counters) {
  const out = [];
  const pPr = kids(p, "w:pPr")[0];
  const style = attr(find(pPr || { children: [] }, "pStyle"), "val") || "";
  let size, bold = false, align;
  const hm = style.match(/^(?:Heading|heading|Titre|berschrift)(\d)$/) || style.match(/^Heading(\d)/);
  if (hm) (size = HEADING_SIZE[hm[1]] || 12), (bold = true);
  else if (/^(Title|Titre)$/i.test(style)) (size = 26), (bold = true);
  else if (/^Subtitle$/i.test(style)) (size = 16);
  const jc = attr(find(pPr || { children: [] }, "jc"), "val");
  if (jc === "center") align = "center";
  if (jc === "right" || jc === "end") align = "right";
  let prefix = "";
  const numPr = pPr && find(pPr, "numPr");
  if (numPr) {
    const numId = attr(find(numPr, "numId"), "val");
    const ilvl = attr(find(numPr, "ilvl"), "val") || "0";
    const fmt = (numFmt[numId] || {})[ilvl] || "bullet";
    if (fmt === "bullet" || fmt === "none") prefix = fmt === "none" ? "" : "• ";
    else {
      const key = `${numId}:${ilvl}`;
      counters[key] = (counters[key] || 0) + 1;
      prefix = `${counters[key]}. `;
    }
    var indent = 14 + 14 * Number(ilvl);
  }
  let text = "";
  let anyBold = false, runs = 0;
  const flushText = () => {
    if (text.trim() || !out.length) out.push({ text: prefix + text, size, bold: bold || (runs > 0 && anyBold), align, indent });
    text = "";
    prefix = "";
  };
  const visit = (node) => {
    for (const el of node.children || []) {
      const n = local(el.name);
      if (n === "r" || n === "hyperlink" || n === "ins" || n === "smartTag" || n === "sdt" || n === "sdtContent" || n === "fldSimple") {
        if (n === "r") {
          runs++;
          const rPr = kids(el, "w:rPr")[0];
          const b = rPr && find(rPr, "b");
          if (b && attr(b, "val") !== "0" && attr(b, "val") !== "false") anyBold = true;
        }
        visit(el);
      } else if (n === "t") text += textOf(el);
      else if (n === "tab") text += "    ";
      else if (n === "br") {
        if (attr(el, "type") === "page") (flushText(), out.push({ pageBreak: true }));
        else text += "\n";
      } else if (n === "drawing" || n === "pict") {
        const blip = find(el, "blip");
        const id = blip && (attr(blip, "embed") || attr(blip, "link"));
        const ext = find(el, "extent");
        const target = id && rels[id];
        if (target && entries[target]) {
          flushText();
          const w = ext ? Number(attr(ext, "cx")) / EMU : undefined;
          const h = ext ? Number(attr(ext, "cy")) / EMU : undefined;
          out.push({ image: entries[target], width: w, height: h, align: align || "left" });
        }
      } else if (n === "delText" || n === "rPr" || n === "pPr") continue;
      else if (n === "sym") text += "•";
      else visit(el);
    }
  };
  visit(p);
  if (text !== "" || !out.length) flushText();
  // a bold-only paragraph of normal style reads like a heading; give it a hair more space
  return out;
}

export async function docxToPdf(files, { pageSize = "a4" } = {}, ctx = {}) {
  const file = files[0];
  const entries = readZip(file, "docx");
  const blocks = docxToBlocks(entries);
  const doc = await PDFDocument.create({ updateMetadata: false });
  await layoutBlocks(doc, blocks, { pageSize, toPng: ctx.toPng });
  return result(`${baseName(file.name)}.pdf`, await saveDoc(doc), { sizeBefore: file.size, pageCount: doc.getPageCount() });
}

// --------------------------------------------------------------- xlsx --------
export function colIndex(ref) {
  const m = String(ref).match(/^([A-Z]+)/);
  if (!m) return 0;
  let n = 0;
  for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function xlsxToSheets(entries) {
  const wb = xmlOf(entries, "xl/workbook.xml");
  if (!wb) throw new ToolError("No xl/workbook.xml inside. Is this really a .xlsx?", "bad_xlsx");
  const rels = readRels(entries, "xl/_rels/workbook.xml.rels", "xl");
  const shared = [];
  const ss = xmlOf(entries, "xl/sharedStrings.xml");
  if (ss) for (const si of findAll(ss, "si")) shared.push(findAll(si, "t").map(textOf).join(""));
  const sheets = [];
  for (const s of findAll(wb, "sheet")) {
    const path = rels[attr(s, "r:id")];
    const x = path && xmlOf(entries, path);
    if (!x) continue;
    const rows = [];
    for (const r of findAll(x, "row")) {
      const cells = [];
      for (const c of kids(r, "c")) {
        const t = attr(c, "t");
        const v = find(c, "v");
        let val = "";
        if (t === "s") val = shared[Number(textOf(v))] ?? "";
        else if (t === "inlineStr") val = findAll(c, "t").map(textOf).join("");
        else if (t === "b") val = textOf(v) === "1" ? "TRUE" : "FALSE";
        else val = v ? textOf(v) : "";
        if (!t && val !== "" && !Number.isNaN(Number(val))) {
          const n = Number(val);
          val = Number.isInteger(n) ? String(n) : String(Math.round(n * 1e6) / 1e6);
        }
        cells[colIndex(attr(c, "r") || "")] = val;
      }
      rows.push(Array.from(cells, (c) => c ?? ""));
    }
    const width = Math.max(0, ...rows.map((r) => r.length));
    sheets.push({ name: attr(s, "name") || `Sheet${sheets.length + 1}`, rows: rows.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? "")) });
  }
  return sheets;
}

export async function xlsxToPdf(files, { pageSize = "a4", landscape = true } = {}) {
  const file = files[0];
  const sheets = xlsxToSheets(readZip(file, "xlsx"));
  if (!sheets.length) throw new ToolError("The workbook has no sheets.", "empty");
  const doc = await PDFDocument.create({ updateMetadata: false });
  for (const s of sheets) await layoutTable(doc, s.rows.length ? s.rows : [[""]], { pageSize, landscape: !!landscape, header: true, title: s.name });
  const r = result(`${baseName(file.name)}.pdf`, await saveDoc(doc), { sizeBefore: file.size, pageCount: doc.getPageCount() });
  r.stats = { sheets: sheets.length };
  return r;
}

// --------------------------------------------------------------- pptx --------
export function pptxToSlides(entries) {
  const pres = xmlOf(entries, "ppt/presentation.xml");
  if (!pres) throw new ToolError("No ppt/presentation.xml inside. Is this really a .pptx?", "bad_pptx");
  const rels = readRels(entries, "ppt/_rels/presentation.xml.rels", "ppt");
  const sz = find(pres, "sldSz");
  const size = sz ? [Number(attr(sz, "cx")) / EMU, Number(attr(sz, "cy")) / EMU] : [720, 405];
  const slides = [];
  for (const id of findAll(pres, "sldId")) {
    const path = rels[attr(id, "r:id")];
    const x = path && xmlOf(entries, path);
    if (!x) continue;
    const srels = readRels(entries, path.replace(/slides\/([^/]+)$/, "slides/_rels/$1.rels"), "ppt/slides");
    const blocks = [];
    const tree = find(x, "spTree") || x;
    for (const el of tree.children || []) {
      const n = local(el.name);
      if (n === "sp") {
        const ph = find(el, "ph");
        const isTitle = ph && /title|ctrTitle/.test(attr(ph, "type") || "");
        for (const p of findAll(el, "p")) {
          const t = findAll(p, "t").map(textOf).join("");
          if (!t.trim()) continue;
          const lvl = Number(attr(find(p, "pPr"), "lvl") || 0);
          blocks.push(isTitle ? { text: t, size: 24, bold: true } : { text: (lvl ? "• " : "") + t, size: 14, indent: lvl * 16 });
        }
      } else if (n === "pic") {
        const blip = find(el, "blip");
        const target = blip && srels[attr(blip, "embed")];
        const ext = find(el, "ext");
        if (target && entries[target]) blocks.push({ image: entries[target], width: ext ? Number(attr(ext, "cx")) / EMU : undefined, height: ext ? Number(attr(ext, "cy")) / EMU : undefined });
      } else if (n === "graphicFrame") {
        const tbl = find(el, "tbl");
        if (tbl) blocks.push({ table: findAll(tbl, "tr").map((tr) => kids(tr, "a:tc").map((tc) => findAll(tc, "t").map(textOf).join(""))) });
      }
    }
    slides.push({ blocks });
  }
  return { size, slides };
}

export async function pptxToPdf(files, {} = {}, ctx = {}) {
  const file = files[0];
  const { size, slides } = pptxToSlides(readZip(file, "pptx"));
  if (!slides.length) throw new ToolError("The presentation has no slides.", "empty");
  const doc = await PDFDocument.create({ updateMetadata: false });
  for (let i = 0; i < slides.length; i++) {
    const before = doc.getPageCount();
    await layoutBlocks(doc, slides[i].blocks.length ? slides[i].blocks : [{ text: "" }], { pageSize: size, margin: 36, toPng: ctx.toPng });
    // keep one page per slide: if layout overflowed, drop the overflow pages
    while (doc.getPageCount() > before + 1) doc.removePage(doc.getPageCount() - 1);
  }
  const r = result(`${baseName(file.name)}.pdf`, await saveDoc(doc), { sizeBefore: file.size, pageCount: doc.getPageCount() });
  r.stats = { slides: slides.length };
  return r;
}

export { PAGE };
