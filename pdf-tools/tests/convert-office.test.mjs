import { test } from "node:test";
import assert from "node:assert/strict";
import { makePdf, makePng, TINY_JPEG, pageCountOf, loadBytes } from "./helpers.mjs";
import { makeFile } from "../src/tools/core.js";
import { zipFiles, unzip, utf8 } from "../src/zip.js";
import { parseXml, find, findAll, textOf, attr, docxToBlocks, docxToPdf, xlsxToSheets, xlsxToPdf, pptxToSlides, pptxToPdf, colIndex } from "../src/tools/office.js";
import { odtToBlocks, odtToPdf, odsToSheets, odsToPdf, odpToSlides, odpToPdf } from "../src/tools/odf.js";
import { epubToBlocks, epubToPdf, pagesToPdf } from "../src/tools/ebook.js";
import { buildDocx, buildDocxExact, buildXlsx, buildPptx, pdfToDocx, pdfToXlsx, pdfToPptx, paragraphsOf, cellsOf, colLetter, twips, emu, fontFamilyOf, frameTopOf, alignOf, blocksOf, frameXml, wantsBackground, parseNumber, columnBoundaries, tableOf } from "../src/tools/officeOut.js";

const enc = (s) => new TextEncoder().encode(s);
const zip = (map) => zipFiles(Object.entries(map).map(([name, data]) => ({ name, data: typeof data === "string" ? enc(data) : data })));

// ------------------------------------------------------------------ XML ----
test("parseXml handles nested tags, attributes, self-closing, entities and CDATA", () => {
  const x = parseXml(`<?xml version="1.0"?><a:root x="1"><b y="2">hi &amp; <![CDATA[<raw>]]></b><c/><d>é</d></a:root>`);
  const root = find(x, "root");
  assert.equal(attr(root, "x"), "1");
  assert.equal(textOf(find(x, "b")), "hi & <raw>");
  assert.equal(findAll(x, "c").length, 1);
  assert.equal(textOf(find(x, "d")), "é");
});

// ----------------------------------------------------------------- docx ----
const DOCX_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
function docxFixture({ withImage = true } = {}) {
  const document = `<?xml version="1.0"?><w:document ${DOCX_NS}><w:body>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Quarterly report</w:t></w:r></w:p>
    <w:p><w:r><w:t xml:space="preserve">Plain </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>bold</w:t></w:r><w:r><w:t xml:space="preserve"> text with &amp; entity.</w:t></w:r></w:p>
    <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>first item</w:t></w:r></w:p>
    <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr></w:pPr><w:r><w:t>numbered one</w:t></w:r></w:p>
    <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr></w:pPr><w:r><w:t>numbered two</w:t></w:r></w:p>
    <w:tbl><w:tr><w:tc><w:p><w:r><w:t>A</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>2</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
    ${withImage ? `<w:p><w:r><w:drawing><wp:inline><wp:extent cx="1270000" cy="635000"/><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="rIdImg"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>` : ""}
    <w:p><w:r><w:br w:type="page"/></w:r></w:p>
    <w:p><w:r><w:t>Second page</w:t></w:r></w:p>
  </w:body></w:document>`;
  const numbering = `<?xml version="1.0"?><w:numbering ${DOCX_NS}><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>`;
  const rels = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdImg" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/></Relationships>`;
  return zip({ "[Content_Types].xml": "<Types/>", "word/document.xml": document, "word/numbering.xml": numbering, "word/_rels/document.xml.rels": rels, "word/media/image1.png": makePng(20, 10) });
}

test("docx: headings, bold runs, bullets, numbering, tables, images and page breaks", async () => {
  const blocks = docxToBlocks(unzip(docxFixture()));
  const texts = blocks.map((b) => b.text).filter(Boolean);
  assert.equal(blocks[0].text, "Quarterly report");
  assert.equal(blocks[0].size, 22);
  assert.ok(blocks[0].bold);
  assert.ok(texts.includes("Plain bold text with & entity."));
  assert.ok(texts.includes("• first item"));
  assert.ok(texts.includes("1. numbered one") && texts.includes("2. numbered two"));
  const tbl = blocks.find((b) => b.table);
  assert.deepEqual(tbl.table, [["A", "B"], ["1", "2"]]);
  const img = blocks.find((b) => b.image);
  assert.equal(Math.round(img.width), 100);
  assert.ok(blocks.some((b) => b.pageBreak));
  const r = await docxToPdf([makeFile("report.docx", docxFixture())]);
  assert.equal(r.name, "report.pdf");
  assert.equal(await pageCountOf(r.bytes), 2);
});

test("docx: a plain zip without document.xml is rejected, as is a non-zip", async () => {
  await assert.rejects(() => docxToPdf([makeFile("x.docx", zip({ "a.txt": "x" }))]), /word\/document.xml/);
  await assert.rejects(() => docxToPdf([makeFile("x.docx", new Uint8Array([1, 2, 3]))]), /not a docx/);
});

// ----------------------------------------------------------------- xlsx ----
function xlsxFixture() {
  const wb = `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sales" sheetId="1" r:id="rId1"/><sheet name="Notes" sheetId="2" r:id="rId2"/></sheets></workbook>`;
  const rels = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="x" Target="worksheets/sheet2.xml"/></Relationships>`;
  const ss = `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>Item</t></si><si><r><t>Qt</t></r><r><t>y</t></r></si></sst>`;
  const s1 = `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="inlineStr"><is><t>Price</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Apple</t></is></c><c r="B2"><v>3</v></c><c r="C2"><v>1.5</v></c></row><row r="3"><c r="A3" t="inlineStr"><is><t>Pear</t></is></c><c r="C3"><v>2</v></c><c r="D3" t="b"><v>1</v></c></row></sheetData></worksheet>`;
  const s2 = `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>hello</t></is></c></row></sheetData></worksheet>`;
  return zip({ "xl/workbook.xml": wb, "xl/_rels/workbook.xml.rels": rels, "xl/sharedStrings.xml": ss, "xl/worksheets/sheet1.xml": s1, "xl/worksheets/sheet2.xml": s2 });
}

test("xlsx: shared strings, inline strings, numbers, booleans, gaps and several sheets", async () => {
  const sheets = xlsxToSheets(unzip(xlsxFixture()));
  assert.equal(sheets.length, 2);
  assert.equal(sheets[0].name, "Sales");
  assert.deepEqual(sheets[0].rows, [["Item", "Qty", "Price", ""], ["Apple", "3", "1.5", ""], ["Pear", "", "2", "TRUE"]]);
  assert.equal(colIndex("AB7"), 27);
  const r = await xlsxToPdf([makeFile("book.xlsx", xlsxFixture())]);
  assert.equal(r.stats.sheets, 2);
  assert.equal(await pageCountOf(r.bytes), 2);
  const doc = await loadBytes(r.bytes);
  assert.ok(doc.getPage(0).getWidth() > doc.getPage(0).getHeight(), "landscape by default");
});

// ----------------------------------------------------------------- pptx ----
function pptxFixture() {
  const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
  const pres = `<?xml version="1.0"?><p:presentation ${NS}><p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId3"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`;
  const rels = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="x" Target="slides/slide1.xml"/><Relationship Id="rId3" Type="x" Target="slides/slide2.xml"/></Relationships>`;
  const slide1 = `<?xml version="1.0"?><p:sld ${NS}><p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>Welcome</a:t></a:r></a:p></p:txBody></p:sp><p:sp><p:txBody><a:p><a:pPr lvl="1"/><a:r><a:t>point one</a:t></a:r></a:p><a:p><a:r><a:t>plain</a:t></a:r></a:p></p:txBody></p:sp><p:pic><p:blipFill><a:blip r:embed="rId9"/></p:blipFill><p:spPr><a:xfrm><a:ext cx="2540000" cy="1270000"/></a:xfrm></p:spPr></p:pic></p:spTree></p:cSld></p:sld>`;
  const slide1rels = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId9" Type="x" Target="../media/image1.jpeg"/></Relationships>`;
  const slide2 = `<?xml version="1.0"?><p:sld ${NS}><p:cSld><p:spTree><p:graphicFrame><a:graphic><a:graphicData><a:tbl><a:tr><a:tc><a:txBody><a:p><a:r><a:t>h1</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>h2</a:t></a:r></a:p></a:txBody></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame></p:spTree></p:cSld></p:sld>`;
  return zip({ "ppt/presentation.xml": pres, "ppt/_rels/presentation.xml.rels": rels, "ppt/slides/slide1.xml": slide1, "ppt/slides/_rels/slide1.xml.rels": slide1rels, "ppt/slides/slide2.xml": slide2, "ppt/media/image1.jpeg": TINY_JPEG });
}

test("pptx: slide size, titles, bullet levels, pictures, tables; one page per slide", async () => {
  const { size, slides } = pptxToSlides(unzip(pptxFixture()));
  assert.equal(Math.round(size[0]), 960);
  assert.equal(Math.round(size[1]), 540);
  assert.equal(slides.length, 2);
  const b = slides[0].blocks;
  assert.deepEqual(b.map((x) => x.text ?? "<img>"), ["Welcome", "• point one", "plain", "<img>"]);
  assert.equal(b[0].size, 24);
  assert.deepEqual(slides[1].blocks[0].table, [["h1", "h2"]]);
  const r = await pptxToPdf([makeFile("deck.pptx", pptxFixture())]);
  assert.equal(r.stats.slides, 2);
  const doc = await loadBytes(r.bytes);
  assert.equal(doc.getPageCount(), 2);
  assert.equal(Math.round(doc.getPage(0).getWidth()), 960);
});

// ------------------------------------------------------------------ ODF ----
const ODF_NS = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" xmlns:presentation="urn:oasis:names:tc:opendocument:xmlns:presentation:1.0"';
function odtFixture() {
  const content = `<?xml version="1.0"?><office:document-content ${ODF_NS}><office:automatic-styles><style:style style:name="T1" style:family="paragraph"><style:text-properties fo:font-weight="bold"/></style:style></office:automatic-styles><office:body><office:text>
    <text:h text:outline-level="1">Chapter<text:s text:c="2"/>one</text:h>
    <text:p text:style-name="T1">Bold para</text:p>
    <text:p>Normal<text:line-break/>second line</text:p>
    <text:list><text:list-item><text:p>bullet a</text:p></text:list-item><text:list-item><text:p>bullet b</text:p></text:list-item></text:list>
    <table:table table:name="T"><table:table-row><table:table-cell><text:p>c1</text:p></table:table-cell><table:table-cell><text:p>c2</text:p></table:table-cell></table:table-row></table:table>
    <text:p><draw:frame svg:width="2cm" svg:height="1cm"><draw:image xlink:href="Pictures/p.png"/></draw:frame></text:p>
  </office:text></office:body></office:document-content>`;
  return zip({ "content.xml": content, "Pictures/p.png": makePng(8, 4) });
}

test("odt: headings, bold styles, line breaks, lists, tables, images", async () => {
  const blocks = odtToBlocks(unzip(odtFixture()));
  assert.equal(blocks[0].text, "Chapter  one");
  assert.equal(blocks[0].size, 22);
  assert.equal(blocks[1].text, "Bold para");
  assert.ok(blocks[1].bold);
  assert.equal(blocks[2].text, "Normal\nsecond line");
  assert.ok(blocks.some((b) => b.text === "• bullet a") && blocks.some((b) => b.text === "• bullet b"));
  assert.deepEqual(blocks.find((b) => b.table).table, [["c1", "c2"]]);
  const img = blocks.find((b) => b.image);
  assert.equal(Math.round(img.width), 57);
  const r = await odtToPdf([makeFile("doc.odt", odtFixture())]);
  assert.equal(await pageCountOf(r.bytes), 1);
  await assert.rejects(() => odtToPdf([makeFile("x.odt", zip({ "a": "b" }))]), /content.xml/);
});

function odsFixture() {
  const content = `<?xml version="1.0"?><office:document-content ${ODF_NS}><office:body><office:spreadsheet>
    <table:table table:name="Data"><table:table-row><table:table-cell office:value-type="string"><text:p>Name</text:p></table:table-cell><table:table-cell office:value-type="string"><text:p>Score</text:p></table:table-cell></table:table-row>
    <table:table-row table:number-rows-repeated="2"><table:table-cell office:value-type="string"><text:p>x</text:p></table:table-cell><table:table-cell office:value-type="float" office:value="7"/><table:table-cell table:number-columns-repeated="3"/></table:table-row></table:table>
    <table:table table:name="Empty"/>
  </office:spreadsheet></office:body></office:document-content>`;
  return zip({ "content.xml": content });
}

test("ods: repeated rows/columns, value types, trailing empties trimmed", async () => {
  const sheets = odsToSheets(unzip(odsFixture()));
  assert.equal(sheets.length, 2);
  assert.deepEqual(sheets[0].rows, [["Name", "Score"], ["x", "7"], ["x", "7"]]);
  const r = await odsToPdf([makeFile("d.ods", odsFixture())]);
  assert.equal(r.stats.sheets, 2);
  assert.equal(await pageCountOf(r.bytes), 2);
});

function odpFixture() {
  const content = `<?xml version="1.0"?><office:document-content ${ODF_NS}><office:body><office:presentation>
    <draw:page draw:name="page1"><draw:frame presentation:class="title"><draw:text-box><text:p>Slide title</text:p></draw:text-box></draw:frame><draw:frame presentation:class="outline"><draw:text-box><text:list><text:list-item><text:p>bullet</text:p></text:list-item></text:list></draw:text-box></draw:frame><draw:frame svg:width="4cm" svg:height="2cm"><draw:image xlink:href="Pictures/i.jpg"/></draw:frame></draw:page>
    <draw:page draw:name="page2"><draw:frame><draw:text-box><text:p>second</text:p></draw:text-box></draw:frame></draw:page>
  </office:presentation></office:body></office:document-content>`;
  const styles = `<?xml version="1.0"?><office:document-styles ${ODF_NS}><office:automatic-styles><style:page-layout style:name="PM1"><style:page-layout-properties fo:page-width="28cm" fo:page-height="15.75cm"/></style:page-layout></office:automatic-styles></office:document-styles>`;
  return zip({ "content.xml": content, "styles.xml": styles, "Pictures/i.jpg": TINY_JPEG });
}

test("odp: page size from styles, titles, bullets, pictures, one page per slide", async () => {
  const { size, slides } = odpToSlides(unzip(odpFixture()));
  assert.equal(Math.round(size[0]), 794);
  assert.equal(slides.length, 2);
  assert.equal(slides[0].blocks[0].text, "Slide title");
  assert.equal(slides[0].blocks[0].size, 24);
  assert.equal(slides[0].blocks[1].text, "• bullet");
  assert.ok(slides[0].blocks[2].image);
  const r = await odpToPdf([makeFile("deck.odp", odpFixture())]);
  const doc = await loadBytes(r.bytes);
  assert.equal(doc.getPageCount(), 2);
  assert.equal(Math.round(doc.getPage(0).getWidth()), 794);
});

// ----------------------------------------------------------------- EPUB ----
function epubFixture() {
  const container = `<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`;
  const opf = `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata><dc:title>Tiny Book</dc:title><dc:creator>A. Writer</dc:creator></metadata><manifest><item id="c2" href="text/ch2.xhtml" media-type="application/xhtml+xml"/><item id="c1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/><item id="img" href="images/fig.png" media-type="image/png"/><item id="css" href="style.css" media-type="text/css"/></manifest><spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>`;
  const ch1 = `<html><head><title>x</title></head><body><h1>Chapter One</h1><p>It was a dark night.</p><img src="../images/fig.png" alt=""/><p>After the picture.</p></body></html>`;
  const ch2 = `<html><body><h2>Chapter Two</h2><p>The end.</p></body></html>`;
  return zip({ mimetype: "application/epub+zip", "META-INF/container.xml": container, "OEBPS/content.opf": opf, "OEBPS/text/ch1.xhtml": ch1, "OEBPS/text/ch2.xhtml": ch2, "OEBPS/images/fig.png": makePng(6, 6), "OEBPS/style.css": "p{}" });
}

test("epub: title page, spine order, headings, images in place, chapter page breaks", async () => {
  const blocks = epubToBlocks(unzip(epubFixture()));
  const seq = blocks.map((b) => (b.pageBreak ? "<br>" : b.image ? "<img>" : b.text));
  assert.deepEqual(seq, ["Tiny Book", "A. Writer", "Chapter One", "It was a dark night.", "<img>", "After the picture.", "<br>", "Chapter Two", "The end."]);
  const r = await epubToPdf([makeFile("book.epub", epubFixture())]);
  assert.equal(await pageCountOf(r.bytes), 2);
  await assert.rejects(() => epubToPdf([makeFile("x.epub", zip({ "a": "b" }))]), /container.xml/);
});

// ---------------------------------------------------------------- Pages ----
test("pages: extracts the embedded preview PDF, or explains when there is none", async () => {
  const pdf = await makePdf(3);
  const r = await pagesToPdf([makeFile("Letter.pages", zip({ "Index/Document.iwa": "x", "QuickLook/Preview.pdf": pdf.bytes }))]);
  assert.equal(r.name, "Letter.pdf");
  assert.equal(r.pageCount, 3);
  await assert.rejects(() => pagesToPdf([makeFile("x.pages", zip({ "Index/Document.iwa": "x" }))]), /no PDF preview/);
});

// -------------------------------------------------------- PDF -> Office ----
const it = (str, x, y, size, bold = false) => ({ str, x, y, w: str.length * size * 0.5, h: size, size, bold, eol: false });
const fakePages = [
  {
    width: 600,
    height: 800,
    items: [it("Big Title", 50, 60, 24, true), it("First line of a paragraph", 50, 100, 11), it("that continues here.", 50, 114, 11), it("Second paragraph.", 50, 150, 11), it("Name", 50, 200, 11, true), it("Qty", 250, 200, 11, true), it("Apple", 50, 216, 11), it("3", 250, 216, 11)],
    text: "",
  },
  { width: 600, height: 800, items: [it("Page two.", 50, 60, 11)], text: "Page two." },
];
const fakeCtx = { extractText: async () => fakePages, renderPage: async () => TINY_JPEG };

test("paragraphsOf merges lines by gap and detects headings", () => {
  const paras = paragraphsOf(fakePages[0]);
  assert.equal(paras[0].text, "Big Title");
  assert.ok(paras[0].heading);
  assert.equal(paras[1].text, "First line of a paragraph that continues here.");
  assert.equal(paras[2].text, "Second paragraph.");
});

test("pdf to docx: valid package with headings, paragraphs and page breaks", async () => {
  const f = await makePdf(2);
  const r = await pdfToDocx([f], { layout: "flow" }, fakeCtx);
  assert.equal(r.kind, "docx");
  assert.ok(r.mime.includes("wordprocessingml"));
  const files = unzip(r.bytes);
  assert.ok(files["[Content_Types].xml"] && files["word/styles.xml"]);
  const xml = utf8(files["word/document.xml"]);
  assert.ok(xml.includes('<w:pStyle w:val="Heading1"/>'));
  assert.ok(xml.includes("First line of a paragraph that continues here."));
  assert.ok(xml.includes('<w:br w:type="page"/>'));
  assert.equal(r.stats.paragraphs, 6);
  await assert.rejects(() => pdfToDocx([f]), /needs a browser/);
});

test("pdf to xlsx: one sheet per page, rows split into cells by gaps, numbers numeric", async () => {
  const f = await makePdf(2);
  const r = await pdfToXlsx([f], {}, fakeCtx);
  const files = unzip(r.bytes);
  const wb = utf8(files["xl/workbook.xml"]);
  assert.ok(wb.includes('name="Page 1"') && wb.includes('name="Page 2"'));
  const s1 = utf8(files["xl/worksheets/sheet1.xml"]);
  assert.ok(s1.includes("<t xml:space=\"preserve\">Apple</t>"));
  assert.ok(s1.includes('<c r="B6"><v>3</v></c>'), s1);
  assert.equal(colLetter(27), "AB");
  assert.deepEqual(cellsOf({ items: [it("Name", 50, 0, 11), it("Qty", 250, 0, 11)] }), ["Name", "Qty"]);
});

test("pdf to pptx: a slide per page with the picture and notes, plus master/layout/theme parts", async () => {
  const f = await makePdf(2);
  const r = await pdfToPptx([f], { dpi: 96 }, fakeCtx);
  assert.equal(r.kind, "pptx");
  const files = unzip(r.bytes);
  for (const p of ["ppt/presentation.xml", "ppt/slides/slide1.xml", "ppt/slides/slide2.xml", "ppt/media/image1.jpeg", "ppt/notesSlides/notesSlide2.xml", "ppt/slideMasters/slideMaster1.xml", "ppt/slideLayouts/slideLayout1.xml", "ppt/theme/theme1.xml", "ppt/notesMasters/notesMaster1.xml"]) assert.ok(files[p], `missing ${p}`);
  assert.ok(utf8(files["ppt/notesSlides/notesSlide2.xml"]).includes("Page two."));
  const pres = utf8(files["ppt/presentation.xml"]);
  assert.ok(pres.includes('<p:sldSz cx="9144000" cy="12192000"/>'), pres);
  assert.ok(utf8(files["ppt/slides/slide1.xml"]).includes('r:embed="rId2"'));
});

test("buildDocx/buildXlsx/buildPptx escape XML special characters", () => {
  const d = unzip(buildDocx([{ width: 100, height: 100, items: [it("a < b & \"c\"", 0, 10, 11)], text: "" }]));
  assert.ok(utf8(d["word/document.xml"]).includes("a &lt; b &amp; &quot;c&quot;"));
  const x = unzip(buildXlsx([{ name: "S<1>", rows: [["<x>"]] }]));
  assert.ok(utf8(x["xl/workbook.xml"]).includes('name="S&lt;1&gt;"'));
  assert.ok(utf8(x["xl/worksheets/sheet1.xml"]).includes("&lt;x&gt;"));
  const p = unzip(buildPptx([{ image: TINY_JPEG, width: 4, height: 3, notes: "<n>" }]));
  assert.ok(utf8(p["ppt/notesSlides/notesSlide1.xml"]).includes("&lt;n&gt;"));
});

// ------------------------------------------------ PDF -> Word, exact layout ----
test("twips/emu maths and font family mapping", () => {
  assert.equal(twips(72), 1440);
  assert.equal(emu(1), 12700);
  assert.equal(fontFamilyOf("TimesNewRomanPSMT"), "Times New Roman");
  assert.equal(fontFamilyOf("g_d0_f1"), "Arial");
  assert.equal(fontFamilyOf("CourierNew-Bold"), "Courier New");
  assert.equal(fontFamilyOf("DejaVuSans"), "Arial");
  // the frame top sits one ascent above the first baseline, plus half the extra leading
  assert.ok(Math.abs(frameTopOf(100, 10, 11.5) - 92) < 0.01);
  assert.ok(Math.abs(frameTopOf(100, 10, 15.5) - 90) < 0.01);
});

test("blocksOf groups regularly spaced lines of one style and keeps others apart", () => {
  const blocks = blocksOf(fakePages[0]);
  const texts = blocks.map((b) => b.lines);
  assert.deepEqual(texts[0], ["Big Title"]);
  assert.deepEqual(texts[1], ["First line of a paragraph", "that continues here."]);
  assert.deepEqual(texts[2], ["Second paragraph."]);
  assert.equal(blocks[0].bold, true);
  assert.equal(blocks[1].size, 11);
  assert.ok(Math.abs(blocks[1].gap - 14) < 0.01);
  assert.equal(blocks[1].height, 28);
  assert.equal(blocks[1].x, 50);
  // table cells sit far apart on one baseline: each column is its own block (Name/Apple, Qty/3)
  const cols = blocks.filter((b) => b.lines.includes("Name") || b.lines.includes("Qty"));
  assert.equal(cols.length, 2);
  assert.deepEqual(blocks.find((b) => b.lines.includes("Qty")).lines, ["Qty"]);
  assert.deepEqual(blocks.find((b) => b.lines.includes("Apple")).lines, ["Apple"]);
});

test("blocksOf keeps two side-by-side columns as separate blocks", () => {
  const items = [];
  for (let i = 0; i < 4; i++) {
    items.push(it(`Left ${i}`, 50, 100 + i * 14, 11));
    items.push(it(`Right ${i}`, 300, 100 + i * 14, 11));
  }
  const blocks = blocksOf({ width: 600, height: 800, items });
  assert.equal(blocks.length, 2);
  assert.deepEqual(blocks[0].lines, ["Left 0", "Left 1", "Left 2", "Left 3"]);
  assert.deepEqual(blocks[1].lines, ["Right 0", "Right 1", "Right 2", "Right 3"]);
  assert.equal(blocks[1].x, 300);
});

test("alignOf detects centred and right-aligned blocks", () => {
  const mk = (lines, size = 11) => ({ lines, size, x: Math.min(...lines.map((l) => l.x)), xEnd: Math.max(...lines.map((l) => l.xEnd)) });
  assert.equal(alignOf(mk([{ x: 50, xEnd: 300 }, { x: 50, xEnd: 250 }]), 600), "left");
  assert.equal(alignOf(mk([{ x: 100, xEnd: 300 }, { x: 150, xEnd: 250 }]), 600), "center");
  assert.equal(alignOf(mk([{ x: 100, xEnd: 300 }, { x: 200, xEnd: 300 }]), 600), "right");
  assert.equal(alignOf(mk([{ x: 250, xEnd: 350 }]), 600), "center");
  assert.equal(alignOf(mk([{ x: 50, xEnd: 150 }]), 600), "left");
});

test("buildDocxExact: sections per page, positioned frames, media parts, background anchor; XML well-formed", () => {
  const pages = [
    { width: 600, height: 800, items: [it("Big Title", 50, 60, 24, true), it("Body line one", 50, 100, 11), it("Body line two", 50, 114, 11)], text: "" },
    { width: 800, height: 600, items: [it("Landscape page", 40, 50, 12)], text: "" },
  ];
  const images = [[{ bytes: makePng(20, 10), x: 300, y: 200, w: 120, h: 60 }], []];
  const backgrounds = [null, TINY_JPEG];
  const { bytes, stats } = buildDocxExact(pages, { images, backgrounds });
  assert.deepEqual(stats, { blocks: 3, images: 1, backgrounds: 1 });
  const files = unzip(bytes);
  const xml = utf8(files["word/document.xml"]);
  parseXml(xml); // throws if malformed
  parseXml(utf8(files["word/_rels/document.xml.rels"]));
  parseXml(utf8(files["[Content_Types].xml"]));
  // one section break paragraph + the final body sectPr, page sizes in twips, zero margins
  assert.equal((xml.match(/<w:sectPr>/g) || []).length, 2);
  assert.ok(xml.includes('<w:pgSz w:w="12000" w:h="16000"/>'));
  assert.ok(xml.includes('<w:pgSz w:w="16000" w:h="12000" w:orient="landscape"/>'));
  assert.ok(xml.includes('<w:pgMar w:top="0" w:right="0" w:bottom="0" w:left="0"'));
  // the title frame: x = 50pt = 1000 twips; single line so gap = 1.2*size = 28.8, y = frameTopOf(60, 24, 28.8) = 40.2pt = 804 twips
  const title = xml.match(/<w:p><w:pPr><w:framePr[^>]*w:x="1000" w:y="804"\/>.*?<\/w:p>/s);
  assert.ok(title, "title frame missing");
  assert.ok(title[0].includes("<w:b/>") && title[0].includes('<w:sz w:val="48"/>') && title[0].includes("Big Title"));
  assert.ok(title[0].includes('w:hAnchor="page" w:vAnchor="page"') && title[0].includes('w:wrap="none"'));
  // the body block: two lines joined by <w:br/>, exact line spacing of 14pt = 280 twips
  const body = xml.match(/<w:p><w:pPr><w:framePr[^>]*\/><w:spacing w:before="0" w:after="0" w:line="280" w:lineRule="exact"\/>.*?<\/w:p>/s);
  assert.ok(body, "body frame missing");
  assert.ok(body[0].includes("Body line one</w:t><w:br/>") && body[0].includes("Body line two"));
  // image frame at 300,200 sized 120x60 pt, with an inline picture and a media part + relationship
  assert.ok(xml.includes('w:x="6000" w:y="4000"'));
  assert.ok(xml.includes(`<wp:extent cx="${emu(120)}" cy="${emu(60)}"/>`));
  assert.ok(files["word/media/image1.png"]);
  const rels = utf8(files["word/_rels/document.xml.rels"]);
  assert.ok(rels.includes('Target="media/image1.png"') && rels.includes('Target="media/image2.jpeg"'));
  // background anchored behind the text on page 2 only
  assert.equal((xml.match(/behindDoc="1"/g) || []).length, 1);
  assert.ok(xml.includes(`<wp:extent cx="${emu(800)}" cy="${emu(600)}"/>`));
  assert.ok(utf8(files["[Content_Types].xml"]).includes('Extension="jpeg"'));
});

test("frameXml clamps negative positions and escapes nothing it should not", () => {
  const x = frameXml({ x: -5, y: -1, w: 10, h: 10, inner: "<w:r><w:t>a</w:t></w:r>", jc: "center" });
  assert.ok(x.includes('w:x="0" w:y="0"') && x.includes('<w:jc w:val="center"/>'));
});

test("wantsBackground: never with raster images; auto for near-empty or vector-heavy pages", () => {
  const imgs = Object.assign([], { vectorOps: 500 });
  const withImg = Object.assign([{}], { vectorOps: 500 });
  assert.equal(wantsBackground(fakePages[0], withImg, "auto"), false);
  assert.equal(wantsBackground(fakePages[0], imgs, "auto"), true);
  assert.equal(wantsBackground(fakePages[0], Object.assign([], { vectorOps: 3 }), "auto"), false);
  assert.equal(wantsBackground(fakePages[1], Object.assign([], { vectorOps: 0 }), "auto"), true);
  assert.equal(wantsBackground(fakePages[0], withImg, "always"), true);
  assert.equal(wantsBackground(fakePages[1], [], "never"), false);
});

test("pdfToDocx exact mode uses pageImages and renderPage hooks; flow mode still works", async () => {
  const f = await makePdf(2);
  const calls = { images: 0, render: 0 };
  const ctx = {
    extractText: async () => fakePages,
    pageImages: async (bytes, i) => {
      calls.images++;
      return Object.assign(i === 0 ? [{ bytes: makePng(4, 4), x: 10, y: 10, w: 50, h: 50 }] : [], { vectorOps: 0 });
    },
    renderPage: async () => {
      calls.render++;
      return TINY_JPEG;
    },
  };
  const r = await pdfToDocx([f], {}, ctx);
  assert.equal(r.stats.layout, "exact");
  assert.equal(calls.images, 2);
  assert.equal(calls.render, 1); // only the near-empty page 2 gets a background in auto mode
  assert.equal(r.stats.images, 1);
  assert.equal(r.stats.backgrounds, 1);
  const always = await pdfToDocx([f], { background: "always" }, ctx);
  assert.equal(always.stats.backgrounds, 2);
  const noHooks = await pdfToDocx([f], {}, { extractText: async () => fakePages });
  assert.equal(noHooks.stats.images, 0);
  const flow = await pdfToDocx([f], { layout: "flow" }, ctx);
  assert.equal(flow.stats.layout, "flow");
});

// ------------------------------------------------ PDF -> Excel, tables ----
test("parseNumber handles separators, currency, percent and negatives", () => {
  assert.equal(parseNumber("1,234.56"), 1234.56);
  assert.equal(parseNumber("1.234,56"), 1234.56);
  assert.equal(parseNumber("$ 1,200"), 1200);
  assert.equal(parseNumber("€12,5"), 12.5);
  assert.equal(parseNumber("45 %"), 45);
  assert.equal(parseNumber("(12)"), -12);
  assert.equal(parseNumber("-3"), -3);
  assert.equal(parseNumber("1.234.567"), 1234567);
  assert.equal(parseNumber("12,345"), 12345);
  assert.equal(parseNumber("abc"), null);
  assert.equal(parseNumber("2026-01-01"), null);
  assert.equal(parseNumber(""), null);
  assert.equal(parseNumber(7), 7);
});

test("columnBoundaries finds page-wide gaps shared by the rows", () => {
  const lines = [
    { items: [it("Item", 50, 0, 10), it("Qty", 200, 0, 10), it("Price", 300, 0, 10)] },
    { items: [it("Apple", 50, 14, 10), it("3", 200, 14, 10), it("1.50", 300, 14, 10)] },
    { items: [it("Banana split", 50, 28, 10), it("12", 200, 28, 10), it("0.25", 300, 28, 10)] },
  ];
  const b = columnBoundaries(lines);
  assert.equal(b.length, 2);
  assert.ok(b[0] > 110 && b[0] < 200, String(b[0]));
  assert.ok(b[1] > 210 && b[1] < 300, String(b[1]));
  // a gap present in only one row is not a boundary
  const ragged = [{ items: [it("ab", 0, 0, 10), it("cd", 100, 0, 10)] }, { items: [it("a long cell spanning", 0, 14, 10)] }, { items: [it("another long spanning", 0, 28, 10)] }];
  assert.equal(columnBoundaries(ragged).length, 0);
});

test("tableOf: header row detected, numbers parsed, prose outside the table is one cell", () => {
  const page = {
    width: 600,
    height: 800,
    items: [
      it("Quarterly report", 50, 40, 16, true),
      it("Item", 50, 100, 10, true), it("Qty", 200, 100, 10, true), it("Price", 300, 100, 10, true),
      it("Apple", 50, 114, 10), it("3", 200, 114, 10), it("$1,500.00", 300, 114, 10),
      it("Pear", 50, 128, 10), it("12", 200, 128, 10), it("25 %", 300, 128, 10),
      it("Totals are indicative.", 50, 200, 10),
    ],
  };
  const t = tableOf(page);
  assert.deepEqual(t.rows[0], ["Quarterly report"]);
  assert.equal(t.header, 1);
  assert.deepEqual(t.rows[1], ["Item", "Qty", "Price"]);
  assert.deepEqual(t.rows[2], ["Apple", "3", "$1,500.00"]);
  assert.deepEqual(t.rows[4], ["Totals are indicative."]);
  assert.equal(t.widths.length, 3);
  assert.ok(t.widths[0] >= "Totals are indicative.".length);
  const x = unzip(buildXlsx([{ name: "S", ...t }]));
  const sheet = utf8(x["xl/worksheets/sheet1.xml"]);
  parseXml(sheet);
  assert.ok(sheet.includes('<c r="A2" s="1" t="inlineStr">'), sheet);
  assert.ok(sheet.includes('<c r="C3"><v>1500</v></c>'), sheet);
  assert.ok(sheet.includes('<c r="C4"><v>25</v></c>'), sheet);
  assert.ok(sheet.includes('<cols><col min="1" max="1" width='));
  const styles = utf8(x["xl/styles.xml"]);
  assert.ok(styles.includes("<b/>"));
  assert.ok(utf8(x["[Content_Types].xml"]).includes("/xl/styles.xml"));
  assert.ok(utf8(x["xl/_rels/workbook.xml.rels"]).includes("styles.xml"));
});
