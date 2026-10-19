// Core tools: merge, split, delete, protect/unlock, images, compress, edit, organize.
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { PDFDocument } from "../../../vendor/pdf-lib.esm.js";
import { unzipSync } from "../../../vendor/fflate.js";

export default async function ({ page, step, BASE, tmp, downloadBytes }) {
  await step("home lists every tool and links to them", async () => {
    await page.goto(`${BASE}/`);
    await page.waitForSelector(".card");
    const cards = await page.$$eval("[data-grid=all] .card", (els) => els.map((e) => e.dataset.tool));
    if (cards.length < 14) throw new Error(`expected at least 14 tool cards, got ${cards.length}`);
    await page.click('[data-grid=all] .card[data-tool="merge-pdf"]');
    await page.waitForSelector("h1:has-text('Merge PDF')");
  });

  await step("merge: two PDFs in, one PDF out with 5 pages", async () => {
    await page.goto(`${BASE}/tool.html?tool=merge-pdf`);
    await page.setInputFiles("input[type=file]", [join(tmp, "a.pdf"), join(tmp, "b.pdf")]);
    await page.waitForSelector(".file >> nth=1");
    await page.click("#run");
    await page.waitForSelector("#download", { timeout: 30_000 });
    const name = await page.textContent("#result-name");
    if (name !== "a + b.pdf") throw new Error(`name ${name}`);
    const { bytes } = await downloadBytes(page, () => page.click("#download"));
    const doc = await PDFDocument.load(bytes);
    if (doc.getPageCount() !== 5) throw new Error(`pages ${doc.getPageCount()}`);
  });

  await step("merge: reorder puts b first", async () => {
    await page.goto(`${BASE}/tool.html?tool=merge-pdf`);
    await page.setInputFiles("input[type=file]", [join(tmp, "a.pdf"), join(tmp, "b.pdf")]);
    await page.waitForSelector(".file >> nth=1");
    await page.click('.file >> nth=1 >> button[title="Move up"]');
    const first = await page.textContent(".file >> nth=0 >> b");
    if (first !== "b.pdf") throw new Error(`first is ${first}`);
    await page.click("#run");
    await page.waitForSelector("#download");
    const name = await page.textContent("#result-name");
    if (name !== "b + a.pdf") throw new Error(`name ${name}`);
  });

  await step("rejects a non-PDF with a message", async () => {
    await page.goto(`${BASE}/tool.html?tool=merge-pdf`);
    await page.setInputFiles("input[type=file]", [join(tmp, "junk.txt")]);
    await page.waitForSelector(".toast.error");
    const t = await page.textContent(".toast.error");
    if (!/not a PDF/.test(t)) throw new Error(t);
  });

  await step("split: every page -> zip with 3 PDFs, thumbnails rendered", async () => {
    await page.goto(`${BASE}/tool.html?tool=split-pdf`);
    await page.setInputFiles("input[type=file]", join(tmp, "b.pdf"));
    await page.waitForSelector(".page >> nth=2");
    await page.waitForFunction(() => [...document.querySelectorAll(".page img")].every((i) => i.src.startsWith("data:image")), null, { timeout: 20_000 });
    await page.click("#run");
    await page.waitForSelector("#download");
    const { name, bytes } = await downloadBytes(page, () => page.click("#download"));
    if (!name.endsWith(".zip")) throw new Error(name);
    const entries = unzipSync(bytes);
    if (Object.keys(entries).length !== 3) throw new Error(`entries ${Object.keys(entries)}`);
  });

  await step("delete pages: select page 2 and remove it", async () => {
    await page.goto(`${BASE}/tool.html?tool=delete-pages`);
    await page.setInputFiles("input[type=file]", join(tmp, "b.pdf"));
    await page.waitForSelector(".page >> nth=2");
    await page.click("#run");
    await page.waitForSelector(".alert.error");
    await page.click(".page >> nth=1");
    await page.click("#run");
    await page.waitForSelector("#download");
    const { bytes } = await downloadBytes(page, () => page.click("#download"));
    if ((await PDFDocument.load(bytes)).getPageCount() !== 2) throw new Error("expected 2 pages");
  });

  await step("protect: password required, result opens only with it; unlock reverses it", async () => {
    await page.goto(`${BASE}/tool.html?tool=protect-pdf`);
    await page.setInputFiles("input[type=file]", join(tmp, "a.pdf"));
    await page.waitForSelector("#run");
    await page.click("#run");
    await page.waitForSelector(".alert.error");
    await page.fill('input[placeholder="Password"]', "s3cret");
    await page.fill('input[placeholder="Repeat password"]', "nope");
    await page.click("#run");
    const err = await page.textContent(".alert.error");
    if (!/do not match/.test(err)) throw new Error(err);
    await page.fill('input[placeholder="Repeat password"]', "s3cret");
    await page.click("#run");
    await page.waitForSelector("#download");
    const { bytes } = await downloadBytes(page, () => page.click("#download"));
    let locked = false;
    try {
      await PDFDocument.load(bytes);
    } catch {
      locked = true;
    }
    if (!locked) throw new Error("result is not encrypted");
    writeFileSync(join(tmp, "locked.pdf"), bytes);

    await page.goto(`${BASE}/tool.html?tool=unlock-pdf`);
    await page.setInputFiles("input[type=file]", join(tmp, "locked.pdf"));
    await page.waitForSelector("#run");
    await page.fill('input[type=password]', "wrong");
    await page.click("#run");
    await page.waitForSelector(".alert.error");
    await page.fill('input[type=password]', "s3cret");
    await page.click("#run");
    await page.waitForSelector("#download");
    const open = await downloadBytes(page, () => page.click("#download"));
    const doc = await PDFDocument.load(open.bytes);
    if (doc.isEncrypted || doc.getPageCount() !== 2) throw new Error("unlock failed");
  });

  await step("locked PDF on another tool asks for the password", async () => {
    await page.goto(`${BASE}/tool.html?tool=number-pages`);
    await page.setInputFiles("input[type=file]", join(tmp, "locked.pdf"));
    await page.waitForSelector(".modal input");
    await page.fill(".modal input", "s3cret");
    await page.click(".modal button[type=submit]");
    await page.waitForSelector("#run");
    await page.click("#run");
    await page.waitForSelector("#download");
  });

  await step("pdf to jpg: zip with one image per page, real JPEG bytes", async () => {
    await page.goto(`${BASE}/tool.html?tool=pdf-to-jpg`);
    await page.setInputFiles("input[type=file]", join(tmp, "a.pdf"));
    await page.waitForSelector("#run");
    await page.click("#run");
    await page.waitForSelector("#download", { timeout: 30_000 });
    const { bytes } = await downloadBytes(page, () => page.click("#download"));
    const entries = unzipSync(bytes);
    const names = Object.keys(entries);
    if (names.length !== 2) throw new Error(names.join());
    const jpg = entries[names[0]];
    if (!(jpg[0] === 0xff && jpg[1] === 0xd8)) throw new Error("not a jpeg");
  });

  await step("jpg to pdf: browser-made JPEG becomes a one-page PDF, then continue to compress", async () => {
    // make a real photo-like JPEG with the browser's canvas
    const dataUrl = await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 1800;
      c.height = 1200;
      const g = c.getContext("2d");
      for (let i = 0; i < 400; i++) {
        g.fillStyle = `hsl(${(i * 37) % 360} 70% ${40 + (i % 30)}%)`;
        g.beginPath();
        g.arc((i * 97) % 1800, (i * 53) % 1200, 20 + (i % 60), 0, Math.PI * 2);
        g.fill();
      }
      return c.toDataURL("image/jpeg", 0.95);
    });
    const jpgBytes = Buffer.from(dataUrl.split(",")[1], "base64");
    writeFileSync(join(tmp, "photo.jpg"), jpgBytes);
    await page.goto(`${BASE}/tool.html?tool=jpg-to-pdf`);
    await page.setInputFiles("input[type=file]", join(tmp, "photo.jpg"));
    await page.waitForSelector("#run");
    await page.click("#run");
    await page.waitForSelector("#download");
    const { bytes } = await downloadBytes(page, () => page.click("#download"));
    const doc = await PDFDocument.load(bytes);
    if (doc.getPageCount() !== 1) throw new Error("pages");
    const before = bytes.length;
    // chain into compress via "Continue with"
    await page.click(".chip:has-text('Compress PDF')");
    await page.waitForSelector("h1:has-text('Compress PDF')");
    await page.waitForSelector("#run");
    await page.click("#run");
    await page.waitForSelector("#download", { timeout: 60_000 });
    const size = await page.textContent("#result-size");
    const out = await downloadBytes(page, () => page.click("#download"));
    if (!(out.bytes.length < before)) throw new Error(`compress did not shrink: ${before} -> ${out.bytes.length} (${size})`);
    const doc2 = await PDFDocument.load(out.bytes);
    if (doc2.getPageCount() !== 1) throw new Error("compressed pages");
  });

  await step("watermark + number pages + flatten run end to end", async () => {
    for (const [id, fill] of [
      ["watermark-pdf", async () => page.fill('input[placeholder="CONFIDENTIAL"]', "DRAFT")],
      ["number-pages", async () => {}],
      ["flatten-pdf", async () => {}],
      ["rotate-pdf", async () => page.click("text=90° clockwise")],
      ["organize-pdf", async () => page.click('.page >> nth=0 >> button[title="Remove page"]')],
      ["extract-pages", async () => page.fill('input[placeholder="1-3, 7"]', "1")],
    ]) {
      await page.goto(`${BASE}/tool.html?tool=${id}`);
      await page.setInputFiles("input[type=file]", join(tmp, "b.pdf"));
      await page.waitForSelector("#run");
      if (id === "organize-pdf") await page.waitForSelector(".page >> nth=2");
      await fill();
      await page.click("#run");
      await page.waitForSelector("#download", { timeout: 30_000 });
      const { bytes } = await downloadBytes(page, () => page.click("#download"));
      const doc = await PDFDocument.load(bytes);
      const expect = id === "organize-pdf" ? 2 : id === "extract-pages" ? 1 : 3;
      if (doc.getPageCount() !== expect) throw new Error(`${id}: pages ${doc.getPageCount()}`);
      if (id === "rotate-pdf" && doc.getPage(0).getRotation().angle !== 90) throw new Error("rotate");
    }
  });

}
