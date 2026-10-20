// OpenDocument (odt / ods / odp) -> PDF. content.xml inside a ZIP.
import { PDFDocument, result, baseName, saveDoc, ToolError } from "./core.js";
import { layoutBlocks } from "./text.js";
import { layoutTable } from "./table.js";
import { parseXml, find, findAll, kids, textOf, attr, readZip, HEADING_SIZE } from "./office.js";
import { utf8 } from "../zip.js";

const local = (n) => (n.includes(":") ? n.slice(n.indexOf(":") + 1) : n);

function content(entries, label) {
  const e = entries["content.xml"];
  if (!e) throw new ToolError(`No content.xml inside. Is this really a .${label}?`, "bad_" + label);
  return parseXml(utf8(e));
}

/** style name -> { bold } from automatic + document styles */
function boldStyles(x, entries) {
  const set = new Set();
  const scan = (root) => {
    for (const st of findAll(root, "style")) {
      const tp = find(st, "text-properties");
      if (tp && /bold|[6-9]00/.test(attr(tp, "font-weight") || "")) set.add(attr(st, "name"));
    }
  };
  scan(x);
  const styles = entries["styles.xml"];
  if (styles) scan(parseXml(utf8(styles)));
  return set;
}

/** Inline text of a paragraph/heading: spans, spaces, tabs, line breaks. */
function inline(node) {
  let t = "";
  for (const c of node.children || []) {
    const n = local(c.name);
    if (c.name === "#text") t += c.text;
    else if (n === "s") t += " ".repeat(Number(attr(c, "c") || 1));
    else if (n === "tab") t += "    ";
    else if (n === "line-break") t += "\n";
    else if (n === "note" || n === "annotation" || n === "tracked-changes") continue;
    else t += inline(c);
  }
  return t;
}

function frames(node, entries, out) {
  for (const frame of findAll(node, "frame")) {
    const img = find(frame, "image");
    const href = img && attr(img, "href");
    if (href && entries[href]) out.push({ image: entries[href], width: cm(attr(frame, "width")), height: cm(attr(frame, "height")) });
  }
}
function cm(v) {
  if (!v) return undefined;
  const m = String(v).match(/^([\d.]+)(cm|mm|in|pt|px)?$/);
  if (!m) return undefined;
  const n = Number(m[1]);
  return { cm: n * 28.35, mm: n * 2.835, in: n * 72, pt: n, px: n * 0.75 }[m[2] || "pt"];
}

export function odtToBlocks(entries) {
  const x = content(entries, "odt");
  const bold = boldStyles(x, entries);
  const body = find(x, "text") || x;
  const blocks = [];
  const walk = (node, listDepth = 0, counters = {}) => {
    for (const el of node.children || []) {
      const n = local(el.name);
      if (n === "h") {
        const lvl = Number(attr(el, "outline-level") || 1);
        frames(el, entries, blocks);
        blocks.push({ text: inline(el), size: HEADING_SIZE[lvl] || 12, bold: true });
      } else if (n === "p") {
        const style = attr(el, "style-name");
        const imgs = [];
        frames(el, entries, imgs);
        const t = inline(el);
        if (t.trim() || !imgs.length) blocks.push({ text: t, bold: bold.has(style), indent: listDepth ? 14 * listDepth : undefined });
        blocks.push(...imgs);
      } else if (n === "list") {
        for (const item of kids(el, "text:list-item")) {
          const first = (item.children || []).find((c) => local(c.name) === "p" || local(c.name) === "h");
          if (first) blocks.push({ text: "• " + inline(first), indent: 14 * (listDepth + 1) });
          walk({ children: (item.children || []).filter((c) => c !== first) }, listDepth + 1, counters);
        }
      } else if (n === "table") {
        blocks.push({ table: findAll(el, "table-row").map((r) => kids(r, "table:table-cell").map((c) => findAll(c, "p").map(inline).join(" ").trim())), spaceAfter: 8 });
      } else if (n === "soft-page-break") continue;
      else if (n === "section" || n === "frame" || n === "text-box") walk(el, listDepth, counters);
    }
  };
  walk(body);
  return blocks.length ? blocks : [{ text: "" }];
}

export async function odtToPdf(files, { pageSize = "a4" } = {}, ctx = {}) {
  const file = files[0];
  const blocks = odtToBlocks(readZip(file, "odt"));
  const doc = await PDFDocument.create({ updateMetadata: false });
  await layoutBlocks(doc, blocks, { pageSize, toPng: ctx.toPng });
  return result(`${baseName(file.name)}.pdf`, await saveDoc(doc), { sizeBefore: file.size, pageCount: doc.getPageCount() });
}

export function odsToSheets(entries) {
  const x = content(entries, "ods");
  const sheets = [];
  for (const t of findAll(x, "table")) {
    if (local(t.name) !== "table" || !attr(t, "name")) continue;
    const rows = [];
    for (const r of findAll(t, "table-row")) {
      const rep = Math.min(Number(attr(r, "number-rows-repeated") || 1), 50);
      const cells = [];
      for (const c of (r.children || []).filter((k) => /table-cell|covered-table-cell/.test(local(k.name)))) {
        const n = Math.min(Number(attr(c, "number-columns-repeated") || 1), 200);
        const vt = attr(c, "value-type");
        let val = findAll(c, "p").map(inline).join("\n");
        if (!val && vt && vt !== "string") val = attr(c, "value") ?? "";
        for (let i = 0; i < n; i++) cells.push(val);
      }
      while (cells.length && cells[cells.length - 1] === "") cells.pop();
      for (let i = 0; i < rep; i++) rows.push([...cells]);
    }
    while (rows.length && rows[rows.length - 1].length === 0) rows.pop();
    const width = Math.max(0, ...rows.map((r) => r.length));
    sheets.push({ name: attr(t, "name"), rows: rows.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? "")) });
  }
  return sheets;
}

export async function odsToPdf(files, { pageSize = "a4", landscape = true } = {}) {
  const file = files[0];
  const sheets = odsToSheets(readZip(file, "ods"));
  if (!sheets.length) throw new ToolError("The spreadsheet has no sheets.", "empty");
  const doc = await PDFDocument.create({ updateMetadata: false });
  for (const s of sheets) await layoutTable(doc, s.rows.length ? s.rows : [[""]], { pageSize, landscape: !!landscape, header: true, title: s.name });
  const r = result(`${baseName(file.name)}.pdf`, await saveDoc(doc), { sizeBefore: file.size, pageCount: doc.getPageCount() });
  r.stats = { sheets: sheets.length };
  return r;
}

export function odpToSlides(entries) {
  const x = content(entries, "odp");
  const styles = entries["styles.xml"] ? parseXml(utf8(entries["styles.xml"])) : null;
  let size = [720, 405];
  if (styles) {
    const pl = find(styles, "page-layout-properties");
    if (pl && attr(pl, "page-width")) size = [cm(attr(pl, "page-width")), cm(attr(pl, "page-height"))];
  }
  const slides = [];
  for (const pg of findAll(x, "page")) {
    if (local(pg.name) !== "page") continue;
    const blocks = [];
    for (const fr of kids(pg, "draw:frame")) {
      const cls = attr(fr, "class") || "";
      const img = find(fr, "image");
      if (img && attr(img, "href") && entries[attr(img, "href")]) {
        blocks.push({ image: entries[attr(img, "href")], width: cm(attr(fr, "width")), height: cm(attr(fr, "height")) });
        continue;
      }
      const walkText = (node, depth) => {
        for (const c of node.children || []) {
          const n = local(c.name);
          if (n === "p") {
            const t = inline(c);
            if (!t.trim()) continue;
            blocks.push(depth ? { text: "• " + t, size: 14, indent: 14 * depth } : /title/.test(cls) ? { text: t, size: 24, bold: true } : { text: t, size: 14 });
          } else if (n === "list") walkText(c, depth + 1);
          else if (n === "list-item" || n === "text-box" || n === "list-header") walkText(c, depth);
        }
      };
      walkText(fr, 0);
    }
    slides.push({ blocks });
  }
  return { size, slides };
}

export async function odpToPdf(files, {} = {}, ctx = {}) {
  const file = files[0];
  const { size, slides } = odpToSlides(readZip(file, "odp"));
  if (!slides.length) throw new ToolError("The presentation has no slides.", "empty");
  const doc = await PDFDocument.create({ updateMetadata: false });
  for (const s of slides) {
    const before = doc.getPageCount();
    await layoutBlocks(doc, s.blocks.length ? s.blocks : [{ text: "" }], { pageSize: size, margin: 36, toPng: ctx.toPng });
    while (doc.getPageCount() > before + 1) doc.removePage(doc.getPageCount() - 1);
  }
  const r = result(`${baseName(file.name)}.pdf`, await saveDoc(doc), { sizeBefore: file.size, pageCount: doc.getPageCount() });
  r.stats = { slides: slides.length };
  return r;
}
