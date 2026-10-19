import { test } from "node:test";
import assert from "node:assert/strict";
import { makePdf, makePng, pageCountOf, loadBytes } from "./helpers.mjs";
import { makeFile } from "../src/tools/core.js";
import { txtToPdf, csvToPdf, rtfToPdf, rtfToBlocks, htmlToPdf, htmlToBlocks, zipToPdf, pdfToPdfa, decodeEntities } from "../src/tools/convertText.js";
import { parseCsv } from "../src/tools/table.js";
import { zipFiles } from "../src/zip.js";

const enc = (s) => new TextEncoder().encode(s);

test("txt to pdf paginates long text and keeps unicode", async () => {
  const text = Array.from({ length: 200 }, (_, i) => `Line ${i + 1}: Привет, Ελλάδα, café — “quotes”`).join("\n");
  const r = await txtToPdf([makeFile("notes.txt", enc(text))], { fontSize: 11 });
  assert.equal(r.name, "notes.pdf");
  assert.ok(r.pageCount >= 3, `pages ${r.pageCount}`);
  assert.equal(await pageCountOf(r.bytes), r.pageCount);
});

test("csv parsing handles quotes, delimiters and CRLF", () => {
  assert.deepEqual(parseCsv('a,b\r\n1,"x, y"\r\n2,"say ""hi"""\r\n'), [["a", "b"], ["1", "x, y"], ["2", 'say "hi"']]);
  assert.deepEqual(parseCsv("a;b\n1;2"), [["a", "b"], ["1", "2"]]);
  assert.deepEqual(parseCsv("a\tb\n1\t2"), [["a", "b"], ["1", "2"]]);
});

test("csv to pdf draws a table with header and reports stats", async () => {
  const rows = ["name,qty,price", ...Array.from({ length: 120 }, (_, i) => `Item ${i},${i},${(i * 1.5).toFixed(2)}`)].join("\n");
  const r = await csvToPdf([makeFile("sales.csv", enc(rows))], { header: true });
  assert.equal(r.stats.rows, 121);
  assert.equal(r.stats.columns, 3);
  assert.ok(r.pageCount >= 2);
  await assert.rejects(() => csvToPdf([makeFile("e.csv", enc(""))]), /empty/);
});

test("rtf parser keeps paragraphs, bold and escapes, skips font tables", () => {
  const rtf = "{\\rtf1\\ansi{\\fonttbl{\\f0 Arial;}}{\\colortbl;\\red0\\green0\\blue0;}\\f0\\fs24 Hello {\\b bold} world\\par Second \\'e9 line \\u8364? euro\\par}";
  const blocks = rtfToBlocks(rtf);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].text, "Hello bold world");
  assert.equal(blocks[1].text, "Second é line € euro");
  assert.equal(blocks[0].size, 12);
});

test("rtf to pdf rejects non-RTF", async () => {
  await assert.rejects(() => rtfToPdf([makeFile("x.rtf", enc("plain"))]), /not an RTF/);
  const r = await rtfToPdf([makeFile("doc.rtf", enc(String.raw`{\rtf1 Hi\par there}`))]);
  assert.equal(await pageCountOf(r.bytes), 1);
});

test("html to blocks: headings, lists, entities, scripts dropped", () => {
  const html = `<html><head><title>T</title><style>p{}</style><script>alert(1)</script></head><body><h1>Title &amp; more</h1><p>Para <b>one</b>.</p><ul><li>a</li><li>b &lt; c</li></ul><table><tr><td>x</td><td>y</td></tr></table></body></html>`;
  const b = htmlToBlocks(html);
  const texts = b.map((x) => x.text);
  assert.ok(texts.includes("Title & more"));
  assert.ok(texts.includes("Para one."));
  assert.ok(texts.includes("• a"));
  assert.ok(texts.includes("• b < c"));
  assert.ok(!texts.some((t) => /alert|p\{\}/.test(t)));
  assert.equal(b.find((x) => x.text === "Title & more").size, 22);
  assert.equal(decodeEntities("&#8364;&#x41;&nbsp;&bogus;"), "€A &bogus;");
});

test("html to pdf produces pages", async () => {
  const r = await htmlToPdf([makeFile("page.html", enc("<h1>Hi</h1>" + "<p>text</p>".repeat(300)))]);
  assert.ok(r.pageCount >= 2);
});

test("zip to pdf merges pdfs, images, text and csv in name order and lists skipped entries", async () => {
  const pdf = await makePdf(2);
  const zip = zipFiles([
    { name: "02-photo.png", data: makePng(10, 10) },
    { name: "01-doc.pdf", data: pdf.bytes },
    { name: "03-notes.txt", data: enc("hello\nworld") },
    { name: "04-data.csv", data: enc("a,b\n1,2") },
    { name: "05-binary.exe", data: new Uint8Array([1, 2, 3]) },
    { name: "__MACOSX/._x", data: new Uint8Array([1]) },
  ]);
  const r = await zipToPdf([makeFile("bundle.zip", zip)]);
  assert.equal(r.pageCount, 5);
  assert.deepEqual(r.stats.skipped, ["05-binary.exe"]);
  assert.equal(r.stats.used, 4);
  await assert.rejects(() => zipToPdf([makeFile("x.zip", new Uint8Array([1, 2, 3]))]), /not a ZIP/);
});

test("pdf to pdf/a sets conformance metadata", async () => {
  const f = await makePdf(2);
  const r = await pdfToPdfa([f], { conformance: "3B" });
  assert.equal(r.name, "doc-pdfa.pdf");
  const doc = await loadBytes(r.bytes);
  assert.equal(doc.getPageCount(), 2);
  const txt = new TextDecoder("latin1").decode(r.bytes);
  assert.ok(/pdfaid:part/.test(txt) || /pdfaid/.test(txt), "no pdfaid metadata");
});
