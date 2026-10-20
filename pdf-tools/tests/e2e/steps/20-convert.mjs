// Conversions through the real UI: Word/Excel to PDF, PDF to Word/PPT, EPUB and Pages.
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { PDFDocument } from "../../../vendor/pdf-lib.esm.js";
import { unzipSync, zipSync, strFromU8 } from "../../../vendor/fflate.js";
import { makePdf } from "../../helpers.mjs";

const enc = (s) => new TextEncoder().encode(s);
const zip = (map) => zipSync(Object.fromEntries(Object.entries(map).map(([k, v]) => [k, typeof v === "string" ? enc(v) : v])));

export default async function ({ page, step, BASE, tmp, downloadBytes }) {
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  writeFileSync(
    join(tmp, "memo.docx"),
    zip({
      "[Content_Types].xml": "<Types/>",
      "word/document.xml": `<?xml version="1.0"?><w:document ${W}><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Memo</w:t></w:r></w:p>${"<w:p><w:r><w:t>Paragraph of memo text that should wrap when it gets long enough to need it.</w:t></w:r></w:p>".repeat(60)}</w:body></w:document>`,
    })
  );
  writeFileSync(
    join(tmp, "book.xlsx"),
    zip({
      "xl/workbook.xml": `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      "xl/_rels/workbook.xml.rels": `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/></Relationships>`,
      "xl/worksheets/sheet1.xml": `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${Array.from({ length: 80 }, (_, i) => `<row r="${i + 1}"><c r="A${i + 1}" t="inlineStr"><is><t>Row ${i + 1}</t></is></c><c r="B${i + 1}"><v>${i * 2}</v></c></row>`).join("")}</sheetData></worksheet>`,
    })
  );
  const pdf3 = await makePdf(3, { name: "src.pdf" });
  writeFileSync(join(tmp, "src.pdf"), pdf3.bytes);
  writeFileSync(join(tmp, "Letter.pages"), zip({ "Index/Document.iwa": "x", "QuickLook/Preview.pdf": pdf3.bytes }));
  writeFileSync(
    join(tmp, "book.epub"),
    zip({
      "META-INF/container.xml": `<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
      "content.opf": `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata><dc:title>E2E Book</dc:title></metadata><manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="c2.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>`,
      "c1.xhtml": "<html><body><h1>One</h1><p>First chapter.</p></body></html>",
      "c2.xhtml": "<html><body><h1>Two</h1><p>Second chapter.</p></body></html>",
    })
  );

  const convert = async (tool, file) => {
    await page.goto(`${BASE}/tool.html?tool=${tool}`);
    await page.setInputFiles("input[type=file]", join(tmp, file));
    await page.waitForSelector("#run");
    await page.click("#run");
    await page.waitForSelector("#download", { timeout: 60_000 });
    return downloadBytes(page, () => page.click("#download"));
  };

  await step("word to pdf: docx with heading and 60 paragraphs becomes a multi-page PDF", async () => {
    const { name, bytes } = await convert("word-to-pdf", "memo.docx");
    if (name !== "memo.pdf") throw new Error(name);
    const doc = await PDFDocument.load(bytes);
    if (doc.getPageCount() < 2) throw new Error(`pages ${doc.getPageCount()}`);
  });

  await step("excel to pdf: 80 rows render as a landscape table", async () => {
    const { bytes } = await convert("excel-to-pdf", "book.xlsx");
    const doc = await PDFDocument.load(bytes);
    if (doc.getPageCount() < 2) throw new Error(`pages ${doc.getPageCount()}`);
    const p = doc.getPage(0);
    if (!(p.getWidth() > p.getHeight())) throw new Error("not landscape");
  });

  await step("pdf to word: real text extraction yields a docx with the page text", async () => {
    const { name, bytes } = await convert("pdf-to-word", "src.pdf");
    if (name !== "src.docx") throw new Error(name);
    const files = unzipSync(bytes);
    const xml = strFromU8(files["word/document.xml"]);
    if (!xml.includes("Page 1") || !xml.includes("Page 3")) throw new Error("text missing: " + xml.slice(0, 300));
    if ((xml.match(/w:type="page"/g) || []).length !== 2) throw new Error("page breaks");
  });

  await step("pdf to ppt: one slide per page with a rendered JPEG and notes", async () => {
    const { bytes } = await convert("pdf-to-ppt", "src.pdf");
    const files = unzipSync(bytes);
    if (!files["ppt/slides/slide3.xml"] || files["ppt/slides/slide4.xml"]) throw new Error("slide count");
    const jpg = files["ppt/media/image2.jpeg"];
    if (!(jpg[0] === 0xff && jpg[1] === 0xd8)) throw new Error("not jpeg");
    if (!strFromU8(files["ppt/notesSlides/notesSlide2.xml"]).includes("Page 2")) throw new Error("notes");
  });

  await step("pdf to excel: sheet per page with the text as cells", async () => {
    const { bytes } = await convert("pdf-to-excel", "src.pdf");
    const files = unzipSync(bytes);
    if (!files["xl/worksheets/sheet3.xml"]) throw new Error("sheets");
    if (!strFromU8(files["xl/worksheets/sheet1.xml"]).includes("Page 1")) throw new Error("cells");
  });

  await step("epub and pages to pdf through the UI", async () => {
    const e = await convert("epub-to-pdf", "book.epub");
    if ((await PDFDocument.load(e.bytes)).getPageCount() !== 2) throw new Error("epub pages");
    const p = await convert("pages-to-pdf", "Letter.pages");
    if (p.name !== "Letter.pdf" || (await PDFDocument.load(p.bytes)).getPageCount() !== 3) throw new Error("pages");
  });

  await step("wrong file type for word-to-pdf is rejected with a message", async () => {
    await page.goto(`${BASE}/tool.html?tool=word-to-pdf`);
    await page.setInputFiles("input[type=file]", join(tmp, "src.pdf"));
    await page.waitForSelector(".toast.error");
    const t = await page.textContent(".toast.error");
    if (!/not .*\.docx/i.test(t)) throw new Error(t);
  });
}
