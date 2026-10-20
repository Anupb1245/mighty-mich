// OCR (real tesseract engine, offline English) and the AI tools against a mocked endpoint.
import { join } from "node:path";
import { PDFDocument } from "../../../vendor/pdf-lib.esm.js";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/** Text of a PDF via pdf.js in Node, to check the OCR text layer. */
async function pdfText(bytes) {
  const pdfjs = await import(require.resolve("pdfjs-dist/legacy/build/pdf.mjs"));
  const fontsDir = require.resolve("pdfjs-dist/package.json").replace(/package\.json$/, "standard_fonts/");
  const doc = await pdfjs.getDocument({ data: bytes, useWorkerFetch: false, isEvalSupported: false, disableFontFace: true, standardFontDataUrl: fontsDir }).promise;
  let out = "";
  for (let i = 1; i <= doc.numPages; i++) {
    const tc = await (await doc.getPage(i)).getTextContent();
    out += tc.items.map((it) => it.str).join(" ") + "\n";
  }
  return out;
}

const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type", "access-control-allow-methods": "GET, POST, OPTIONS" };

export default async function ({ page, step, BASE, tmp, downloadBytes, consoleErrors }) {
  const requests = [];
  let streamMode = false;
  await page.route("**/v1/models", (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    return route.fulfill({ status: 200, headers: { ...CORS, "content-type": "application/json" }, body: JSON.stringify({ data: [{ id: "test-model" }, { id: "other-model" }] }) });
  });
  await page.route("**/v1/chat/completions", (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const body = JSON.parse(req.postData() || "{}");
    requests.push({ auth: req.headers()["authorization"], body });
    const user = body.messages.filter((m) => m.role === "user").map((m) => m.content).join("\n");
    const sys = body.messages.find((m) => m.role === "system")?.content || "";
    let reply;
    if (/Translate the following/.test(sys)) reply = `Traducción de: ${user.replace(/\s+/g, " ").slice(0, 40)}`;
    else if (/multiple-choice/.test(user)) reply = "1. What is this?\nA. x\nB. y\nC. z\nD. w\nAnswer: A";
    else if (/Summar/.test(user)) reply = "SUMMARY OK: the document has pages.";
    else reply = "CHAT OK: " + (user.split("\n").pop() || "");
    if (body.stream && streamMode) {
      const pieces = reply.match(/.{1,6}/g) || [reply];
      const sse = pieces.map((p) => `data: ${JSON.stringify({ choices: [{ delta: { content: p } }] })}\n\n`).join("") + "data: [DONE]\n\n";
      return route.fulfill({ status: 200, headers: { ...CORS, "content-type": "text/event-stream" }, body: sse });
    }
    return route.fulfill({ status: 200, headers: { ...CORS, "content-type": "application/json" }, body: JSON.stringify({ choices: [{ message: { role: "assistant", content: reply } }] }) });
  });

  await step("ai summarizer: settings panel, test connection loads models, summary from the mocked endpoint, PDF download", async () => {
    await page.goto(`${BASE}/tool.html?tool=ai-summarizer`);
    await page.setInputFiles("input[type=file]", join(tmp, "a.pdf"));
    await page.waitForSelector(".ai-settings:not([hidden])");
    await page.waitForFunction(() => /characters/.test(document.querySelector("#ai-docinfo")?.textContent || ""));
    const info = await page.textContent("#ai-docinfo");
    if (!/2 pages/.test(info)) throw new Error(`doc info: ${info}`);
    await page.fill("#ai-base", "http://localhost:20128/v1");
    await page.fill("#ai-key", "sk-test");
    await page.click("#ai-test");
    await page.waitForSelector(".ai-settings .status.ok");
    const model = await page.inputValue("#ai-model");
    if (model !== "test-model") throw new Error(`model not filled from /models: ${model}`);
    await page.click("#ai-save");
    await page.click("text=Bullet points");
    await page.click("#ai-go");
    await page.waitForFunction(() => /SUMMARY OK/.test(document.querySelector("#ai-out")?.textContent || ""));
    const last = requests[requests.length - 1];
    if (last.auth !== "Bearer sk-test") throw new Error(`auth header: ${last.auth}`);
    const userMsg = last.body.messages.find((m) => m.role === "user").content;
    if (!/Page 1/.test(userMsg) || !/bullet/.test(userMsg)) throw new Error("document text or style prompt missing from the request");
    if (last.body.model !== "test-model") throw new Error("model not sent");
    const { name, bytes } = await downloadBytes(page, () => page.click("#ai-dl-pdf"));
    if (!/summary\.pdf$/.test(name)) throw new Error(name);
    const doc = await PDFDocument.load(bytes);
    if (doc.getPageCount() !== 1) throw new Error("summary pdf pages");
  });

  await step("chat with pdf: streamed reply renders token by token and the key is remembered", async () => {
    streamMode = true;
    await page.goto(`${BASE}/tool.html?tool=chat-with-pdf`);
    await page.setInputFiles("input[type=file]", join(tmp, "a.pdf"));
    await page.waitForSelector("#ai-input");
    const hidden = await page.$eval(".ai-settings", (el) => el.hidden);
    if (!hidden) throw new Error("settings should be remembered from the previous tool");
    await page.fill("#ai-input", "What is on page 2?");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => /CHAT OK: What is on page 2\?/.test(document.querySelector("#ai-msgs")?.textContent || ""));
    const bubbles = await page.$$eval("#ai-msgs .ai-msg", (els) => els.map((e) => e.className));
    if (bubbles.length !== 2 || !/user/.test(bubbles[0]) || !/assistant/.test(bubbles[1])) throw new Error(bubbles.join(","));
    // quick action chips send too
    await page.click(".ai-chips .chip >> nth=0");
    await page.waitForFunction(() => (document.querySelectorAll("#ai-msgs .ai-msg").length === 4));
    streamMode = false;
  });

  await step("translate pdf: page by page, then a translated PDF with one page per source page", async () => {
    await page.goto(`${BASE}/tool.html?tool=translate-pdf`);
    await page.setInputFiles("input[type=file]", join(tmp, "a.pdf"));
    await page.waitForSelector("#ai-go");
    await page.selectOption("#ai-lang", "German");
    const before = requests.length;
    await page.click("#ai-go");
    await page.waitForSelector("#ai-dl-pdf:not([disabled])", { timeout: 30_000 });
    const out = await page.textContent("#ai-out");
    if (!/Page 1 —\nTraducción de: Page 1/.test(out) || !/Page 2 —/.test(out)) throw new Error(out);
    if (requests.length - before !== 2) throw new Error(`expected 2 translation requests, got ${requests.length - before}`);
    if (!/into German/.test(requests[requests.length - 1].body.messages[0].content)) throw new Error("language not in prompt");
    const { name, bytes } = await downloadBytes(page, () => page.click("#ai-dl-pdf"));
    if (!/-German\.pdf$/.test(name)) throw new Error(name);
    const doc = await PDFDocument.load(bytes);
    if (doc.getPageCount() !== 2) throw new Error(`translated pages ${doc.getPageCount()}`);
  });

  await step("ai question generator: produces questions and a .pdf", async () => {
    await page.goto(`${BASE}/tool.html?tool=ai-question-generator`);
    await page.setInputFiles("input[type=file]", join(tmp, "a.pdf"));
    await page.waitForSelector("#ai-go");
    await page.fill("#ai-count", "3");
    await page.click("#ai-go");
    await page.waitForFunction(() => /Answer: A/.test(document.querySelector("#ai-out")?.textContent || ""));
    if (!/Write 3 multiple-choice/.test(requests[requests.length - 1].body.messages[1].content)) throw new Error("count not in prompt");
    const { bytes } = await downloadBytes(page, () => page.click("#ai-dl-pdf"));
    if ((await PDFDocument.load(bytes)).getPageCount() !== 1) throw new Error("questions pdf");
  });

  await step("ai: a 401 from the endpoint is explained and reopens the settings", async () => {
    await page.route("**/v1/chat/completions", (route) => {
      if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
      return route.fulfill({ status: 401, headers: { ...CORS, "content-type": "application/json" }, body: JSON.stringify({ error: { message: "bad key" } }) });
    });
    await page.goto(`${BASE}/tool.html?tool=ai-assistant`);
    await page.setInputFiles("input[type=file]", join(tmp, "a.pdf"));
    await page.waitForSelector("#ai-input");
    await page.click(".ai-chips .chip >> nth=1");
    await page.waitForSelector("#ai-msgs .ai-msg.error");
    const msg = await page.textContent("#ai-msgs .ai-msg.error");
    if (!/Check your API key/.test(msg)) throw new Error(msg);
    const hidden = await page.$eval(".ai-settings", (el) => el.hidden);
    if (hidden) throw new Error("settings should reopen on auth errors");
    await page.unroute("**/v1/chat/completions");
    // the browser logs the deliberate 401 as a resource error; it is the expected outcome here
    if (consoleErrors) {
      const keep = consoleErrors.filter((e) => !/401 \(Unauthorized\)/.test(e));
      consoleErrors.length = 0;
      consoleErrors.push(...keep);
    }
  });

  await step("pdf ocr: real engine, offline English, adds a searchable text layer that reads 'Page'", async () => {
    await page.goto(`${BASE}/tool.html?tool=pdf-ocr`);
    await page.setInputFiles("input[type=file]", join(tmp, "a.pdf"));
    await page.waitForSelector("#run");
    await page.click("#run");
    await page.waitForSelector("#download", { timeout: 120_000 });
    const size = await page.textContent("#result-size");
    if (!/2 pages/.test(size)) throw new Error(size);
    const { name, bytes } = await downloadBytes(page, () => page.click("#download"));
    if (name !== "a-searchable.pdf") throw new Error(name);
    const doc = await PDFDocument.load(bytes);
    if (doc.getPageCount() !== 2) throw new Error("ocr pages");
    if (doc.getPage(0).getWidth() !== 300 || doc.getPage(0).getHeight() !== 400) throw new Error("page size changed");
    const text = await pdfText(bytes);
    if (!/Page/i.test(text)) throw new Error(`no OCR text layer found: ${JSON.stringify(text.slice(0, 120))}`);
  });

  await step("pdf ocr: plain text output from a photo", async () => {
    // render page 1 of a.pdf to a PNG through the site itself, then OCR that image as a photo
    await page.goto(`${BASE}/tool.html?tool=pdf-to-png`);
    await page.setInputFiles("input[type=file]", join(tmp, "a.pdf"));
    await page.waitForSelector("#run");
    await page.click(".page >> nth=0");
    await page.click("#run");
    await page.waitForSelector("#download");
    const png = await downloadBytes(page, () => page.click("#download"));
    const { writeFileSync } = await import("node:fs");
    writeFileSync(join(tmp, "page1.png"), png.bytes);
    await page.goto(`${BASE}/tool.html?tool=pdf-ocr`);
    await page.setInputFiles("input[type=file]", join(tmp, "page1.png"));
    await page.waitForSelector("#run");
    await page.click("text=Plain text (.txt)");
    await page.click("#run");
    await page.waitForSelector("#download", { timeout: 120_000 });
    const { name, bytes } = await downloadBytes(page, () => page.click("#download"));
    if (name !== "page1.txt") throw new Error(name);
    const text = new TextDecoder().decode(bytes);
    if (!/Page\s*1/i.test(text)) throw new Error(`ocr text: ${JSON.stringify(text)}`);
  });

  await page.unroute("**/v1/models");
}
