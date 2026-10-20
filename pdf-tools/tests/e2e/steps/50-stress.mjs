// Awkward inputs through the real UI: big files, rotated pages with forms and images,
// truncated files, unusual image formats. Timings are logged so regressions show up.
import { join } from "node:path";
import { writeFileSync, readFileSync } from "node:fs";
import { PDFDocument, StandardFonts, degrees, rgb } from "../../../vendor/pdf-lib.esm.js";
import { unzipSync, strFromU8 } from "../../../vendor/fflate.js";
import { TINY_JPEG, textOfPdf } from "../../helpers.mjs";

export default async function ({ page, step, BASE, tmp, downloadBytes, consoleErrors }) {
  const run = async (id, path, before, timeout = 90_000) => {
    const t = Date.now();
    await page.goto(`${BASE}/tool.html?tool=${id}`);
    await page.setInputFiles("input[type=file]", path);
    await page.waitForSelector("#run", { timeout });
    if (before) await before();
    await page.click("#run");
    await page.waitForSelector("#download", { timeout });
    const r = await downloadBytes(page, () => page.click("#download"));
    r.ms = Date.now() - t;
    return r;
  };

  // fixtures
  const big = await PDFDocument.create();
  const font = await big.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 150; i++) {
    const p = big.addPage([595, 842]);
    for (let l = 0; l < 40; l++) p.drawText(`Page ${i} line ${l + 1}: the quick brown fox jumps over the lazy dog`, { x: 40, y: 800 - l * 18, size: 10, font });
  }
  writeFileSync(join(tmp, "big.pdf"), await big.save());

  const cx = await PDFDocument.create();
  const f2 = await cx.embedFont(StandardFonts.HelveticaBold);
  const img = await cx.embedJpg(TINY_JPEG);
  const p1 = cx.addPage([400, 600]);
  p1.drawText("Invoice 2026-001", { x: 40, y: 540, size: 24, font: f2 });
  p1.drawImage(img, { x: 40, y: 300, width: 200, height: 150 });
  const p2 = cx.addPage([400, 600]);
  p2.setRotation(degrees(90));
  p2.drawText("Rotated page with secret text", { x: 40, y: 300, size: 18, font: f2 });
  const p3 = cx.addPage([400, 600]);
  const form = cx.getForm();
  const tf = form.createTextField("customer.name");
  tf.setText("Ada Lovelace");
  tf.addToPage(p3, { x: 40, y: 500, width: 250, height: 24 });
  const cb = form.createCheckBox("paid");
  cb.addToPage(p3, { x: 40, y: 450, width: 18, height: 18 });
  p3.drawText("Form page", { x: 40, y: 560, size: 18, font: f2 });
  cx.setTitle("Complex fixture");
  writeFileSync(join(tmp, "complex.pdf"), await cx.save());

  const a = readFileSync(join(tmp, "a.pdf"));
  writeFileSync(join(tmp, "truncated.pdf"), a.subarray(0, Math.floor(a.length * 0.55)));

  await step("stress: 150-page PDF renders its page grid and splits in chunks", async () => {
    const t = Date.now();
    await page.goto(`${BASE}/tool.html?tool=split-pdf`);
    await page.setInputFiles("input[type=file]", join(tmp, "big.pdf"));
    await page.waitForFunction(() => document.querySelectorAll(".page").length === 150, null, { timeout: 60_000 });
    await page.waitForFunction(() => [...document.querySelectorAll(".page img")].filter((i) => i.src.startsWith("data:")).length >= 150, null, { timeout: 120_000 });
    console.log(`     150 thumbnails in ${Date.now() - t}ms`);
    await page.click("text=Every N pages");
    await page.fill('input[type=number][aria-label="Pages per file"]', "50");
    await page.click("#run");
    await page.waitForSelector("#download", { timeout: 120_000 });
    const { bytes } = await downloadBytes(page, () => page.click("#download"));
    const entries = unzipSync(bytes);
    if (Object.keys(entries).length !== 3) throw new Error(Object.keys(entries).join());
    console.log(`     split done in ${Date.now() - t}ms total`);
  });

  await step("stress: 150-page PDF through compress and pdf-to-word within time", async () => {
    const c = await run("compress-pdf", join(tmp, "big.pdf"), null, 120_000);
    console.log(`     compress ${c.ms}ms, ${c.bytes.length} bytes`);
    const w = await run("pdf-to-word", join(tmp, "big.pdf"), null, 180_000);
    console.log(`     pdf-to-word ${w.ms}ms, ${w.bytes.length} bytes`);
    const docx = unzipSync(w.bytes);
    const xml = strFromU8(docx["word/document.xml"]);
    if (!xml.includes("Page 150 line 40")) throw new Error("last line missing from docx");
    if (w.ms > 180_000) throw new Error("too slow");
  });

  await step("stress: rotated page + image + form through compress, redact, edit, form filler, pdf-to-word", async () => {
    const c = await run("compress-pdf", join(tmp, "complex.pdf"));
    if ((await PDFDocument.load(c.bytes)).getPageCount() !== 3) throw new Error("compress pages");

    // redact the rotated page: draw a box on page 2
    await page.goto(`${BASE}/tool.html?tool=redact-pdf`);
    await page.setInputFiles("input[type=file]", join(tmp, "complex.pdf"));
    await page.waitForSelector(".panel.custom");
    await page.fill(".ed-pageno", "2");
    await page.press(".ed-pageno", "Enter");
    await page.dispatchEvent(".ed-pageno", "change");
    await page.waitForTimeout(800);
    const area = await page.$(".ed-stage");
    const box = await area.boundingBox();
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.5, { steps: 8 });
    await page.mouse.up();
    await page.click("#run");
    await page.waitForSelector("#download", { timeout: 60_000 });
    const r = await downloadBytes(page, () => page.click("#download"));
    const rd = await PDFDocument.load(r.bytes);
    if (rd.getPageCount() !== 3) throw new Error("redact pages");
    const texts = await textOfPdf(r.bytes);
    if (/secret/.test(texts[1])) throw new Error("rotated page text survived redaction: " + texts[1]);
    if (!/Invoice 2026-001/.test(texts[0]) || !/Form page/.test(texts[2])) throw new Error("untouched pages lost text: " + JSON.stringify(texts));

    const w = await run("pdf-to-word", join(tmp, "complex.pdf"));
    const xml = strFromU8(unzipSync(w.bytes)["word/document.xml"]);
    if (!xml.includes("Invoice 2026-001") || !xml.includes("Rotated page")) throw new Error("docx text missing");

    // form filler: field is listed with its value, checkbox toggles
    await page.goto(`${BASE}/tool.html?tool=pdf-form-filler`);
    await page.setInputFiles("input[type=file]", join(tmp, "complex.pdf"));
    await page.waitForSelector(".panel.custom input");
    const val = await page.inputValue('.panel.custom input[type="text"]');
    if (val !== "Ada Lovelace") throw new Error(`field value ${val}`);
    await page.fill('.panel.custom input[type="text"]', "Grace Hopper");
    await page.click('.panel.custom input[type="checkbox"]');
    await page.click("#run");
    await page.waitForSelector("#download", { timeout: 60_000 });
    const ff = await downloadBytes(page, () => page.click("#download"));
    const fd = await PDFDocument.load(ff.bytes);
    if (fd.getForm().getTextField("customer.name").getText() !== "Grace Hopper") throw new Error("text field not saved");
    if (!fd.getForm().getCheckBox("paid").isChecked()) throw new Error("checkbox not saved");
  });

  await step("stress: a truncated PDF gives a readable error and no page errors", async () => {
    const before = consoleErrors.length;
    await page.goto(`${BASE}/tool.html?tool=compress-pdf`);
    await page.setInputFiles("input[type=file]", join(tmp, "truncated.pdf"));
    const toast = await page.waitForSelector(".toast.error, .alert.error, #run", { timeout: 30_000 });
    const cls = await toast.getAttribute("class");
    if (cls === null || /run/.test(await toast.getAttribute("id") || "")) {
      // pdf.js may still open a truncated file; then the tool must either succeed or fail cleanly
      await page.click("#run");
      await page.waitForSelector("#download, .alert.error", { timeout: 60_000 });
    }
    const errs = consoleErrors.slice(before).filter((e) => !/favicon/.test(e));
    if (errs.length) throw new Error("console: " + errs.slice(0, 2).join(" | "));
  });

  await step("stress: WebP image converts through the browser decoder", async () => {
    const dataUrl = await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 300;
      c.height = 200;
      const g = c.getContext("2d");
      g.fillStyle = "#1f5eff";
      g.fillRect(0, 0, 300, 200);
      g.fillStyle = "#fff";
      g.font = "40px sans-serif";
      g.fillText("webp", 80, 120);
      return c.toDataURL("image/webp", 0.9);
    });
    if (!dataUrl.startsWith("data:image/webp")) throw new Error("browser produced no webp");
    writeFileSync(join(tmp, "pic.webp"), Buffer.from(dataUrl.split(",")[1], "base64"));
    const { bytes } = await run("jpg-to-pdf", join(tmp, "pic.webp"));
    const doc = await PDFDocument.load(bytes);
    if (doc.getPageCount() !== 1 || doc.getPage(0).getWidth() !== 300) throw new Error("webp page");
  });
}
