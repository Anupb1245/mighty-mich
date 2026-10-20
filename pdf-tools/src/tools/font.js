// A Unicode-capable font so conversions do not choke on accents, Cyrillic, Greek, etc.
// DejaVu Sans is vendored (vendor/DejaVuSans.ttf, vendor/DejaVuSans-Bold.ttf). In Node
// the file is read from disk; in the browser it is fetched relative to this module.
let fontkitPromise = null;
let bytesCache = {};

async function loadFontkit() {
  if (!fontkitPromise) fontkitPromise = import("../../vendor/fontkit.es.js").then((m) => m.default || m);
  return fontkitPromise;
}

async function readVendor(name) {
  if (bytesCache[name]) return bytesCache[name];
  let bytes;
  if (typeof window === "undefined" && typeof process !== "undefined") {
    const { readFile } = await import("node:fs/promises");
    const { fileURLToPath } = await import("node:url");
    bytes = new Uint8Array(await readFile(fileURLToPath(new URL(`../../vendor/${name}`, import.meta.url))));
  } else {
    const res = await fetch(new URL(`../../vendor/${name}`, import.meta.url));
    if (!res.ok) throw new Error(`font ${name} missing`);
    bytes = new Uint8Array(await res.arrayBuffer());
  }
  bytesCache[name] = bytes;
  return bytes;
}

/** Returns { regular, bold } PDFFonts, or throws if the vendored font is unavailable. */
export async function embedUnicodeFont(doc) {
  const fontkit = await loadFontkit();
  doc.registerFontkit(fontkit);
  const [r, b] = await Promise.all([readVendor("DejaVuSans.ttf"), readVendor("DejaVuSans-Bold.ttf")]);
  // Subsetting keeps output small in browsers; this fontkit build cannot subset under Node
  // (it fails lazily at save time), so embed the whole font there.
  const subset = typeof window !== "undefined";
  const regular = await doc.embedFont(r, { subset });
  const bold = await doc.embedFont(b, { subset });
  return { regular, bold };
}
