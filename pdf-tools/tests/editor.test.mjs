import { test } from "node:test";
import assert from "node:assert/strict";
import { makePdf, makePng, TINY_JPEG, loadBytes } from "./helpers.mjs";
import { makeFile } from "../src/tools/core.js";
import { applyAnnotations, cropPages, redactPages, fillForm, listFields, pageFrame } from "../src/tools/editor.js";
import { PDFDocument, PDFName, degrees } from "../vendor/pdf-lib.esm.js";
import { inflateSync } from "node:zlib";

/** Decoded content streams of a page, concatenated. */
function contentOf(doc, index) {
  const page = doc.getPage(index);
  const node = page.node;
  const contents = node.Contents();
  const refs = contents?.asArray ? contents.asArray() : contents ? [node.get(PDFName.of("Contents"))] : [];
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

function xobjectsOf(doc, index) {
  const res = doc.getPage(index).node.Resources();
  const xo = res?.lookup?.(PDFName.of("XObject"));
  if (!xo) return [];
  return xo.keys().map((k) => {
    const d = xo.lookup(k);
    return String(d.dict?.get(PDFName.of("Subtype")) || "");
  });
}

test("pageFrame maps display coordinates for every rotation", async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 400]);
  let f = pageFrame(page);
  assert.deepEqual([f.W, f.H], [200, 400]);
  assert.deepEqual(f.toPdf(10, 20), { x: 10, y: 380 });
  page.setRotation(degrees(90));
  f = pageFrame(page);
  assert.deepEqual([f.W, f.H], [400, 200]);
  assert.deepEqual(f.toPdf(0, 0), { x: 0, y: 0 }); // display top-left = unrotated bottom-left
  assert.deepEqual(f.toPdf(400, 0), { x: 0, y: 400 }); // display top-right = unrotated top-left
  page.setRotation(degrees(180));
  f = pageFrame(page);
  assert.deepEqual(f.toPdf(0, 0), { x: 200, y: 0 });
  page.setRotation(degrees(270));
  f = pageFrame(page);
  assert.deepEqual([f.W, f.H], [400, 200]);
  assert.deepEqual(f.toPdf(0, 0), { x: 200, y: 400 }); // display top-left = unrotated top-right
  assert.deepEqual(f.toPdf(400, 200), { x: 0, y: 0 });
  // crop box offset
  page.setRotation(degrees(0));
  page.setCropBox(50, 100, 100, 200);
  f = pageFrame(page);
  assert.deepEqual([f.W, f.H], [100, 200]);
  assert.deepEqual(f.toPdf(0, 0), { x: 50, y: 300 });
});

test("applyAnnotations burns text, shapes, paths and images; page count unchanged", async () => {
  const f = await makePdf(2, { name: "doc.pdf", text: false });
  const items = [
    { page: 0, type: "text", x: 40, y: 40, w: 200, h: 30, text: "Hello burned text", size: 16, color: "#1f5eff" },
    { page: 0, type: "rect", x: 20, y: 100, w: 100, h: 50, color: "#c62828", fill: "#ffeeee", stroke: 2, opacity: 0.8 },
    { page: 0, type: "highlight", x: 20, y: 160, w: 120, h: 14 },
    { page: 0, type: "ellipse", x: 150, y: 100, w: 60, h: 40, color: "#000000", fill: "none" },
    { page: 0, type: "line", x: 10, y: 300, w: 100, h: 0, color: "#000000", stroke: 1 },
    { page: 0, type: "path", points: [[10, 320], [30, 330], [50, 320], [70, 340]], color: "#1a7f4b", stroke: 3 },
    { page: 1, type: "image", x: 30, y: 30, w: 80, h: 60, imageBytes: makePng(8, 6) },
    { page: 1, type: "whiteout", x: 0, y: 0, w: 50, h: 50 },
    { page: 1, type: "note", x: 100, y: 100, w: 120, h: 60, text: "Sticky", size: 12, background: "#fff59d" },
  ];
  const r = await applyAnnotations([f], { items });
  assert.equal(r.name, "doc-edited.pdf");
  assert.equal(r.pageCount, 2);
  assert.equal(r.stats.items, 9);
  const doc = await loadBytes(r.bytes);
  assert.equal(doc.getPageCount(), 2);
  const c0 = contentOf(doc, 0);
  assert.ok(/\bm\b/.test(c0) && /\bl\b/.test(c0), "path operators present (pdf-lib draws rects and lines as paths)");
  assert.ok(/Tj|TJ/.test(c0), "text shown on page 1");
  assert.ok(xobjectsOf(doc, 1).some((s) => /Image/.test(s)), "image XObject on page 2");
  assert.ok(r.bytes.length > f.size);
  await assert.rejects(() => applyAnnotations([f], { items: [] }), /Nothing to apply/);
});

test("applyAnnotations places a rect at the expected box on a rotated page", async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 400]);
  page.setRotation(degrees(90));
  const f = makeFile("rot.pdf", await doc.save());
  // display frame is 400 wide x 200 high; a box at display (10, 20, 100, 50)
  const r = await applyAnnotations([f], { items: [{ page: 0, type: "rect", x: 10, y: 20, w: 100, h: 50, color: "none", fill: "#000000" }] });
  const out = await loadBytes(r.bytes);
  const c = contentOf(out, 0);
  // expected pdf rect: x = yd range [20,70] -> x 20, y = xd range [10,110] -> y 10, width 50, height 100.
  // pdf-lib translates to (x, y + height) then draws the path downward: "1 0 0 1 20 110 cm" + "50 100 l".
  assert.ok(/1 0 0 1 20 110 cm/.test(c), "translation to the mapped box");
  assert.ok(/\b50 100 l\b/.test(c), "50 x 100 path");
});

test("cropPages sets the CropBox on the current page only, or everywhere, and MediaBox when cutting", async () => {
  const f = await makePdf(3, { size: [300, 400] });
  const r = await cropPages([f], { box: { x: 50, y: 100, w: 100, h: 150 }, page: 1, pages: "current" });
  const doc = await loadBytes(r.bytes);
  const cb = doc.getPage(1).getCropBox();
  assert.deepEqual([cb.x, cb.y, cb.width, cb.height], [50, 150, 100, 150]);
  assert.deepEqual(doc.getPage(0).getCropBox().width, 300);
  assert.equal(doc.getPage(1).getMediaBox().width, 300, "media box untouched without cut");
  const r2 = await cropPages([f], { box: { x: 50, y: 100, w: 100, h: 150 }, pages: "all", cut: true });
  const d2 = await loadBytes(r2.bytes);
  for (let i = 0; i < 3; i++) {
    assert.equal(d2.getPage(i).getMediaBox().width, 100);
    assert.equal(d2.getPage(i).getCropBox().height, 150);
  }
  assert.equal(r2.stats.pages, 3);
  await assert.rejects(() => cropPages([f], { box: { x: 0, y: 0, w: 2, h: 2 } }), /Drag a crop/);
});

test("redactPages replaces only the affected pages with painted images", async () => {
  const f = await makePdf(3, { name: "secret.pdf" });
  const calls = [];
  const r = await redactPages(
    [f],
    { boxes: [{ page: 1, x: 10, y: 10, w: 50, h: 20 }, { page: 1, x: 100, y: 100, w: 30, h: 30 }] },
    {
      renderPage: async (bytes, i, o) => {
        calls.push(["render", i, o.scale]);
        return TINY_JPEG;
      },
      paintBoxes: async (jpg, boxes) => {
        calls.push(["paint", boxes.length, boxes[0].x]);
        return jpg;
      },
    }
  );
  assert.deepEqual(calls, [["render", 1, 2], ["paint", 2, 20]]);
  assert.equal(r.pageCount, 3);
  assert.equal(r.stats.pages, 1);
  const doc = await loadBytes(r.bytes);
  assert.ok(xobjectsOf(doc, 1).some((s) => /Image/.test(s)), "page 2 is now an image");
  assert.ok(!/Tj|TJ/.test(contentOf(doc, 1)), "no text operators left on the redacted page");
  assert.ok(/Tj|TJ/.test(contentOf(doc, 0)), "untouched page keeps its text");
  assert.equal(doc.getPage(1).getWidth(), 300);
  await assert.rejects(() => redactPages([f], { boxes: [] }, { renderPage: async () => TINY_JPEG }), /at least one/);
  await assert.rejects(() => redactPages([f], { boxes: [{ page: 0, x: 0, y: 0, w: 5, h: 5 }] }), /needs a browser/);
});

async function makeForm() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 300]);
  const form = doc.getForm();
  const name = form.createTextField("name");
  name.addToPage(page, { x: 20, y: 250, width: 200, height: 24 });
  const agree = form.createCheckBox("agree");
  agree.addToPage(page, { x: 20, y: 210, width: 20, height: 20 });
  const color = form.createDropdown("color");
  color.addOptions(["red", "green", "blue"]);
  color.addToPage(page, { x: 20, y: 170, width: 120, height: 24 });
  const size = form.createRadioGroup("size");
  size.addOptionToPage("S", page, { x: 20, y: 130, width: 20, height: 20 });
  size.addOptionToPage("L", page, { x: 60, y: 130, width: 20, height: 20 });
  const tags = form.createOptionList("tags");
  tags.addOptions(["a", "b", "c"]);
  tags.addToPage(page, { x: 20, y: 60, width: 120, height: 60 });
  return makeFile("form.pdf", await doc.save());
}

test("listFields reports every field with its type and current value", async () => {
  const f = await makeForm();
  const fields = await listFields(f.bytes);
  const byName = Object.fromEntries(fields.map((x) => [x.name, x]));
  assert.deepEqual(Object.keys(byName).sort(), ["agree", "color", "name", "size", "tags"]);
  assert.equal(byName.name.type, "text");
  assert.equal(byName.agree.type, "checkbox");
  assert.equal(byName.agree.value, false);
  assert.equal(byName.color.type, "dropdown");
  assert.deepEqual(byName.color.options, ["red", "green", "blue"]);
  assert.equal(byName.size.type, "radio");
  assert.deepEqual(byName.size.options, ["S", "L"]);
  assert.equal(byName.tags.type, "optionlist");
  const plain = await makePdf(1);
  assert.deepEqual(await listFields(plain.bytes), []);
});

test("fillForm sets values of every type and flatten removes the fields", async () => {
  const f = await makeForm();
  const r = await fillForm([f], { values: { name: "Ada Lovelace", agree: true, color: "green", size: "L", tags: ["a", "c"] } });
  assert.equal(r.stats.set, 5);
  const fields = await listFields(r.bytes);
  const byName = Object.fromEntries(fields.map((x) => [x.name, x]));
  assert.equal(byName.name.value, "Ada Lovelace");
  assert.equal(byName.agree.value, true);
  assert.equal(byName.color.value, "green");
  assert.equal(byName.size.value, "L");
  assert.deepEqual(byName.tags.value, ["a", "c"]);

  const flat = await fillForm([f], { values: { name: "Flat" }, flatten: true });
  assert.equal(flat.stats.flattened, true);
  const doc = await loadBytes(flat.bytes);
  assert.equal(doc.getForm().getFields().length, 0);
  assert.ok(/Flat/.test(contentOf(doc, 0)) || /Tj|TJ/.test(contentOf(doc, 0)), "flattened text drawn on the page");

  const plain = await makePdf(1);
  await assert.rejects(() => fillForm([plain], { values: {} }), /no form fields/);
  await assert.rejects(() => fillForm([f], { values: { size: "XL" } }), /Could not set/);
});
