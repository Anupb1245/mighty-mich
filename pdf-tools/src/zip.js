import { zipSync } from "../vendor/fflate.js";

/** zipFiles([{ name, data: Uint8Array }]) -> Uint8Array. PDFs and JPEGs are already compressed, so store them. */
export function zipFiles(entries, { level = 0 } = {}) {
  const map = {};
  const seen = new Set();
  for (const { name, data } of entries) {
    let n = name;
    let i = 2;
    while (seen.has(n)) n = name.replace(/(\.[^.]+)?$/, ` (${i++})$1`);
    seen.add(n);
    map[n] = [data, { level }];
  }
  return zipSync(map);
}
