// Copies the browser builds of our three dependencies into vendor/ so the site
// needs no bundler, no CDN and makes no third-party requests at runtime.
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
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
];

mkdirSync(out, { recursive: true });
for (const [from, to] of files) {
  const src = join(nm, from);
  if (!existsSync(src)) {
    console.error(`vendor: missing ${from} — run npm install first`);
    process.exit(1);
  }
  copyFileSync(src, join(out, to));
}
console.log(`vendor: copied ${files.length} files to vendor/`);
