// Every tool the site offers, assembled from src/catalog/*.js.
// Tool shape:
//   id, name, tagline, category, icon, accept, kinds, action, run(files, options, ctx)
//   mode: "files"  -> list of files, reorder/remove (merge, images to pdf)
//         "pages"  -> page grid, select/rotate/delete/reorder
//         "single" -> one file, options only
//         "custom" -> the tool renders its own workspace: ui({ file, files, container, api }) -> { collect?() , destroy?() }
//   kinds: "pdf" | "image" | "any" | a file extension such as "docx"
//   options: schema for src/ui/options.js; minFiles/maxFiles; noRun (no action button); layout: "full" (no side panel)
//   styles: a stylesheet URL the tool page should load; howto, faq, related
import core from "./catalog/core.js";
import convert from "./catalog/convert.js";
import ai from "./catalog/ai.js";
import editor from "./catalog/editor.js";
import misc from "./catalog/misc.js";

// column: which column of the tools menu the category sits in (mirrors a classic PDF-suite layout)
export const CATEGORIES = [
  { id: "compress", name: "Compress", color: "var(--c-compress)", column: 0 },
  { id: "convert", name: "Convert", color: "var(--c-convert)", column: 0 },
  { id: "pdf-to-image", name: "PDF to Image", color: "var(--c-convert)", column: 0 },
  { id: "image-to-pdf", name: "Image to PDF", color: "var(--c-convert)", column: 0 },
  { id: "pdf-to-office", name: "PDF to Office", color: "var(--c-office)", column: 1 },
  { id: "office-to-pdf", name: "Office to PDF", color: "var(--c-office)", column: 1 },
  { id: "openoffice-to-pdf", name: "OpenOffice to PDF", color: "var(--c-office)", column: 1 },
  { id: "convert-to-pdf", name: "Convert to PDF", color: "var(--c-convert)", column: 2 },
  { id: "iwork-to-pdf", name: "iWork to PDF", color: "var(--c-office)", column: 2 },
  { id: "organize", name: "Organize", color: "var(--c-organize)", column: 3 },
  { id: "edit", name: "Edit", color: "var(--c-edit)", column: 4 },
  { id: "fill-sign", name: "Fill & Sign", color: "var(--c-sign)", column: 5 },
  { id: "protect", name: "Protect", color: "var(--c-security)", column: 5 },
  { id: "ai", name: "AI PDF", color: "var(--c-ai)", column: 6 },
  { id: "scan", name: "Scan", color: "var(--c-scan)", column: 6 },
];

export const TOOLS = [...core, ...convert, ...editor, ...misc, ...ai];
export const byId = Object.fromEntries(TOOLS.map((t) => [t.id, t]));
export const inCategory = (id) => TOOLS.filter((t) => t.category === id);
export const categoryOf = (tool) => CATEGORIES.find((c) => c.id === tool.category) || CATEGORIES[0];
