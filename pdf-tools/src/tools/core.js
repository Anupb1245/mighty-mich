// Shared helpers for every tool. Pure: bytes in, bytes out. No DOM.
import {
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFDict,
  StandardFonts,
  degrees,
  rgb,
} from "../../vendor/pdf-lib.esm.js";

export { PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFDict, StandardFonts, degrees, rgb };

export class ToolError extends Error {
  constructor(message, code = "tool_error") {
    super(message);
    this.code = code;
  }
}

/** A file as the UI hands it to a tool. */
export function makeFile(name, bytes, extra = {}) {
  return { name, bytes, size: bytes.length, pages: null, password: undefined, ...extra };
}

export function baseName(name) {
  return String(name || "file").replace(/\.[^.]+$/, "");
}

export function isPdf(file) {
  const b = file.bytes;
  return b && b.length > 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46;
}

/** Load a PDF, with a clear error when it needs a password we do not have. */
export async function loadDoc(file, opts = {}) {
  if (!isPdf(file)) throw new ToolError(`${file.name} is not a PDF file.`, "not_pdf");
  try {
    return await PDFDocument.load(file.bytes, {
      password: file.password,
      ignoreEncryption: false,
      updateMetadata: false,
      ...opts,
    });
  } catch (err) {
    const msg = String(err?.message || err);
    if (/encrypted|password/i.test(msg)) {
      throw new ToolError(
        file.password
          ? `Wrong password for ${file.name}.`
          : `${file.name} is password protected. Unlock it first.`,
        "encrypted"
      );
    }
    throw new ToolError(`Could not read ${file.name}. It may be damaged.`, "unreadable");
  }
}

/** Default page state for a file: every page, in order, no rotation, unselected. */
export function defaultPages(count) {
  return Array.from({ length: count }, (_, index) => ({ index, rotation: 0, selected: false }));
}

/** The page list the tool should operate on (UI may have reordered/rotated/removed). */
export async function pagesOf(file, doc) {
  if (file.pages && file.pages.length) return file.pages;
  const d = doc || (await loadDoc(file));
  return defaultPages(d.getPageCount());
}

/**
 * Parse "1-3, 5, 8-10" into groups of 0-based page indices.
 * Throws on nonsense; clamps nothing, so out-of-range is an error the user sees.
 */
export function parseRanges(text, pageCount) {
  const groups = [];
  const parts = String(text || "")
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!parts.length) throw new ToolError("Enter at least one page or range, like 1-3, 5.", "bad_range");
  for (const part of parts) {
    const m = part.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!m) throw new ToolError(`"${part}" is not a page or range.`, "bad_range");
    let a = Number(m[1]);
    let b = m[2] ? Number(m[2]) : a;
    if (a < 1 || b < 1 || a > pageCount || b > pageCount) {
      throw new ToolError(`"${part}" is outside 1-${pageCount}.`, "bad_range");
    }
    if (a > b) [a, b] = [b, a];
    const group = [];
    for (let i = a; i <= b; i++) group.push(i - 1);
    groups.push(group);
  }
  return groups;
}

/**
 * Build a new document from the given files' page lists, in order, with each
 * page's rotation applied. `filter` can drop pages.
 */
export async function assemble(files, { filter = () => true, extraRotation = 0 } = {}) {
  const out = await PDFDocument.create({ updateMetadata: false });
  let total = 0;
  for (const file of files) {
    const src = await loadDoc(file);
    const pages = (await pagesOf(file, src)).filter(filter);
    if (!pages.length) continue;
    const copied = await out.copyPages(
      src,
      pages.map((p) => p.index)
    );
    copied.forEach((page, i) => {
      const rot = (((page.getRotation().angle + pages[i].rotation + extraRotation) % 360) + 360) % 360;
      page.setRotation(degrees(rot));
      out.addPage(page);
      total++;
    });
  }
  if (!total) throw new ToolError("No pages left. Keep at least one page.", "no_pages");
  return out;
}

export async function saveDoc(doc) {
  return doc.save({ useObjectStreams: true, addDefaultPage: false, updateFieldAppearances: false });
}

export function result(name, bytes, { kind = "pdf", mime = "application/pdf", sizeBefore = 0, pageCount, files } = {}) {
  return { name, bytes, mime, kind, sizeBefore, sizeAfter: bytes.length, pageCount, files };
}

export const SIZE_NOTE = "Everything runs in your browser. Nothing is uploaded.";
