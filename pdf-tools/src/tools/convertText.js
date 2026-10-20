// Text-ish inputs to PDF: TXT, CSV, RTF, HTML, Markdown-ish, ZIP bundles. Plus PDF/A.
import { PDFDocument, result, baseName, loadDoc, saveDoc, ToolError, degrees } from "./core.js";
import { layoutBlocks, textToDoc } from "./text.js";
import { layoutTable, parseCsv } from "./table.js";
import { unzip, utf8 } from "../zip.js";
import { imagesToPdf } from "./images.js";

export function decodeText(bytes) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

export async function txtToPdf(files, { pageSize = "a4", fontSize = 11, mono = false } = {}) {
  const file = files[0];
  const text = decodeText(file.bytes);
  const doc = await textToDoc(text, { pageSize, size: Number(fontSize) || 11, mono: !!mono });
  return result(`${baseName(file.name)}.pdf`, await saveDoc(doc), { sizeBefore: file.size, pageCount: doc.getPageCount() });
}

export async function csvToPdf(files, { landscape = false, header = true, fontSize = 9 } = {}) {
  const file = files[0];
  const rows = parseCsv(decodeText(file.bytes));
  if (!rows.length) throw new ToolError("The CSV is empty.", "empty");
  const doc = await PDFDocument.create({ updateMetadata: false });
  await layoutTable(doc, rows, { landscape: !!landscape, header: !!header, size: Number(fontSize) || 9, title: baseName(file.name) });
  const r = result(`${baseName(file.name)}.pdf`, await saveDoc(doc), { sizeBefore: file.size, pageCount: doc.getPageCount() });
  r.stats = { rows: rows.length, columns: Math.max(...rows.map((x) => x.length)) };
  return r;
}

/** Minimal RTF -> paragraphs. Handles groups to skip, \par, \line, hex and unicode escapes, bold toggles. */
export function rtfToBlocks(rtf) {
  const SKIP = new Set(["fonttbl", "colortbl", "stylesheet", "info", "pict", "object", "header", "footer", "xmlnstbl", "listtable", "listoverridetable", "rsidtbl", "generator", "themedata", "colorschememapping", "latentstyles", "datastore"]);
  const blocks = [];
  let cur = "";
  let bold = false;
  let size = 11;
  const stack = [];
  let skipDepth = 0;
  let i = 0;
  const flush = () => {
    blocks.push({ text: cur.replace(/\s+$/, ""), bold, size, spaceAfter: size * 0.4 });
    cur = "";
  };
  let ucSkip = 1;
  let pendingSkip = 0;
  while (i < rtf.length) {
    const c = rtf[i];
    if (c === "{") {
      stack.push({ bold, size, skip: skipDepth > 0 });
      if (skipDepth > 0) skipDepth++;
      // look ahead for \*\name or \name right after the brace
      const m = rtf.slice(i + 1, i + 40).match(/^\\\*?\\?([a-z]+)/);
      if (m && (SKIP.has(m[1]) || rtf[i + 1] === "\\" && rtf[i + 2] === "*")) skipDepth = Math.max(skipDepth, 1);
      i++;
      continue;
    }
    if (c === "}") {
      const st = stack.pop() || {};
      if (skipDepth > 0) skipDepth--;
      bold = st.bold ?? bold;
      size = st.size ?? size;
      i++;
      continue;
    }
    if (c === "\\") {
      const m = rtf.slice(i).match(/^\\([a-zA-Z]+)(-?\d+)? ?/);
      if (m) {
        const [, word, num] = m;
        i += m[0].length;
        if (skipDepth > 0) continue;
        if (word === "par" || word === "line" || word === "sect" || word === "page") flush();
        else if (word === "tab") cur += "    ";
        else if (word === "b") bold = num !== "0";
        else if (word === "fs") size = Math.max(6, Math.round(Number(num) / 2));
        else if (word === "uc") ucSkip = Number(num) || 1;
        else if (word === "u") {
          let code = Number(num);
          if (code < 0) code += 65536;
          cur += String.fromCharCode(code);
          pendingSkip = ucSkip;
        } else if (word === "emdash") cur += "—";
        else if (word === "endash") cur += "–";
        else if (word === "lquote") cur += "‘";
        else if (word === "rquote") cur += "’";
        else if (word === "ldblquote") cur += "“";
        else if (word === "rdblquote") cur += "”";
        else if (word === "bullet") cur += "•";
        continue;
      }
      const hex = rtf.slice(i).match(/^\\'([0-9a-fA-F]{2})/);
      if (hex) {
        i += 4;
        if (skipDepth > 0) continue;
        if (pendingSkip > 0) {
          pendingSkip--;
          continue;
        }
        cur += new TextDecoder("windows-1252").decode(new Uint8Array([parseInt(hex[1], 16)]));
        continue;
      }
      // escaped char: \{ \} \\ or \~ etc.
      const ch = rtf[i + 1];
      i += 2;
      if (skipDepth > 0) continue;
      if (ch === "~") cur += " ";
      else if (ch === "\n" || ch === "\r") flush();
      else if (ch !== undefined) cur += ch;
      continue;
    }
    i++;
    if (skipDepth > 0 || c === "\r" || c === "\n") continue;
    if (pendingSkip > 0) {
      pendingSkip--;
      continue;
    }
    cur += c;
  }
  if (cur.trim()) flush();
  return blocks.length ? blocks : [{ text: "" }];
}

export async function rtfToPdf(files, { pageSize = "a4" } = {}) {
  const file = files[0];
  const text = decodeText(file.bytes);
  if (!/^\s*\{\\rtf/.test(text)) throw new ToolError(`${file.name} is not an RTF file.`, "not_rtf");
  const doc = await PDFDocument.create({ updateMetadata: false });
  await layoutBlocks(doc, rtfToBlocks(text), { pageSize });
  return result(`${baseName(file.name)}.pdf`, await saveDoc(doc), { sizeBefore: file.size, pageCount: doc.getPageCount() });
}

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "—", ndash: "–", hellip: "…", copy: "©", reg: "®", laquo: "«", raquo: "»", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", bull: "•", middot: "·", euro: "€", pound: "£", yen: "¥" };
export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") return String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENT[e.toLowerCase()] ?? m;
  });
}

/** HTML -> text blocks (headings, paragraphs, lists, tables flattened to rows). Regex-based so it works in Node too. */
export function htmlToBlocks(html) {
  let s = String(html)
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|head|noscript|svg|template)[\s\S]*?<\/\1>/gi, "")
    .replace(/\r?\n|\t/g, " ");
  const blocks = [];
  const push = (text, extra = {}) => {
    const t = decodeEntities(text.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim());
    if (t) blocks.push({ text: t, ...extra });
  };
  // split on block-level tags
  const re = /<(h[1-6]|p|li|tr|div|br|hr|blockquote|pre|section|article|header|footer|td|th|dt|dd|title)\b[^>]*>|<\/(h[1-6]|p|li|tr|div|blockquote|pre|section|article|header|footer|dt|dd|table|ul|ol|title)>/gi;
  let last = 0;
  let tag = null;
  let m;
  const sizes = { h1: 22, h2: 18, h3: 15, h4: 13, h5: 12, h6: 11, title: 22 };
  const flushChunk = (end) => {
    const chunk = s.slice(last, end);
    if (!tag) push(chunk);
    else if (tag === "li") push("• " + chunk, { indent: 14 });
    else if (sizes[tag]) push(chunk, { size: sizes[tag], bold: true, spaceAfter: sizes[tag] * 0.5 });
    else if (tag === "pre") push(chunk, { mono: true });
    else if (tag === "blockquote") push(chunk, { indent: 20 });
    else if (tag === "td" || tag === "th") push(chunk, { indent: 10 });
    else push(chunk);
  };
  while ((m = re.exec(s))) {
    flushChunk(m.index);
    last = m.index + m[0].length;
    const open = m[1]?.toLowerCase();
    if (open === "br") blocks.push({ text: "" });
    else if (open === "hr") blocks.push({ text: "" });
    tag = open && !["br", "hr"].includes(open) ? open : null;
  }
  flushChunk(s.length);
  // title block first if present
  return blocks.length ? blocks : [{ text: "" }];
}

export async function htmlToPdf(files, { pageSize = "a4" } = {}) {
  const file = files[0];
  const html = decodeText(file.bytes);
  const doc = await PDFDocument.create({ updateMetadata: false });
  await layoutBlocks(doc, htmlToBlocks(html), { pageSize });
  return result(`${baseName(file.name)}.pdf`, await saveDoc(doc), { sizeBefore: file.size, pageCount: doc.getPageCount() });
}

const IMG_RE = /\.(jpe?g|png|webp|gif|bmp)$/i;
const TXT_RE = /\.(txt|md|markdown|log|json|xml|yml|yaml|ini|cfg)$/i;

/** ZIP -> one PDF: every PDF, image, text and CSV inside, in path order. Other entries are listed as skipped. */
export async function zipToPdf(files, { pageSize = "a4" } = {}, ctx = {}) {
  const file = files[0];
  let entries;
  try {
    entries = unzip(file.bytes);
  } catch {
    throw new ToolError(`${file.name} is not a ZIP archive.`, "not_zip");
  }
  const names = Object.keys(entries)
    .filter((n) => !n.endsWith("/") && !/(^|\/)(__MACOSX|\.)/.test(n))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const out = await PDFDocument.create({ updateMetadata: false });
  const skipped = [];
  let used = 0;
  for (const name of names) {
    const data = entries[name];
    if (!data.length) continue;
    try {
      let part = null;
      if (/\.pdf$/i.test(name)) part = await loadDoc({ name, bytes: data });
      else if (IMG_RE.test(name)) part = await PDFDocument.load((await imagesToPdf([{ name, bytes: data, size: data.length }], { pageSize }, ctx)).bytes);
      else if (/\.csv$/i.test(name)) {
        part = await PDFDocument.create();
        await layoutTable(part, parseCsv(decodeText(data)), { title: name, pageSize });
      } else if (/\.rtf$/i.test(name)) {
        part = await PDFDocument.create();
        await layoutBlocks(part, rtfToBlocks(decodeText(data)), { pageSize });
      } else if (/\.html?$/i.test(name)) {
        part = await PDFDocument.create();
        await layoutBlocks(part, htmlToBlocks(decodeText(data)), { pageSize });
      } else if (TXT_RE.test(name)) part = await textToDoc(decodeText(data), { pageSize, mono: /\.(json|xml|yml|yaml|log|ini|cfg)$/i.test(name) });
      if (!part) {
        skipped.push(name);
        continue;
      }
      const pages = await out.copyPages(part, part.getPageIndices());
      pages.forEach((p) => out.addPage(p));
      used++;
    } catch {
      skipped.push(name);
    }
  }
  if (!out.getPageCount()) throw new ToolError("Nothing in the ZIP could be turned into pages (PDF, images, TXT, CSV, RTF, HTML).", "empty");
  const r = result(`${baseName(file.name)}.pdf`, await saveDoc(out), { sizeBefore: file.size, pageCount: out.getPageCount() });
  r.stats = { used, skipped };
  return r;
}

/** PDF -> PDF/A (3B by default). Encrypted input is refused by the spec. */
export async function pdfToPdfa(files, { conformance = "3B" } = {}) {
  const file = files[0];
  const doc = await loadDoc(file);
  try {
    doc.convertToPDFA({ conformance });
  } catch (err) {
    throw new ToolError("Could not convert: " + String(err?.message || err).slice(0, 140), "pdfa_failed");
  }
  const bytes = await doc.save({ useObjectStreams: false, addDefaultPage: false });
  return result(`${baseName(file.name)}-pdfa.pdf`, bytes, { sizeBefore: file.size, pageCount: doc.getPageCount() });
}

export { degrees };
