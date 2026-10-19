// Simple table layout: rows of cells onto PDF pages, auto column widths, header repeat.
import { PDFDocument, rgb } from "./core.js";
import { PAGE, fontsFor, wrap, widthOf } from "./text.js";

/**
 * rows: string[][]; first row is the header when `header` is true.
 * Columns are sized by content, capped so the table fits the page width.
 */
export async function layoutTable(doc, rows, { pageSize = "a4", landscape = false, margin = 40, size = 9, header = true, title } = {}) {
  const { regular, bold } = await fontsFor(doc);
  let [pw, ph] = PAGE[pageSize] || PAGE.a4;
  if (landscape) [pw, ph] = [ph, pw];
  const maxW = pw - margin * 2;
  const cols = Math.max(0, ...rows.map((r) => r.length));
  if (!cols) {
    doc.addPage([pw, ph]);
    return doc;
  }
  const pad = 4;
  // natural widths
  const nat = Array(cols).fill(0);
  for (const r of rows) r.forEach((c, i) => (nat[i] = Math.max(nat[i], widthOf(String(c ?? ""), regular, size) + pad * 2, size * 2)));
  const total = nat.reduce((a, b) => a + b, 0);
  const widths = total <= maxW ? nat : nat.map((w) => Math.max(size * 3, (w / total) * maxW));
  const lh = size * 1.3;

  let page, y;
  const newPage = () => {
    page = doc.addPage([pw, ph]);
    y = ph - margin;
    if (title) {
      page.drawText(String(title), { x: margin, y: y - size * 1.4, size: size * 1.4, font: bold });
      y -= size * 2.4;
    }
    if (header && rows.length) drawRow(rows[0], true);
  };
  const drawRow = (cells, isHeader) => {
    const font = isHeader ? bold : regular;
    const lines = cells.map((c, i) => wrap(String(c ?? ""), font, size, widths[i] - pad * 2));
    const h = Math.max(1, ...lines.map((l) => l.length)) * lh + pad * 2;
    if (y - h < margin && !isHeader) {
      newPage();
    }
    let x = margin;
    if (isHeader) page.drawRectangle({ x, y: y - h, width: widths.reduce((a, b) => a + b, 0), height: h, color: rgb(0.93, 0.93, 0.95) });
    for (let i = 0; i < cols; i++) {
      page.drawRectangle({ x, y: y - h, width: widths[i], height: h, borderColor: rgb(0.8, 0.8, 0.82), borderWidth: 0.5 });
      (lines[i] || []).forEach((line, li) => {
        try {
          page.drawText(line, { x: x + pad, y: y - pad - size - li * lh, size, font });
        } catch {
          /* unencodable glyph */
        }
      });
      x += widths[i];
    }
    y -= h;
  };
  newPage();
  for (let i = header ? 1 : 0; i < rows.length; i++) drawRow(rows[i], false);
  return doc;
}

export async function tableToDoc(rows, opts) {
  const doc = await PDFDocument.create({ updateMetadata: false });
  return layoutTable(doc, rows, opts);
}

/** RFC-4180-ish CSV parser: quotes, escaped quotes, CRLF, auto delimiter (, ; tab). */
export function parseCsv(text) {
  const s = String(text).replace(/^﻿/, "");
  const first = s.split(/\r?\n/)[0] || "";
  const delim = [",", ";", "\t"].map((d) => [d, (first.match(new RegExp(d === "\t" ? "\t" : `\\${d}`, "g")) || []).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') {
        if (s[i + 1] === '"') (cell += '"'), i++;
        else q = false;
      } else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) (row.push(cell), (cell = ""));
    else if (c === "\n") (row.push(cell), rows.push(row), (row = []), (cell = ""));
    else if (c !== "\r") cell += c;
  }
  if (cell !== "" || row.length) (row.push(cell), rows.push(row));
  return rows.filter((r) => r.some((c) => c !== ""));
}
