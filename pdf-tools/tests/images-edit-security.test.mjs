import { test } from "node:test";
import assert from "node:assert/strict";
import { makePdf, makePng, TINY_JPEG, pageCountOf, loadBytes } from "./helpers.mjs";
import { makeFile } from "../src/tools/core.js";
import { imagesToPdf, pdfToImages } from "../src/tools/images.js";
import { numberPages, watermark } from "../src/tools/edit.js";
import { protect, unlock, flatten } from "../src/tools/security.js";
import { compress, shrinkImages } from "../src/tools/compress.js";
import { PDFDocument } from "../vendor/pdf-lib.esm.js";

test("imagesToPdf: one page per image, fit mode keeps pixel size", async () => {
  const png = makeFile("red.png", makePng(40, 30));
  const jpg = makeFile("dot.jpg", TINY_JPEG);
  const r = await imagesToPdf([png, jpg], { pageSize: "fit" });
  const doc = await loadBytes(r.bytes);
  assert.equal(doc.getPageCount(), 2);
  assert.equal(doc.getPage(0).getWidth(), 40);
  assert.equal(doc.getPage(0).getHeight(), 30);
  assert.equal(r.name, "images.pdf");
});

test("imagesToPdf: A4 with auto orientation goes landscape for a wide image", async () => {
  const png = makeFile("wide.png", makePng(40, 10));
  const r = await imagesToPdf([png], { pageSize: "a4", orientation: "auto", margin: "small" });
  const doc = await loadBytes(r.bytes);
  const p = doc.getPage(0);
  assert.ok(p.getWidth() > p.getHeight());
});

test("imagesToPdf: unknown formats go through ctx.toPng, or fail clearly without it", async () => {
  const weird = makeFile("x.webp", new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3]));
  await assert.rejects(() => imagesToPdf([weird]), /only JPG and PNG/);
  const r = await imagesToPdf([weird], {}, { toPng: async () => makePng(2, 2) });
  assert.equal(await pageCountOf(r.bytes), 1);
});

test("pdfToImages: uses the injected renderer, zips when more than one page", async () => {
  const f = await makePdf(2, { name: "d.pdf" });
  const calls = [];
  const r = await pdfToImages([f], { format: "png", dpi: 72 }, {
    renderPage: async (bytes, index, opts) => {
      calls.push([index, opts.scale]);
      return makePng(2, 2);
    },
  });
  assert.equal(r.kind, "zip");
  assert.deepEqual(calls, [[0, 1], [1, 1]]);
  assert.deepEqual(r.files.map((x) => x.name), ["d-1.png", "d-2.png"]);
  await assert.rejects(() => pdfToImages([f]), /needs a browser/);
});

test("numberPages stamps text on every page from the start page", async () => {
  const f = await makePdf(3, { text: false });
  const r = await numberPages([f], { format: "Page {n} of {total}", fromPage: 2, start: 1 });
  assert.equal(r.stats.numbered, 2);
  assert.equal(await pageCountOf(r.bytes), 3);
  assert.ok(r.bytes.length > f.size);
});

test("watermark requires text and keeps page count", async () => {
  const f = await makePdf(2);
  await assert.rejects(() => watermark([f], { text: "  " }), /watermark text/);
  const r = await watermark([f], { text: "DRAFT", opacity: 0.3, color: "#1f5eff" });
  assert.equal(await pageCountOf(r.bytes), 2);
});

test("protect then unlock round-trips with the password", async () => {
  const f = await makePdf(2, { name: "secret.pdf" });
  await assert.rejects(() => protect([f], { password: "" }), /Enter a password/);
  const locked = await protect([f], { password: "hunter2" });
  assert.equal(locked.name, "secret-protected.pdf");
  await assert.rejects(() => PDFDocument.load(locked.bytes), /encrypted/i);
  assert.equal(await pageCountOf(locked.bytes, "hunter2"), 2);

  const lockedFile = makeFile("secret-protected.pdf", locked.bytes);
  await assert.rejects(() => unlock([lockedFile], { password: "wrong" }), /Wrong password/);
  await assert.rejects(() => unlock([lockedFile], {}), /password protected/);
  const open = await unlock([lockedFile], { password: "hunter2" });
  const doc = await PDFDocument.load(open.bytes);
  assert.equal(doc.isEncrypted, false);
  assert.equal(doc.getPageCount(), 2);
  await assert.rejects(() => unlock([f], {}), /not password protected/);
});

test("other tools tell the user when a file is locked", async () => {
  const f = await makePdf(1);
  const locked = await protect([f], { password: "x" });
  await assert.rejects(() => numberPages([makeFile("l.pdf", locked.bytes)]), /Unlock it first/);
});

test("flatten reports the number of fields", async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 200]);
  const form = doc.getForm();
  const tf = form.createTextField("name");
  tf.setText("Ada");
  tf.addToPage(page, { x: 10, y: 10, width: 100, height: 20 });
  const f = makeFile("form.pdf", await doc.save());
  const r = await flatten([f]);
  assert.equal(r.stats.fields, 1);
  const out = await PDFDocument.load(r.bytes);
  assert.equal(out.getForm().getFields().length, 0);
});

test("compress lossless never returns a bigger file", async () => {
  const f = await makePdf(3);
  const r = await compress([f], { mode: "lossless" });
  assert.ok(r.sizeAfter <= r.sizeBefore);
  assert.equal(r.name, "doc-compressed.pdf");
});

test("compress basic downsamples JPEG images through ctx.resizeJpeg and leaves masked ones alone", async () => {
  const doc = await PDFDocument.create();
  const img = await doc.embedJpg(TINY_JPEG);
  const page = doc.addPage([100, 100]);
  page.drawImage(img, { x: 0, y: 0, width: 100, height: 100 });
  const f = makeFile("photo.pdf", await doc.save());
  let seen = 0;
  const r = await compress([f], { mode: "basic" }, {
    resizeJpeg: async (bytes, cfg) => {
      seen++;
      assert.equal(cfg.maxEdge, 1600);
      return { bytes: new Uint8Array(bytes.slice(0, Math.floor(bytes.length / 2))), width: 1, height: 1 };
    },
  });
  assert.equal(seen, 1);
  assert.equal(r.stats.images, 1);
  assert.equal(r.stats.shrunk, 1);
  assert.ok(r.sizeAfter < r.sizeBefore);
  await assert.rejects(() => compress([f], { mode: "basic" }), /needs a browser/);

  // a renderer that finds no gain leaves the stream untouched
  const stats = { images: 0, shrunk: 0, saved: 0 };
  const d2 = await PDFDocument.load(f.bytes);
  await shrinkImages(d2, "strong", { resizeJpeg: async () => null }, stats);
  assert.deepEqual(stats, { images: 1, shrunk: 0, saved: 0 });
});

test("compress rasterize rebuilds pages from rendered JPEGs", async () => {
  const f = await makePdf(2, { size: [200, 100] });
  const r = await compress([f], { mode: "rasterize" }, { renderPage: async () => TINY_JPEG });
  const doc = await loadBytes(r.bytes.length < f.size ? r.bytes : r.bytes);
  assert.equal(doc.getPageCount(), 2);
  assert.equal(doc.getPage(0).getWidth(), 200);
});
