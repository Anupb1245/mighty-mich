import { test } from "node:test";
import assert from "node:assert/strict";
import { makePdf, pageCountOf, loadBytes } from "./helpers.mjs";
import { merge, split, rotate, deletePages, extractPages, organize } from "../src/tools/organize.js";
import { parseRanges, defaultPages, ToolError } from "../src/tools/core.js";
import { unzipSync } from "../vendor/fflate.js";

test("merge joins files in order and reports sizes", async () => {
  const a = await makePdf(2, { name: "a.pdf" });
  const b = await makePdf(3, { name: "b.pdf" });
  const r = await merge([a, b]);
  assert.equal(r.kind, "pdf");
  assert.equal(r.pageCount, 5);
  assert.equal(await pageCountOf(r.bytes), 5);
  assert.equal(r.sizeBefore, a.size + b.size);
  assert.equal(r.name, "a + b.pdf");
});

test("merge respects reordering and per-page rotation from the UI", async () => {
  const a = await makePdf(2, { name: "a.pdf", size: [100, 200] });
  const b = await makePdf(1, { name: "b.pdf", size: [300, 300] });
  a.pages = [
    { index: 1, rotation: 90, selected: false },
    { index: 0, rotation: 0, selected: false },
  ];
  const r = await merge([b, a]);
  const doc = await loadBytes(r.bytes);
  assert.equal(doc.getPageCount(), 3);
  assert.equal(doc.getPage(0).getWidth(), 300);
  assert.equal(doc.getPage(1).getRotation().angle, 90);
});

test("merge needs two files", async () => {
  const a = await makePdf(1);
  await assert.rejects(() => merge([a]), (e) => e instanceof ToolError && e.code === "need_two");
});

test("merge rejects a non-PDF with a readable error", async () => {
  const a = await makePdf(1);
  const junk = { name: "x.txt", bytes: new Uint8Array([1, 2, 3, 4, 5]), size: 5 };
  await assert.rejects(() => merge([a, junk]), /not a PDF/);
});

test("split every page returns a zip with one PDF per page", async () => {
  const f = await makePdf(3, { name: "r.pdf" });
  const r = await split([f], { mode: "every" });
  assert.equal(r.kind, "zip");
  const entries = unzipSync(r.bytes);
  const names = Object.keys(entries).sort();
  assert.deepEqual(names, ["r-page-1.pdf", "r-page-2.pdf", "r-page-3.pdf"]);
  assert.equal(await pageCountOf(entries["r-page-2.pdf"]), 1);
  assert.equal(r.files.length, 3);
});

test("split by ranges makes one file per range", async () => {
  const f = await makePdf(6, { name: "r.pdf" });
  const r = await split([f], { mode: "ranges", ranges: "1-2, 4, 5-6" });
  const entries = unzipSync(r.bytes);
  assert.deepEqual(Object.keys(entries).sort(), ["r-part-1.pdf", "r-part-2.pdf", "r-part-3.pdf"]);
  assert.equal(await pageCountOf(entries["r-part-1.pdf"]), 2);
});

test("split in chunks of N", async () => {
  const f = await makePdf(5, { name: "c.pdf" });
  const r = await split([f], { mode: "chunks", every: 2 });
  const entries = unzipSync(r.bytes);
  assert.equal(Object.keys(entries).length, 3);
  assert.equal(await pageCountOf(entries["c-part-3.pdf"]), 1);
});

test("split with a single range returns a plain PDF, not a zip", async () => {
  const f = await makePdf(4, { name: "s.pdf" });
  const r = await split([f], { mode: "ranges", ranges: "2-3" });
  assert.equal(r.kind, "pdf");
  assert.equal(await pageCountOf(r.bytes), 2);
});

test("parseRanges validates", () => {
  assert.deepEqual(parseRanges("1-3,5", 5), [[0, 1, 2], [4]]);
  assert.deepEqual(parseRanges("3-1", 5), [[0, 1, 2]]);
  assert.throws(() => parseRanges("", 5), /at least one/);
  assert.throws(() => parseRanges("0", 5), /outside/);
  assert.throws(() => parseRanges("7", 5), /outside/);
  assert.throws(() => parseRanges("a-b", 5), /not a page/);
});

test("rotate applies a global angle on top of per-page rotation", async () => {
  const f = await makePdf(2);
  f.pages = defaultPages(2);
  f.pages[1].rotation = 90;
  const r = await rotate([f], { angle: 90 });
  const doc = await loadBytes(r.bytes);
  assert.equal(doc.getPage(0).getRotation().angle, 90);
  assert.equal(doc.getPage(1).getRotation().angle, 180);
});

test("deletePages removes the selected pages and refuses to delete all", async () => {
  const f = await makePdf(3);
  f.pages = defaultPages(3);
  f.pages[1].selected = true;
  const r = await deletePages([f]);
  assert.equal(r.pageCount, 2);
  f.pages.forEach((p) => (p.selected = true));
  await assert.rejects(() => deletePages([f]), /at least one page/);
  f.pages.forEach((p) => (p.selected = false));
  await assert.rejects(() => deletePages([f]), /Select the pages/);
});

test("extractPages keeps selected pages, or a typed range", async () => {
  const f = await makePdf(4);
  f.pages = defaultPages(4);
  f.pages[0].selected = true;
  f.pages[3].selected = true;
  const r = await extractPages([f]);
  assert.equal(r.pageCount, 2);
  const r2 = await extractPages([{ ...f, pages: null }], { ranges: "2-3" });
  assert.equal(r2.pageCount, 2);
});

test("organize assembles the edited page list", async () => {
  const f = await makePdf(3, { size: [100, 100] });
  f.pages = [
    { index: 2, rotation: 0, selected: false },
    { index: 0, rotation: 270, selected: false },
  ];
  const r = await organize([f]);
  const doc = await loadBytes(r.bytes);
  assert.equal(doc.getPageCount(), 2);
  assert.equal(doc.getPage(1).getRotation().angle, 270);
});
