import { deflateSync } from "node:zlib";
import { PDFDocument, StandardFonts, rgb } from "../vendor/pdf-lib.esm.js";
import { makeFile } from "../src/tools/core.js";

/** A PDF with `count` pages, each printing its page number. */
export async function makePdf(count = 3, { name = "doc.pdf", size = [300, 400], text = true } = {}) {
  const doc = await PDFDocument.create();
  const font = text ? await doc.embedFont(StandardFonts.Helvetica) : null;
  for (let i = 1; i <= count; i++) {
    const page = doc.addPage(size);
    if (font) page.drawText(`Page ${i}`, { x: 40, y: 300, size: 24, font, color: rgb(0, 0, 0) });
  }
  return makeFile(name, await doc.save());
}

export async function pageCountOf(bytes, password) {
  const doc = await PDFDocument.load(bytes, { password, updateMetadata: false });
  return doc.getPageCount();
}

export async function loadBytes(bytes, password) {
  return PDFDocument.load(bytes, { password, updateMetadata: false });
}

function crc32(buf) {
  let c,
    crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** A tiny solid-colour RGB PNG, built by hand so tests need no image library. */
export function makePng(width = 4, height = 3, [r, g, b] = [200, 30, 30]) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    for (let x = 0; x < width; x++) {
      const o = y * (width * 3 + 1) + 1 + x * 3;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  return new Uint8Array(png);
}

/** The smallest valid JPEG most decoders accept: 1x1, greyscale, progressive. */
export const TINY_JPEG = new Uint8Array(
  Buffer.from(
    "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=",
    "base64"
  )
);
