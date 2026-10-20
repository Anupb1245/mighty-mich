// End-to-end: real Chromium against the static server. `npm run test:e2e`.
// Each file in tests/e2e/steps/ exports `default async ({ page, context, step, BASE, tmp, downloadBytes }) => {}`
// and is run in filename order. Run a subset with `node tests/e2e/run.mjs core editor`.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import { makePdf } from "../helpers.mjs";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const tmp = join(root, ".tmp");
mkdirSync(tmp, { recursive: true });
const PORT = Number(process.env.E2E_PORT || 4199);
const BASE = `http://localhost:${PORT}`;
const EXE = process.env.CHROMIUM_PATH || ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/opt/pw-browsers/chromium/chrome"].find(existsSync);
const only = process.argv.slice(2);

const results = [];
async function step(name, fn) {
  const t = Date.now();
  try {
    await fn();
    results.push([name, true]);
    console.log(`ok   ${name} (${Date.now() - t}ms)`);
  } catch (err) {
    results.push([name, false, err]);
    console.log(`FAIL ${name}\n     ${String(err?.stack || err).split("\n").slice(0, 14).join("\n     ")}`);
  }
}

async function downloadBytes(page, trigger) {
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 90_000 }), trigger()]);
  return { name: dl.suggestedFilename(), bytes: new Uint8Array(readFileSync(await dl.path())) };
}

const server = spawn(process.execPath, [join(root, "scripts/serve.mjs")], { env: { ...process.env, PORT: String(PORT) }, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 600));

const browser = await chromium.launch({ executablePath: EXE, headless: true });
const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const consoleErrors = [];
page.on("pageerror", (e) => consoleErrors.push(String(e)));
page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));

// shared fixtures
const a = await makePdf(2, { name: "a.pdf" });
const b = await makePdf(3, { name: "b.pdf" });
writeFileSync(join(tmp, "a.pdf"), a.bytes);
writeFileSync(join(tmp, "b.pdf"), b.bytes);
writeFileSync(join(tmp, "junk.txt"), "hello");

try {
  const dir = join(root, "tests/e2e/steps");
  const files = readdirSync(dir).filter((f) => f.endsWith(".mjs")).sort();
  for (const f of files) {
    if (only.length && !only.some((o) => f.includes(o))) continue;
    console.log(`\n== ${f}`);
    const mod = await import(pathToFileURL(join(dir, f)).href);
    await mod.default({ page, context, step, BASE, tmp, downloadBytes, consoleErrors });
  }

  await step("mobile: no horizontal scroll on home and tool page", async () => {
    const m = await context.newPage();
    await m.setViewportSize({ width: 375, height: 740 });
    for (const url of [`${BASE}/`, `${BASE}/tool.html?tool=split-pdf`]) {
      await m.goto(url);
      await m.waitForSelector(".card, .drop");
      const over = await m.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (over > 0) throw new Error(`${url} overflows by ${over}px`);
    }
    await m.close();
  });

  await step("no page errors in the console", async () => {
    const real = consoleErrors.filter((e) => !/favicon/.test(e));
    if (real.length) throw new Error(real.slice(0, 3).join(" | "));
  });
} finally {
  await browser.close();
  server.kill();
}

const failed = results.filter((r) => !r[1]);
console.log(`\n${results.length - failed.length}/${results.length} e2e steps passed`);
process.exit(failed.length ? 1 : 0);
