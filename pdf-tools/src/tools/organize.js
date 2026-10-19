import { assemble, saveDoc, result, baseName, loadDoc, pagesOf, parseRanges, ToolError } from "./core.js";
import { zipFiles } from "../zip.js";

/** Merge every file, in order, honoring reorder/rotate/delete done in the UI. */
export async function merge(files) {
  if (files.length < 2) throw new ToolError("Add at least two PDFs to merge.", "need_two");
  const doc = await assemble(files);
  const sizeBefore = files.reduce((n, f) => n + f.size, 0);
  const name = files.length === 2 ? `${baseName(files[0].name)} + ${baseName(files[1].name)}.pdf` : "merged.pdf";
  return result(name, await saveDoc(doc), { sizeBefore, pageCount: doc.getPageCount() });
}

/** Rotate: per-page rotation from the UI plus an optional angle for every page. */
export async function rotate(files, { angle = 0 } = {}) {
  const doc = await assemble(files, { extraRotation: Number(angle) || 0 });
  return result(`${baseName(files[0].name)}-rotated.pdf`, await saveDoc(doc), {
    sizeBefore: files[0].size,
    pageCount: doc.getPageCount(),
  });
}

/** Delete the selected pages. */
export async function deletePages(files) {
  const file = files[0];
  const pages = await pagesOf(file);
  if (!pages.some((p) => p.selected)) throw new ToolError("Select the pages to delete.", "no_selection");
  const doc = await assemble([file], { filter: (p) => !p.selected });
  return result(`${baseName(file.name)}-pages-removed.pdf`, await saveDoc(doc), {
    sizeBefore: file.size,
    pageCount: doc.getPageCount(),
  });
}

/** Keep only the selected pages (or a typed range). */
export async function extractPages(files, { ranges = "" } = {}) {
  const file = files[0];
  const src = await loadDoc(file);
  let pages = await pagesOf(file, src);
  let keep;
  if (ranges.trim()) {
    const idx = new Set(parseRanges(ranges, src.getPageCount()).flat());
    keep = (p) => idx.has(p.index);
  } else {
    if (!pages.some((p) => p.selected)) throw new ToolError("Select the pages to extract, or type a range.", "no_selection");
    keep = (p) => p.selected;
  }
  const doc = await assemble([file], { filter: keep });
  return result(`${baseName(file.name)}-extracted.pdf`, await saveDoc(doc), {
    sizeBefore: file.size,
    pageCount: doc.getPageCount(),
  });
}

/** Reorder / rotate / delete freely: the UI edits the page list, we just assemble it. */
export async function organize(files) {
  const doc = await assemble(files);
  return result(`${baseName(files[0].name)}-organized.pdf`, await saveDoc(doc), {
    sizeBefore: files[0].size,
    pageCount: doc.getPageCount(),
  });
}

/**
 * Split. mode: "extract" (selected pages -> one PDF), "ranges" (one PDF per
 * range, zipped), "every" (one PDF per page, zipped), "chunks" (every N pages).
 */
export async function split(files, { mode = "every", ranges = "", every = 1 } = {}) {
  const file = files[0];
  const src = await loadDoc(file);
  const pages = await pagesOf(file, src);
  const base = baseName(file.name);

  if (mode === "extract") return extractPages([file]);

  let groups;
  if (mode === "ranges") groups = parseRanges(ranges, src.getPageCount()).map((g) => g.map((i) => pages.find((p) => p.index === i) || { index: i, rotation: 0 }));
  else {
    const n = mode === "chunks" ? Math.max(1, Number(every) || 1) : 1;
    groups = [];
    for (let i = 0; i < pages.length; i += n) groups.push(pages.slice(i, i + n));
  }
  if (groups.length === 1) {
    const doc = await assemble([{ ...file, pages: groups[0] }]);
    return result(`${base}-part-1.pdf`, await saveDoc(doc), { sizeBefore: file.size, pageCount: doc.getPageCount() });
  }
  const entries = [];
  const pad = String(groups.length).length;
  for (let i = 0; i < groups.length; i++) {
    const doc = await assemble([{ ...file, pages: groups[i] }]);
    const label =
      mode === "every"
        ? `page-${String(groups[i][0].index + 1).padStart(pad, "0")}`
        : `part-${String(i + 1).padStart(pad, "0")}`;
    entries.push({ name: `${base}-${label}.pdf`, data: await saveDoc(doc) });
  }
  return result(`${base}-split.zip`, zipFiles(entries), {
    kind: "zip",
    mime: "application/zip",
    sizeBefore: file.size,
    files: entries.map((e) => ({ name: e.name, size: e.data.length })),
  });
}
