// Copies the browser builds of our three dependencies into vendor/ so the site
// needs no bundler, no CDN and makes no third-party requests at runtime.
import { copyFileSync, mkdirSync, existsSync, cpSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const nm = join(root, "node_modules");
const out = join(root, "vendor");

const files = [
  ["@cantoo/pdf-lib/dist/pdf-lib.esm.js", "pdf-lib.esm.js"],
  ["pdfjs-dist/build/pdf.mjs", "pdf.mjs"],
  ["pdfjs-dist/build/pdf.worker.mjs", "pdf.worker.mjs"],
  ["fflate/esm/browser.js", "fflate.js"],
  ["@pdf-lib/fontkit/dist/fontkit.es.js", "fontkit.es.js"],
  ["dejavu-fonts-ttf/ttf/DejaVuSans.ttf", "DejaVuSans.ttf"],
  ["dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf", "DejaVuSans-Bold.ttf"],
  // OCR: tesseract.js + its wasm cores (LSTM only) + English language data, so OCR works offline.
  ["tesseract.js/dist/tesseract.esm.min.js", "tesseract/tesseract.esm.min.js"],
  ["tesseract.js/dist/worker.min.js", "tesseract/worker.min.js"],
  ["tesseract.js-core/tesseract-core-lstm.wasm.js", "tesseract/tesseract-core-lstm.wasm.js"],
  ["tesseract.js-core/tesseract-core-simd-lstm.wasm.js", "tesseract/tesseract-core-simd-lstm.wasm.js"],
  ["tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js", "tesseract/tesseract-core-relaxedsimd-lstm.wasm.js"],
  ["@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz", "tesseract/eng.traineddata.gz"],
  // Exact-layout Office conversions: real layout engines rendered in the page, then rasterized.
  ["docx-preview/dist/docx-preview.mjs", "docx-preview.mjs"],
  ["jszip/dist/jszip.min.js", "jszip.min.js"],
  ["exceljs/dist/exceljs.min.js", "exceljs.min.js"],
  ["pptx-preview/dist/pptx-preview.umd.js", "pptx-preview.umd.js"],
  ["html-to-image/dist/html-to-image.js", "html-to-image.umd.js"],
];
const dirs = [];

mkdirSync(out, { recursive: true });
mkdirSync(join(out, "tesseract"), { recursive: true });
for (const [from, to] of files) {
  const src = join(nm, from);
  if (!existsSync(src)) {
    console.error(`vendor: missing ${from} — run npm install first`);
    process.exit(1);
  }
  mkdirSync(dirname(join(out, to)), { recursive: true });
  copyFileSync(src, join(out, to));
}
for (const [from, to] of dirs) {
  const src = join(nm, from);
  if (!existsSync(src)) {
    console.error(`vendor: missing ${from} — run npm install first`);
    process.exit(1);
  }
  cpSync(src, join(out, to), { recursive: true });
}
// ES-module shims over the UMD builds (they attach to globalThis when loaded as modules).
writeFileSync(join(out, "jszip.esm.js"), 'import "./jszip.min.js";\nexport default globalThis.JSZip;\n');
writeFileSync(join(out, "exceljs.esm.js"), 'import "./exceljs.min.js";\nexport default globalThis.ExcelJS;\n');
writeFileSync(join(out, "html-to-image.esm.js"), 'import "./html-to-image.umd.js";\nexport const toCanvas = (...a) => globalThis.htmlToImage.toCanvas(...a);\nexport const toPng = (...a) => globalThis.htmlToImage.toPng(...a);\n');
writeFileSync(join(out, "pptx-preview.esm.js"), 'import "./pptx-preview.umd.js";\nexport const pptxPreview = globalThis.pptxPreview;\nexport default globalThis.pptxPreview;\n');
console.log(`vendor: copied ${files.length} files and ${dirs.length} directories to vendor/`);
