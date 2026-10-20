// Editor family: edit, sign, crop, form filler, reader, redact.
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { PDFDocument, PDFName } from "../../../vendor/pdf-lib.esm.js";

function contentOf(doc, index) {
  const node = doc.getPage(index).node;
  const contents = node.Contents();
  if (!contents) return "";
  const refs = contents.asArray ? contents.asArray() : [node.get(PDFName.of("Contents"))];
  let out = "";
  for (const ref of refs) {
    const stream = doc.context.lookup(ref);
    let bytes = stream.contents;
    try {
      bytes = inflateSync(Buffer.from(bytes));
    } catch {
      /* raw */
    }
    out += new TextDecoder("latin1").decode(bytes) + "\n";
  }
  return out;
}
function hasImage(doc, index) {
  const xo = doc.getPage(index).node.Resources()?.lookup?.(PDFName.of("XObject"));
  if (!xo) return false;
  return xo.keys().some((k) => String(xo.lookup(k).dict?.get(PDFName.of("Subtype"))) === "/Image");
}

export default async function ({ page, step, BASE, tmp, downloadBytes }) {
  const open = async (tool, file) => {
    await page.goto(`${BASE}/tool.html?tool=${tool}`);
    await page.setInputFiles("input[type=file]", join(tmp, file));
    await page.waitForSelector(".ed-stage img[src^='blob:'], .rd-page img[src^='blob:'], .ff-list input, .ff-list select, .ff-empty", { timeout: 30_000 });
  };
  const dragOnStage = async (x1, y1, x2, y2) => {
    const box = await page.locator(".ed-stage").boundingBox();
    await page.mouse.move(box.x + x1, box.y + y1);
    await page.mouse.down();
    await page.mouse.move(box.x + (x1 + x2) / 2, box.y + (y1 + y2) / 2, { steps: 4 });
    await page.mouse.move(box.x + x2, box.y + y2, { steps: 4 });
    await page.mouse.up();
  };

  await step("edit-pdf: text box typed on the page is burned into the PDF", async () => {
    await open("edit-pdf", "a.pdf");
    const before = (await import("node:fs")).statSync(join(tmp, "a.pdf")).size;
    await page.click('.ed-tool[data-tool="text"]');
    await page.click(".ed-stage", { position: { x: 120, y: 120 } });
    await page.waitForSelector(".ed-text:focus");
    await page.keyboard.type("Hello from the editor");
    await page.click('.ed-tool[data-tool="rect"]');
    await dragOnStage(40, 200, 160, 260);
    await page.click("#run");
    await page.waitForSelector("#download", { timeout: 30_000 });
    const { name, bytes } = await downloadBytes(page, () => page.click("#download"));
    if (name !== "a-edited.pdf") throw new Error(name);
    const doc = await PDFDocument.load(bytes);
    if (doc.getPageCount() !== 2) throw new Error("page count changed");
    if (bytes.length <= before) throw new Error("file did not grow");
    const c = contentOf(doc, 0);
    if (!/Tj|TJ/.test(c)) throw new Error("no text drawn on page 1");
    if (!/\bl\b/.test(c)) throw new Error("no rectangle path on page 1");
  });

  await step("edit-pdf: undo removes the last item and Delete removes the selection", async () => {
    await open("edit-pdf", "a.pdf");
    await page.click('.ed-tool[data-tool="rect"]');
    await dragOnStage(40, 40, 140, 100);
    await page.waitForSelector(".ed-svg rect.ed-rect");
    await page.click("#ed-undo");
    if (await page.locator(".ed-svg rect.ed-rect").count()) throw new Error("undo did not remove the rect");
    await page.click("#ed-redo");
    await page.waitForSelector(".ed-svg rect.ed-rect");
    await page.click(".ed-svg rect.ed-rect");
    await page.keyboard.press("Delete");
    if (await page.locator(".ed-svg rect.ed-rect").count()) throw new Error("Delete did not remove the rect");
  });

  await step("sign-pdf: drawn signature is placed and burned in as an image", async () => {
    await open("sign-pdf", "a.pdf");
    // the sign preset opens the signature dialog by itself; fall back to the button if not
    if (!(await page.locator(".sig-canvas").count())) await page.click("#sig-create");
    const c = await page.locator(".sig-canvas").boundingBox();
    await page.mouse.move(c.x + 40, c.y + 100);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) await page.mouse.move(c.x + 40 + i * 30, c.y + 100 + Math.sin(i) * 40, { steps: 2 });
    await page.mouse.up();
    await page.click("#sig-use");
    await page.waitForSelector(".ed-svg image.ed-signature");
    await page.click("#sig-date");
    await page.waitForSelector(".ed-text");
    await page.click("#run");
    await page.waitForSelector("#download", { timeout: 30_000 });
    const { bytes } = await downloadBytes(page, () => page.click("#download"));
    const doc = await PDFDocument.load(bytes);
    if (!hasImage(doc, 0)) throw new Error("no signature image on page 1");
    if (!/Tj|TJ/.test(contentOf(doc, 0))) throw new Error("date text missing");
  });

  await step("crop-pdf: dragged area becomes the CropBox of every page", async () => {
    await open("crop-pdf", "b.pdf");
    await dragOnStage(40, 60, 220, 300);
    await page.waitForSelector(".ed-cropsize");
    const readout = await page.textContent(".ed-cropsize");
    if (!/mm/.test(readout)) throw new Error(readout);
    await page.click("#run");
    await page.waitForSelector("#download", { timeout: 30_000 });
    const { bytes } = await downloadBytes(page, () => page.click("#download"));
    const doc = await PDFDocument.load(bytes);
    for (let i = 0; i < 3; i++) {
      const cb = doc.getPage(i).getCropBox();
      if (!(cb.width < 300 && cb.height < 400 && cb.width > 50)) throw new Error(`page ${i + 1} cropbox ${JSON.stringify(cb)}`);
      if (doc.getPage(i).getMediaBox().width !== 300) throw new Error("media box should be untouched without cut");
    }
  });

  await step("pdf-form-filler: fields are listed, filled and saved", async () => {
    const d = await PDFDocument.create();
    const p = d.addPage([300, 300]);
    const f = d.getForm();
    f.createTextField("name").addToPage(p, { x: 20, y: 240, width: 200, height: 24 });
    f.createCheckBox("agree").addToPage(p, { x: 20, y: 200, width: 20, height: 20 });
    const dd = f.createDropdown("color");
    dd.addOptions(["red", "green"]);
    dd.addToPage(p, { x: 20, y: 160, width: 120, height: 24 });
    writeFileSync(join(tmp, "form.pdf"), await d.save());
    await open("pdf-form-filler", "form.pdf");
    await page.fill('.ff-list input[name="name"]', "Ada Lovelace");
    await page.check('.ff-list input[name="agree"]');
    await page.selectOption('.ff-list select[name="color"]', "green");
    await page.click("#run");
    await page.waitForSelector("#download", { timeout: 30_000 });
    const { bytes } = await downloadBytes(page, () => page.click("#download"));
    const doc = await PDFDocument.load(bytes);
    const form = doc.getForm();
    if (form.getTextField("name").getText() !== "Ada Lovelace") throw new Error("name not saved");
    if (!form.getCheckBox("agree").isChecked()) throw new Error("checkbox not saved");
    if (form.getDropdown("color").getSelected()[0] !== "green") throw new Error("dropdown not saved");
    // a PDF without fields explains itself
    await open("pdf-form-filler", "a.pdf");
    await page.waitForSelector(".ff-empty a[href*='edit-pdf']");
  });

  await step("pdf-reader: pages render, search finds text, download works", async () => {
    await open("pdf-reader", "b.pdf");
    await page.waitForSelector(".rd-page img[src^='blob:']");
    if ((await page.locator(".rd-page").count()) !== 3) throw new Error("expected 3 pages");
    await page.fill(".rd-search", "Page 2");
    await page.keyboard.press("Enter");
    await page.waitForSelector(".rd-hit.current", { timeout: 20_000 });
    const count = await page.textContent(".rd-count");
    if (!/1 \/ 1/.test(count)) throw new Error(`count ${count}`);
    const { name } = await downloadBytes(page, () => page.click("#rd-download"));
    if (name !== "b.pdf") throw new Error(name);
    if (await page.locator("#run").count()) throw new Error("reader should not show a run button");
  });

  await step("redact-pdf: boxed page becomes an image with no text, other pages untouched", async () => {
    await open("redact-pdf", "b.pdf");
    await dragOnStage(20, 20, 200, 120);
    await page.waitForSelector(".ed-svg rect.ed-redact");
    await page.click("#run");
    await page.waitForSelector("#download", { timeout: 60_000 });
    const { name, bytes } = await downloadBytes(page, () => page.click("#download"));
    if (name !== "b-redacted.pdf") throw new Error(name);
    const doc = await PDFDocument.load(bytes);
    if (doc.getPageCount() !== 3) throw new Error("page count changed");
    if (!hasImage(doc, 0)) throw new Error("page 1 is not an image");
    if (/Tj|TJ/.test(contentOf(doc, 0))) throw new Error("text operators still on redacted page");
    if (!/Tj|TJ/.test(contentOf(doc, 1))) throw new Error("page 2 lost its text");
    if (doc.getTitle()) throw new Error("metadata not stripped");
  });

  await step("request-signatures explains itself and links to Sign PDF", async () => {
    await open("request-signatures", "a.pdf");
    await page.waitForSelector(".ff-empty a[href*='sign-pdf']");
    if (await page.locator("#run").count()) throw new Error("no run button expected");
  });
}
