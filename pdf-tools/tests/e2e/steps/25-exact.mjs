// Exact-layout Office conversions: real layout engines in the page, rasterized, with a text layer.
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { PDFDocument } from "../../../vendor/pdf-lib.esm.js";
import { unzipSync, strFromU8 } from "../../../vendor/fflate.js";
import { zipFiles } from "../../../src/zip.js";
import { buildPptx } from "../../../src/tools/officeOut.js";
import { TINY_JPEG, textOfPdf } from "../../helpers.mjs";

const enc = (s) => new TextEncoder().encode(s);

function styledDocx() {
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:color w:val="C00000"/><w:sz w:val="48"/></w:rPr><w:t>Quarterly Report</w:t></w:r></w:p>
<w:p><w:r><w:t xml:space="preserve">Plain paragraph with </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>bold words</w:t></w:r><w:r><w:t xml:space="preserve"> and </w:t></w:r><w:r><w:rPr><w:i/><w:color w:val="1F5EFF"/></w:rPr><w:t>blue italics</w:t></w:r><w:r><w:t>.</w:t></w:r></w:p>
<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/></w:tblPr><w:tr><w:tc><w:tcPr><w:shd w:val="clear" w:fill="1F5EFF"/></w:tcPr><w:p><w:r><w:rPr><w:color w:val="FFFFFF"/><w:b/></w:rPr><w:t>Region</w:t></w:r></w:p></w:tc><w:tc><w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:t>1,250</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
<w:p><w:r><w:br w:type="page"/></w:r></w:p>
<w:p><w:r><w:t>Second page text</w:t></w:r></w:p>
<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>
</w:body></w:document>`;
  return zipFiles([
    { name: "[Content_Types].xml", data: enc(`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`) },
    { name: "_rels/.rels", data: enc(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`) },
    { name: "word/document.xml", data: enc(doc) },
  ]);
}

async function styledXlsx() {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sales");
  ws.columns = [{ header: "Region", key: "r", width: 18 }, { header: "Revenue", key: "v", width: 14 }, { header: "Note", key: "n", width: 30 }];
  ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F5EFF" } };
  for (let i = 0; i < 120; i++) ws.addRow({ r: `Region ${i}`, v: 1000 + i * 37.5, n: i % 5 === 0 ? "Highlighted row with a longer note" : "" });
  ws.getCell("A7").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFE599" } };
  ws.mergeCells("A125:C125");
  ws.getCell("A125").value = "Merged footer";
  ws.getCell("A125").alignment = { horizontal: "center" };
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

function deckPptx() {
  // our own writer's deck, with the defaultTextStyle part real decks carry
  const entries = unzipSync(buildPptx([{ width: 4, height: 3, image: TINY_JPEG, notes: "one" }, { width: 4, height: 3, image: TINY_JPEG, notes: "two" }, { width: 4, height: 3, image: TINY_JPEG, notes: "three" }]));
  const pres = strFromU8(entries["ppt/presentation.xml"]).replace("</p:presentation>", '<p:defaultTextStyle><a:defPPr xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"/></p:defaultTextStyle></p:presentation>');
  entries["ppt/presentation.xml"] = enc(pres);
  return zipFiles(Object.entries(entries).map(([name, data]) => ({ name, data })));
}

export default async function ({ page, step, BASE, tmp, downloadBytes }) {
  writeFileSync(join(tmp, "styled.docx"), styledDocx());
  writeFileSync(join(tmp, "styled.xlsx"), await styledXlsx());
  writeFileSync(join(tmp, "deck.pptx"), deckPptx());

  const convert = async (id, file, chooseText = false) => {
    await page.goto(`${BASE}/tool.html?tool=${id}`);
    await page.setInputFiles("input[type=file]", join(tmp, file));
    await page.waitForSelector("#run");
    if (chooseText) await page.click("text=Text only");
    await page.click("#run");
    await page.waitForSelector("#download", { timeout: 120_000 });
    return downloadBytes(page, () => page.click("#download"));
  };
  const hasImage = (bytes) => /\/Subtype\s*\/Image/.test(new TextDecoder("latin1").decode(bytes));

  await step("exact word to pdf: Letter pages, raster look, searchable text layer", async () => {
    const { name, bytes } = await convert("word-to-pdf", "styled.docx");
    if (name !== "styled.pdf") throw new Error(name);
    const doc = await PDFDocument.load(bytes);
    if (doc.getPageCount() !== 2) throw new Error("pages " + doc.getPageCount());
    const p = doc.getPage(0);
    if (Math.abs(p.getWidth() - 612) > 1 || Math.abs(p.getHeight() - 792) > 1) throw new Error(`size ${p.getWidth()}x${p.getHeight()}`);
    if (!hasImage(bytes)) throw new Error("no raster page image");
    const texts = await textOfPdf(bytes);
    if (!/Quarterly Report/.test(texts[0]) || !/bold words/.test(texts[0]) || !/Second page text/.test(texts[1])) throw new Error(JSON.stringify(texts));
  });

  await step("exact excel to pdf: styled sheet across pages, merged footer kept", async () => {
    const { bytes } = await convert("excel-to-pdf", "styled.xlsx");
    const doc = await PDFDocument.load(bytes);
    if (doc.getPageCount() < 2) throw new Error("expected the long sheet to span pages, got " + doc.getPageCount());
    if (!hasImage(bytes)) throw new Error("no raster page image");
    const texts = await textOfPdf(bytes);
    const all = texts.join(" ");
    if (!/Region 119/.test(all) || !/Merged footer/.test(all) || !/Revenue/.test(all)) throw new Error(all.slice(0, 200));
  });

  await step("exact ppt to pdf: one page per slide, 4:3", async () => {
    const { bytes } = await convert("ppt-to-pdf", "deck.pptx");
    const doc = await PDFDocument.load(bytes);
    if (doc.getPageCount() !== 3) throw new Error("pages " + doc.getPageCount());
    const p = doc.getPage(0);
    if (Math.abs(p.getWidth() / p.getHeight() - 4 / 3) > 0.02) throw new Error(`ratio ${p.getWidth()}x${p.getHeight()}`);
    if (!hasImage(bytes)) throw new Error("no raster page image");
  });

  await step("text-only mode still available and smaller", async () => {
    const exact = await convert("word-to-pdf", "styled.docx");
    const text = await convert("word-to-pdf", "styled.docx", true);
    if (!(text.bytes.length < exact.bytes.length)) throw new Error(`text ${text.bytes.length} vs exact ${exact.bytes.length}`);
    if ((await PDFDocument.load(text.bytes)).getPageCount() !== 2) throw new Error("text pages");
  });
}
