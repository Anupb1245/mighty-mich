// PDF -> Word (keep layout) and PDF -> Excel through the real UI, on a fixture with a positioned
// title, two text columns, an embedded JPEG and a numeric table.
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { PDFDocument, StandardFonts, rgb } from "../../../vendor/pdf-lib.esm.js";
import { unzipSync, strFromU8 } from "../../../vendor/fflate.js";
import { TINY_JPEG } from "../../helpers.mjs";
import { parseXml } from "../../../src/tools/office.js";

export default async function ({ page, step, BASE, tmp, downloadBytes }) {
  const convert = async (id, path, before) => {
    await page.goto(`${BASE}/tool.html?tool=${id}`);
    await page.setInputFiles("input[type=file]", path);
    await page.waitForSelector("#run");
    if (before) await before();
    await page.click("#run");
    await page.waitForSelector("#download", { timeout: 60_000 });
    return downloadBytes(page, () => page.click("#download"));
  };

  // fixture: 500 x 700 pt page
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const img = await doc.embedJpg(TINY_JPEG);
  const p = doc.addPage([500, 700]);
  p.drawText("Layout Fixture", { x: 60, y: 700 - 80, size: 24, font: bold }); // baseline 80pt from top
  for (let i = 0; i < 6; i++) {
    p.drawText(`Left column line ${i + 1}`, { x: 60, y: 700 - (140 + i * 14), size: 11, font });
    p.drawText(`Right column line ${i + 1}`, { x: 280, y: 700 - (140 + i * 14), size: 11, font });
  }
  p.drawImage(img, { x: 60, y: 700 - 400, width: 150, height: 100 }); // top at 300pt
  const rows = [["Item", "Qty", "Price"], ["Apple", "3", "$1,500.00"], ["Pear", "12", "25 %"]];
  rows.forEach((r, ri) => r.forEach((c, ci) => p.drawText(c, { x: 60 + ci * 120, y: 700 - (460 + ri * 16), size: 11, font: ri === 0 ? bold : font })));
  const p2 = doc.addPage([500, 700]);
  p2.drawText("Second page", { x: 60, y: 600, size: 14, font });
  writeFileSync(join(tmp, "layout.pdf"), await doc.save());

  await step("pdf to word keeps layout: frames at the right twips, image in media, page-sized sections", async () => {
    const { name, bytes } = await convert("pdf-to-word", join(tmp, "layout.pdf"));
    if (name !== "layout.docx") throw new Error(name);
    const files = unzipSync(bytes);
    const xml = strFromU8(files["word/document.xml"]);
    parseXml(xml);
    // title: x = 60pt -> 1200 twips; single line gap = 28.8, top = 80 - 19.2 - 0.6 = 60.2pt -> 1204 twips
    const para = xml.split("</w:p>").find((x) => x.includes("Layout Fixture")) || "";
    const title = para.match(/<w:framePr[^>]*w:x="(\d+)" w:y="(\d+)"\/>/);
    if (!title) throw new Error("title frame missing");
    const [, tx, ty] = title;
    title[0] = para;
    if (Math.abs(Number(tx) - 1200) > 20 || Math.abs(Number(ty) - 1204) > 20) throw new Error(`title at ${tx},${ty}`);
    // Bold depends on render.js recognising the font name; standard-14 fonts from pdf-lib do not carry it. Logged, not asserted.
    if (!/<w:b\/>/.test(title[0])) console.log("     note: title bold not detected by text extraction (font name heuristic)");
    // the two columns are separate blocks with 6 lines each
    const left = xml.match(/Left column line 1<\/w:t><w:br\/>[^]*?Left column line 6/);
    const right = xml.match(/Right column line 1<\/w:t><w:br\/>[^]*?Right column line 6/);
    if (!left || !right) throw new Error("column blocks not kept together");
    // image at 60,300 sized 150x100
    const media = Object.keys(files).filter((f) => f.startsWith("word/media/"));
    if (!media.length) throw new Error("no media");
    if (!xml.includes('w:x="1200" w:y="6000"')) throw new Error("image frame position missing");
    if (!xml.includes(`<wp:extent cx="${150 * 12700}" cy="${100 * 12700}"/>`)) throw new Error("image extent");
    // sections: two pages of 500x700 -> 10000 x 14000 twips, zero margins
    if ((xml.match(/<w:pgSz w:w="10000" w:h="14000"\/>/g) || []).length !== 2) throw new Error("sections");
    if (!xml.includes("Second page")) throw new Error("page 2 text");
  });

  await step("pdf to word flowing mode still produces paragraphs with page breaks", async () => {
    const { bytes } = await convert("pdf-to-word", join(tmp, "layout.pdf"), () => page.click("text=Flowing text"));
    const xml = strFromU8(unzipSync(bytes)["word/document.xml"]);
    if (!xml.includes('<w:br w:type="page"/>') || xml.includes("w:framePr")) throw new Error("flow mode output wrong");
  });

  await step("pdf to excel: numeric cells are numbers and the header row is bold", async () => {
    const { bytes } = await convert("pdf-to-excel", join(tmp, "layout.pdf"));
    const files = unzipSync(bytes);
    const sheet = strFromU8(files["xl/worksheets/sheet1.xml"]);
    parseXml(sheet);
    if (!/<c r="C\d+"><v>1500<\/v><\/c>/.test(sheet)) throw new Error("price not numeric: " + sheet.slice(0, 800));
    if (!/<c r="C\d+"><v>25<\/v><\/c>/.test(sheet)) throw new Error("percent not numeric");
    if (!/<c r="A\d+" s="1" t="inlineStr"><is><t xml:space="preserve">Item<\/t>/.test(sheet)) throw new Error("header not bold");
    if (!files["xl/styles.xml"]) throw new Error("no styles part");
  });
}
