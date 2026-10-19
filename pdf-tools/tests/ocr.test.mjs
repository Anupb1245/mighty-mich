import { test } from "node:test";
import assert from "node:assert/strict";
import { makePdf, makePng, loadBytes } from "./helpers.mjs";
import { makeFile, PDFDocument, StandardFonts, degrees } from "../src/tools/core.js";
import { ocr, displayedSize, placeTextLayer } from "../src/tools/ocr.js";

/** A stand-in for tesseract's text-only PDF: one page sized from the image at `dpi`, with visible text. */
async function fakeOcrPage(sizes) {
  return async (bytes, { dpi }) => {
    const { w, h } = sizes(bytes);
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([(w * 72) / dpi, (h * 72) / dpi]);
    page.drawText("OCR TEXT", { x: 10, y: 10, size: 12, font });
    return { text: `recognized ${w}x${h}`, pdf: await doc.save() };
  };
}

test("displayedSize swaps for 90/270", () => {
  assert.deepEqual(displayedSize(300, 400, 0), [300, 400]);
  assert.deepEqual(displayedSize(300, 400, 90), [400, 300]);
  assert.deepEqual(displayedSize(300, 400, 180), [300, 400]);
  assert.deepEqual(displayedSize(300, 400, -90), [400, 300]);
});

test("ocr on a PDF keeps page count, sizes and rotation, adds a text layer, and reports stats", async () => {
  const src = await PDFDocument.create();
  const font = await src.embedFont(StandardFonts.Helvetica);
  src.addPage([300, 400]).drawText("one", { x: 10, y: 10, size: 12, font });
  const p2 = src.addPage([300, 400]);
  p2.drawText("two", { x: 10, y: 10, size: 12, font });
  p2.setRotation(degrees(90));
  const file = makeFile("scan.pdf", await src.save());
  const rendered = [];
  const ctx = {
    renderPage: async (bytes, index, opts) => {
      rendered.push([index, opts.scale, opts.format]);
      // pretend: 300x400pt at scale 2 -> 600x800 px (800x600 when displayed rotated)
      return index === 1 ? makePng(8, 6) : makePng(6, 8);
    },
    ocrPage: await fakeOcrPage((bytes) => ({ w: bytes.length % 2 ? 800 : 600, h: bytes.length % 2 ? 600 : 800 })),
    onProgress: () => {},
  };
  const r = await ocr([file], { lang: "eng", output: "pdf" }, ctx);
  assert.equal(r.name, "scan-searchable.pdf");
  assert.equal(r.pageCount, 2);
  assert.deepEqual(rendered, [[0, 2, "png"], [1, 2, "png"]]);
  const out = await loadBytes(r.bytes);
  assert.equal(out.getPage(0).getWidth(), 300);
  assert.equal(out.getPage(0).getHeight(), 400);
  assert.equal(out.getPage(1).getRotation().angle, 90);
  assert.equal(r.stats.pages, 2);
  // both the original content and the text layer are drawn as form xobjects
  const raw = new TextDecoder("latin1").decode(r.bytes);
  assert.ok((raw.match(/\/Subtype \/Form/g) || []).length >= 4, "expected embedded pages");
});

test("ocr txt output joins page texts", async () => {
  const file = await makePdf(2);
  const ctx = { renderPage: async () => makePng(2, 2), ocrPage: await fakeOcrPage(() => ({ w: 2, h: 2 })) };
  const r = await ocr([file], { output: "txt" }, ctx);
  assert.equal(r.kind, "txt");
  assert.equal(r.name, "doc.txt");
  const text = new TextDecoder().decode(r.bytes);
  assert.equal(text, "recognized 2x2\n\n\nrecognized 2x2");
  assert.equal(r.stats.pages, 2);
});

test("ocr on an image fits the page to A4 width and draws the image", async () => {
  const png = makeFile("photo.png", makePng(40, 20), { kind: "image" });
  const r = await ocr([png], {}, { ocrPage: await fakeOcrPage(() => ({ w: 40, h: 20 })) });
  const out = await loadBytes(r.bytes);
  assert.equal(out.getPageCount(), 1);
  assert.ok(Math.abs(out.getPage(0).getWidth() - 595.28) < 0.01);
  assert.ok(Math.abs(out.getPage(0).getHeight() - 297.64) < 0.01);
});

test("ocr tolerates blank source pages and empty text layers", async () => {
  const src = await PDFDocument.create();
  src.addPage([200, 200]); // no content stream at all
  const file = makeFile("blank.pdf", await src.save());
  const r = await ocr([file], {}, { renderPage: async () => makePng(2, 2), ocrPage: async () => ({ text: "", pdf: new Uint8Array() }) });
  const out = await loadBytes(r.bytes);
  assert.equal(out.getPageCount(), 1);
  assert.equal(out.getPage(0).getWidth(), 200);
});

test("ocr without a renderer or file fails clearly", async () => {
  await assert.rejects(() => ocr([], {}, {}), /Add a PDF/);
  const pdf = await makePdf(1);
  await assert.rejects(() => ocr([pdf], {}, { ocrPage: async () => ({ text: "", pdf: new Uint8Array() }) }), /needs a browser/);
});

test("placeTextLayer maps displayed coordinates back for every rotation", () => {
  // Displayed (rotated) point (u,v) must land on the content point the viewer shows there:
  // rot 90: (u,v) -> (w - v, u); rot 180: (w - u, h - v); rot 270: (v, h - u).
  // With pdf-lib's drawPage rotating CCW about (x,y), the placements below realise exactly that.
  const calls = [];
  const page = { drawPage: (emb, opts) => calls.push({ emb, ...opts, angle: opts.rotate ? opts.rotate.angle : 0 }) };
  for (const rot of [0, 90, 180, 270]) placeTextLayer(page, "emb", { rotation: rot, width: 300, height: 400 });
  assert.deepEqual(
    calls.map(({ x, y, width, height, angle }) => [x, y, width, height, angle]),
    [
      [0, 0, 300, 400, 0],
      [300, 0, 400, 300, 90],
      [300, 400, 300, 400, 180],
      [0, 400, 400, 300, -90],
    ]
  );
  // check the mapping numerically for 90°: apply translate+rotate to displayed corners
  const map = (u, v, { x, y, angle }) => {
    const r = (angle * Math.PI) / 180;
    return [Math.round(x + u * Math.cos(r) - v * Math.sin(r)), Math.round(y + u * Math.sin(r) + v * Math.cos(r))];
  };
  assert.deepEqual(map(0, 300, calls[1]), [0, 0]); // displayed top-left -> content bottom-left
  assert.deepEqual(map(400, 300, calls[1]), [0, 400]); // displayed top-right -> content top-left
  assert.deepEqual(map(0, 0, calls[3]), [0, 400]); // 270: displayed bottom-left -> content top-left
  assert.deepEqual(map(300, 0, calls[2]), [0, 400]); // 180: displayed bottom-right -> content top-left
});
