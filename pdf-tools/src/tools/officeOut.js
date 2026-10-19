// PDF -> docx / xlsx / pptx writers. Hand-written Office Open XML, zipped with fflate.
import { result, baseName, ToolError } from "./core.js";
import { linesOf } from "../render.js";
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

export async function pdfToDocx(files, {} = {}, ctx = {}) {
  if (!ctx.extractText) throw new ToolError("Text extraction needs a browser.", "no_renderer");
  const file = files[0];
  const pages = await ctx.extractText(file.bytes, { password: file.password });
  const bytes = buildDocx(pages);
  const r = result(`${baseName(file.name)}.docx`, bytes, { kind: "docx", mime: MIME.docx, sizeBefore: file.size, pageCount: pages.length });
  r.stats = { paragraphs: pages.reduce((n, p) => n + paragraphsOf(p).length, 0), scanned: pages.every((p) => !p.items.length) };
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

export function buildXlsx(sheets) {
  const files = [];
  let sheetsXml = "";
  let relsXml = "";
  let overrides = "";
  sheets.forEach((sh, i) => {
    const n = i + 1;
    let rows = "";
    sh.rows.forEach((cells, ri) => {
      let cs = "";
      cells.forEach((v, ci) => {
        const ref = `${colLetter(ci)}${ri + 1}`;
        const num = typeof v === "number" ? v : /^-?\d+(\.\d+)?$/.test(String(v).trim()) ? Number(v) : null;
        cs += num !== null && Number.isFinite(num) ? `<c r="${ref}"><v>${num}</v></c>` : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
      });
      rows += `<row r="${ri + 1}">${cs}</row>`;
    });
    files.push({ name: `xl/worksheets/sheet${n}.xml`, data: enc(XML + `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`) });
    sheetsXml += `<sheet name="${esc(sh.name.slice(0, 31))}" sheetId="${n}" r:id="rId${n}"/>`;
    relsXml += `<Relationship Id="rId${n}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${n}.xml"/>`;
    overrides += `<Override PartName="/xl/worksheets/sheet${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`;
  });
  files.push(
    { name: "[Content_Types].xml", data: enc(XML + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${overrides}</Types>`) },
    { name: "_rels/.rels", data: enc(RELS_ROOT("xl/workbook.xml")) },
    { name: "xl/workbook.xml", data: enc(XML + `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheetsXml}</sheets></workbook>`) },
    { name: "xl/_rels/workbook.xml.rels", data: enc(XML + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relsXml}</Relationships>`) }
  );
  return zipFiles(files, { level: 6 });
}

export async function pdfToXlsx(files, {} = {}, ctx = {}) {
  if (!ctx.extractText) throw new ToolError("Text extraction needs a browser.", "no_renderer");
  const file = files[0];
  const pages = await ctx.extractText(file.bytes, { password: file.password });
  const sheets = pages.map((p, i) => ({ name: `Page ${i + 1}`, rows: linesOf(p.items).map(cellsOf).filter((r) => r.length) }));
  const bytes = buildXlsx(sheets.length ? sheets : [{ name: "Page 1", rows: [] }]);
  const r = result(`${baseName(file.name)}.xlsx`, bytes, { kind: "xlsx", mime: MIME.xlsx, sizeBefore: file.size, pageCount: pages.length });
  r.stats = { rows: sheets.reduce((n, s) => n + s.rows.length, 0) };
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
