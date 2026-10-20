// Text/CSV/ZIP conversions, PDF/A, PDF to PNG, scanner, converter hub, share, mega-menu.
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { PDFDocument } from "../../../vendor/pdf-lib.esm.js";
import { unzipSync } from "../../../vendor/fflate.js";
import { zipFiles } from "../../../src/zip.js";
import { makePng } from "../../helpers.mjs";

export default async function ({ page, step, BASE, tmp, downloadBytes }) {
  const run = async (id, path, before) => {
    await page.goto(`${BASE}/tool.html?tool=${id}`);
    await page.setInputFiles("input[type=file]", path);
    await page.waitForSelector("#run");
    if (before) await before();
    await page.click("#run");
    await page.waitForSelector("#download", { timeout: 60_000 });
    return downloadBytes(page, () => page.click("#download"));
  };

  await step("mega-menu lists every category and links to a tool", async () => {
    await page.goto(`${BASE}/`);
    await page.click(".nav-tools");
    await page.waitForSelector(".mega:not([hidden])");
    const heads = await page.$$eval(".mega-head", (els) => els.map((e) => e.textContent));
    if (!heads.includes("Organize") || !heads.includes("Convert to PDF")) throw new Error(heads.join(","));
    await page.click('.mega-item[href="tool.html?tool=txt-to-pdf"]');
    await page.waitForSelector("h1:has-text('TXT to PDF')");
  });

  await step("txt to pdf with unicode text", async () => {
    writeFileSync(join(tmp, "notes.txt"), "Hello Привет Ελλάδα\n".repeat(120));
    const { name, bytes } = await run("txt-to-pdf", join(tmp, "notes.txt"));
    if (name !== "notes.pdf") throw new Error(name);
    const doc = await PDFDocument.load(bytes);
    if (doc.getPageCount() < 2) throw new Error("pages " + doc.getPageCount());
    // browser subsetting should keep the font small
    if (bytes.length > 300_000) throw new Error(`font not subset? ${bytes.length} bytes`);
  });

  await step("csv to pdf and the wrong file type is refused", async () => {
    writeFileSync(join(tmp, "data.csv"), "a,b,c\n1,2,3\n4,5,6\n");
    const { bytes } = await run("csv-to-pdf", join(tmp, "data.csv"), () => page.click("text=Landscape page"));
    const doc = await PDFDocument.load(bytes);
    const p = doc.getPage(0);
    if (!(p.getWidth() > p.getHeight())) throw new Error("not landscape");
    await page.goto(`${BASE}/tool.html?tool=csv-to-pdf`);
    await page.setInputFiles("input[type=file]", join(tmp, "a.pdf"));
    await page.waitForSelector(".toast.error");
    const t = await page.textContent(".toast.error");
    if (!/\.csv/.test(t)) throw new Error(t);
  });

  await step("zip to pdf combines a pdf, an image and a text file", async () => {
    const { readFileSync } = await import("node:fs");
    const zip = zipFiles([
      { name: "1.pdf", data: new Uint8Array(readFileSync(join(tmp, "a.pdf"))) },
      { name: "2.png", data: makePng(20, 20) },
      { name: "3.txt", data: new TextEncoder().encode("hi") },
    ]);
    writeFileSync(join(tmp, "bundle.zip"), zip);
    const { bytes } = await run("zip-to-pdf", join(tmp, "bundle.zip"));
    if ((await PDFDocument.load(bytes)).getPageCount() !== 4) throw new Error("pages");
  });

  await step("pdf to pdf/a and pdf to png", async () => {
    const a = await run("pdf-to-pdfa", join(tmp, "a.pdf"));
    if (!a.name.endsWith("-pdfa.pdf")) throw new Error(a.name);
    const p = await run("pdf-to-png", join(tmp, "a.pdf"));
    const entries = unzipSync(p.bytes);
    const names = Object.keys(entries);
    if (names.length !== 2 || !names[0].endsWith(".png")) throw new Error(names.join());
    const png = entries[names[0]];
    if (!(png[0] === 0x89 && png[1] === 0x50)) throw new Error("not png");
  });

  await step("scanner enhances a photo and makes a PDF", async () => {
    const dataUrl = await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 800;
      c.height = 1000;
      const g = c.getContext("2d");
      const grad = g.createLinearGradient(0, 0, 800, 1000);
      grad.addColorStop(0, "#d9d2c5");
      grad.addColorStop(1, "#8f8a80");
      g.fillStyle = grad;
      g.fillRect(0, 0, 800, 1000);
      g.fillStyle = "#222";
      g.font = "40px sans-serif";
      for (let i = 0; i < 12; i++) g.fillText("Scanned line number " + i, 60, 100 + i * 70);
      return c.toDataURL("image/jpeg", 0.9);
    });
    writeFileSync(join(tmp, "photo-page.jpg"), Buffer.from(dataUrl.split(",")[1], "base64"));
    for (const mode of ["Document", "Black & white"]) {
      const { name, bytes } = await run("pdf-scanner", join(tmp, "photo-page.jpg"), () => page.click(`text=${mode}`));
      if (name !== "scan.pdf") throw new Error(name);
      if ((await PDFDocument.load(bytes)).getPageCount() !== 1) throw new Error("pages");
    }
  });

  await step("converter hub shows conversions and routes a dropped PDF", async () => {
    await page.goto(`${BASE}/tool.html?tool=pdf-converter`);
    await page.waitForSelector(".card");
    const n = await page.$$eval(".grid .card", (els) => els.length);
    if (n < 5) throw new Error(`only ${n} hub cards`);
    await page.setInputFiles("input[type=file]", join(tmp, "a.pdf"));
    await page.waitForFunction(() => !/pdf-converter/.test(location.search), null, { timeout: 10_000 });
  });

  await step("share pdf offers a download when sharing is unsupported", async () => {
    await page.goto(`${BASE}/tool.html?tool=share-pdf`);
    await page.setInputFiles("input[type=file]", join(tmp, "a.pdf"));
    await page.waitForSelector(".panel.custom button");
    const { name } = await downloadBytes(page, () => page.click(".panel.custom button:has-text('Download')"));
    if (name !== "a.pdf") throw new Error(name);
  });
}
