// Browser-only wrapper around tesseract.js. Everything (worker, wasm core, English data) is
// served from vendor/tesseract/, so English OCR never touches the network. Other languages are
// fetched from the tesseract.js data CDN on first use and cached in the browser.
import Tesseract from "../../vendor/tesseract/tesseract.esm.min.js";

const base = new URL("../../vendor/tesseract/", import.meta.url).href;
export const OFFLINE_LANGS = ["eng"];

let workerPromise = null;
let workerLang = null;

export async function getWorker(lang = "eng", { onStatus } = {}) {
  if (workerPromise && workerLang === lang) return workerPromise;
  if (workerPromise) {
    const old = workerPromise;
    workerPromise = null;
    old.then((w) => w.terminate()).catch(() => {});
  }
  workerLang = lang;
  workerPromise = Tesseract.createWorker(lang, Tesseract.OEM.LSTM_ONLY, {
    workerPath: `${base}worker.min.js`,
    corePath: base, // a directory: the worker picks the simd / relaxed-simd / plain core itself
    langPath: OFFLINE_LANGS.includes(lang) ? base.replace(/\/$/, "") : undefined, // undefined -> CDN
    gzip: true,
    logger: (m) => onStatus?.(m),
  });
  return workerPromise;
}

/**
 * OCR one image. Returns { text, pdf } where pdf is a one-page, text-only PDF (invisible text
 * positioned where tesseract read it) sized from `dpi`. Matches the ctx.ocrPage contract in ocr.js.
 */
export async function ocrImage(bytes, { lang = "eng", dpi = 144, onStatus, mime = "image/png" } = {}) {
  const worker = await getWorker(lang, { onStatus });
  await worker.setParameters({ user_defined_dpi: String(Math.round(dpi)) });
  const { data } = await worker.recognize(new Blob([bytes], { type: mime }), { pdfTextOnly: true, pdfTitle: "OCR" }, { text: true, pdf: true });
  return { text: data.text || "", pdf: new Uint8Array(data.pdf || []), confidence: data.confidence };
}

export async function terminate() {
  if (!workerPromise) return;
  const w = workerPromise;
  workerPromise = null;
  workerLang = null;
  await w.then((x) => x.terminate()).catch(() => {});
}
