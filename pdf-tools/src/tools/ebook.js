// EPUB -> PDF (spine order, headings, paragraphs, images) and Apple Pages -> PDF (embedded preview).
import { PDFDocument, result, baseName, saveDoc, ToolError, loadDoc } from "./core.js";
import { layoutBlocks } from "./text.js";
import { parseXml, find, findAll, attr, readZip, normalize } from "./office.js";
import { htmlToBlocks, decodeText } from "./convertText.js";
import { utf8 } from "../zip.js";

export function epubToBlocks(entries) {
  const container = entries["META-INF/container.xml"];
  if (!container) throw new ToolError("No META-INF/container.xml inside. Is this really an EPUB?", "bad_epub");
  const rootfile = attr(find(parseXml(utf8(container)), "rootfile"), "full-path");
  const opfBytes = rootfile && entries[rootfile];
  if (!opfBytes) throw new ToolError("The EPUB package file is missing.", "bad_epub");
  const opf = parseXml(utf8(opfBytes));
  const dir = rootfile.includes("/") ? rootfile.slice(0, rootfile.lastIndexOf("/")) : "";
  const resolve = (href, from = dir) => normalize((from ? from + "/" : "") + decodeURIComponent(href.split("#")[0]));
  const items = {};
  for (const it of findAll(opf, "item")) items[attr(it, "id")] = { href: resolve(attr(it, "href") || ""), type: attr(it, "media-type") || "" };
  const blocks = [];
  const title = findAll(opf, "title").map((t) => findAll(t, "#text").map((x) => x.text).join("") || (t.children || []).map((c) => c.text || "").join(""))[0];
  if (title) blocks.push({ text: title, size: 26, bold: true, align: "center", spaceAfter: 20 });
  const creator = findAll(opf, "creator")[0];
  if (creator) blocks.push({ text: (creator.children || []).map((c) => c.text || "").join(""), size: 14, align: "center", spaceAfter: 30 });
  let chapters = 0;
  for (const ref of findAll(opf, "itemref")) {
    const it = items[attr(ref, "idref")];
    if (!it || !entries[it.href] || !/html|xml/.test(it.type)) continue;
    const html = decodeText(entries[it.href]);
    const chapterDir = it.href.includes("/") ? it.href.slice(0, it.href.lastIndexOf("/")) : "";
    if (chapters++) blocks.push({ pageBreak: true });
    // split around <img> so pictures land where they belong
    const parts = html.split(/(<img\b[^>]*>|<image\b[^>]*>)/i);
    for (const part of parts) {
      const m = part.match(/^<(?:img|image)\b[^>]*?(?:src|href)\s*=\s*"([^"]+)"/i) || part.match(/^<(?:img|image)\b[^>]*?(?:src|href)\s*=\s*'([^']+)'/i);
      if (m) {
        const path = resolve(m[1], chapterDir);
        if (entries[path]) blocks.push({ image: entries[path], align: "center" });
        continue;
      }
      const bl = htmlToBlocks(part).filter((b) => b.text !== "" || b.pageBreak);
      blocks.push(...bl);
    }
  }
  if (!chapters) throw new ToolError("The EPUB has no readable chapters.", "empty");
  return blocks;
}

export async function epubToPdf(files, { pageSize = "a4" } = {}, ctx = {}) {
  const file = files[0];
  const blocks = epubToBlocks(readZip(file, "epub"));
  const doc = await PDFDocument.create({ updateMetadata: false });
  await layoutBlocks(doc, blocks, { pageSize, toPng: ctx.toPng });
  return result(`${baseName(file.name)}.pdf`, await saveDoc(doc), { sizeBefore: file.size, pageCount: doc.getPageCount() });
}

/** Apple Pages: the package ships a PDF preview of the document. */
export async function pagesToPdf(files) {
  const file = files[0];
  const entries = readZip(file, "pages");
  const names = Object.keys(entries);
  const candidate = ["preview.pdf", "QuickLook/Preview.pdf", "Preview.pdf"].find((n) => entries[n]) || names.filter((n) => /\.pdf$/i.test(n)).sort((a, b) => entries[b].length - entries[a].length)[0];
  if (!candidate) {
    throw new ToolError("This Pages file has no PDF preview inside (Pages stores one only when 'Include preview in document' is on). Open it in Pages and use File → Export To → PDF.", "no_preview");
  }
  const bytes = entries[candidate];
  const doc = await loadDoc({ name: candidate, bytes });
  return result(`${baseName(file.name)}.pdf`, bytes, { sizeBefore: file.size, pageCount: doc.getPageCount() });
}
