// Assemble dist/ with just what a static host needs. `npm run build`.
import { cpSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const out = join(root, "dist");

if (!existsSync(join(root, "vendor", "pdf-lib.esm.js"))) {
  console.error("build: vendor/ is missing — run npm install first");
  process.exit(1);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const items = ["index.html", "tools.html", "tool.html", "styles.css", "favicon.svg", "_redirects", "vercel.json", "src", "vendor"];
for (const item of items) cpSync(join(root, item), join(out, item), { recursive: true });

// GitHub Pages: skip Jekyll so files like _redirects and the vendor .mjs are served as-is.
writeFileSync(join(out, ".nojekyll"), "");
console.log(`build: ${items.length} entries copied to dist/`);
