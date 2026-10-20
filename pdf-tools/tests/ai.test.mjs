import { test } from "node:test";
import assert from "node:assert/strict";
import * as ai from "../src/tools/ai.js";

class MemStorage {
  constructor() {
    this.m = new Map();
  }
  getItem(k) {
    return this.m.has(k) ? this.m.get(k) : null;
  }
  setItem(k, v) {
    this.m.set(k, String(v));
  }
}

function jsonResponse(obj, { status = 200, headers = {} } = {}) {
  const body = JSON.stringify(obj);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => ({ "content-type": "application/json", ...headers })[k.toLowerCase()] },
    text: async () => body,
    json: async () => obj,
  };
}

function sseResponse(events) {
  const text = events.map((e) => `data: ${typeof e === "string" ? e : JSON.stringify(e)}\n\n`).join("");
  const enc = new TextEncoder();
  // deliver in awkward 7-byte pieces to exercise the buffer
  const chunks = [];
  for (let i = 0; i < text.length; i += 7) chunks.push(enc.encode(text.slice(i, i + 7)));
  const stream = new ReadableStream({
    start(c) {
      chunks.forEach((x) => c.enqueue(x));
      c.close();
    },
  });
  return { ok: true, status: 200, headers: { get: (k) => (k.toLowerCase() === "content-type" ? "text/event-stream" : null) }, body: stream, text: async () => text };
}

test("settings: defaults, normalize, validate, round-trip", () => {
  const st = new MemStorage();
  assert.deepEqual(ai.loadSettings(st), ai.DEFAULT_SETTINGS);
  assert.equal(ai.normalizeBaseUrl(" localhost:20128/v1/ "), "http://localhost:20128/v1");
  assert.equal(ai.normalizeBaseUrl("https://api.example.com/v1/chat/completions"), "https://api.example.com/v1");
  assert.match(ai.validateSettings({ baseUrl: "", model: "x" }), /endpoint URL/);
  assert.match(ai.validateSettings({ baseUrl: "ftp://x", model: "x" }), /http/);
  assert.match(ai.validateSettings({ baseUrl: "http://x/v1", model: "" }), /model/);
  assert.match(ai.validateSettings({ baseUrl: "http://x/v1", model: "m", temperature: 5 }), /Temperature/);
  assert.equal(ai.validateSettings({ baseUrl: "http://x/v1", model: "m", temperature: 0.2 }), null);
  const saved = ai.saveSettings({ baseUrl: "api.example.com/v1/", apiKey: "k", model: "m" }, st);
  assert.equal(saved.baseUrl, "http://api.example.com/v1");
  assert.equal(ai.loadSettings(st).apiKey, "k");
  st.setItem(ai.SETTINGS_KEY, "{not json");
  assert.deepEqual(ai.loadSettings(st), ai.DEFAULT_SETTINGS);
});

test("chunkText prefers paragraph, then sentence, then word boundaries and never drops text", () => {
  const paras = Array.from({ length: 6 }, (_, i) => `Paragraph ${i}. ` + "word ".repeat(40)).join("\n\n");
  const chunks = ai.chunkText(paras, 500);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((c) => c.length <= 500));
  assert.equal(chunks.join(" ").replace(/\s+/g, " ").trim(), paras.replace(/\s+/g, " ").trim());
  // sentence boundary
  const sentences = "One two three. Four five six. Seven eight nine. Ten.";
  const s = ai.chunkText(sentences, 32);
  assert.ok(s.every((c) => /[.!?]$/.test(c)), s.join("|"));
  // a single giant word is cut hard
  assert.deepEqual(ai.chunkText("x".repeat(25), 10).map((c) => c.length), [10, 10, 5]);
  assert.deepEqual(ai.chunkText("   ", 10), []);
});

test("buildContext truncates long documents and reports it", () => {
  const short = ai.buildContext("hello", 100);
  assert.deepEqual(short, { context: "hello", truncated: false, chars: 5, total: 5 });
  const long = ai.buildContext("a. ".repeat(1000), 100);
  assert.equal(long.truncated, true);
  assert.ok(long.chars <= 100 && long.chars > 40);
  assert.equal(long.total, 3000 - 1);
});

test("prompts carry the document, the truncation note, and the history", () => {
  const msgs = ai.chatMessages({ docName: "x.pdf", context: "DOC", truncated: true, total: 999, history: [{ role: "user", content: "q1" }, { role: "assistant", content: "a1" }], question: "q2" });
  assert.equal(msgs[0].role, "system");
  assert.match(msgs[1].content, /DOC/);
  assert.match(msgs[1].content, /Only the first 3 of 999/);
  assert.deepEqual(msgs.slice(-3).map((m) => m.content), ["q1", "a1", "q2"]);
  assert.match(ai.summaryPrompt("bullets"), /bullet/);
  assert.match(ai.summaryPrompt("nope"), /120 words/);
  assert.match(ai.questionsPrompt({ count: 500, type: "mcq" }), /Write 50 multiple-choice/);
  assert.match(ai.questionsPrompt({ count: 3, type: "open" }), /3 open questions/);
  assert.match(ai.translatePrompt("French"), /into French/);
  assert.equal(ai.estimateTokens(400), 100);
});

test("deltaFromEvent and sseDeltas parse chunked streams, ignore [DONE] and partial lines", async () => {
  assert.equal(ai.deltaFromEvent('data: {"choices":[{"delta":{"content":"Hel"}}]}\ndata: [DONE]'), "Hel");
  assert.equal(ai.deltaFromEvent("data: {broken"), "");
  const res = sseResponse([{ choices: [{ delta: { content: "Hello" } }] }, { choices: [{ delta: { content: ", " } }] }, { choices: [{ delta: { content: "world" } }] }, "[DONE]"]);
  const parts = [];
  for await (const p of ai.sseDeltas(res.body)) parts.push(p);
  assert.deepEqual(parts, ["Hello", ", ", "world"]);
});

test("chatCompletion streams tokens, falls back to JSON, and never sends the key anywhere else", async () => {
  const settings = { baseUrl: "http://router.local/v1", apiKey: "secret-key", model: "m", temperature: 0.1 };
  const calls = [];
  const fetchStream = async (url, init) => {
    calls.push({ url, init });
    return sseResponse([{ choices: [{ delta: { content: "A" } }] }, { choices: [{ delta: { content: "B" } }] }]);
  };
  const tokens = [];
  const full = await ai.chatCompletion(settings, [{ role: "user", content: "hi" }], { fetchImpl: fetchStream, onToken: (t, f) => tokens.push([t, f]) });
  assert.equal(full, "AB");
  assert.deepEqual(tokens, [["A", "A"], ["B", "AB"]]);
  assert.equal(calls[0].url, "http://router.local/v1/chat/completions");
  assert.equal(calls[0].init.headers.authorization, "Bearer secret-key");
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.model, "m");
  assert.equal(body.stream, true);
  assert.equal(body.temperature, 0.1);

  const fetchJson = async () => jsonResponse({ choices: [{ message: { content: "  plain reply " } }] });
  assert.equal(await ai.chatCompletion(settings, [], { fetchImpl: fetchJson }), "plain reply");
  const fetchArray = async () => jsonResponse({ choices: [{ message: { content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] } }] });
  assert.equal(await ai.chatCompletion(settings, [], { fetchImpl: fetchArray }), "ab");
  // streaming text served with a wrong content-type still works
  const fetchMislabeled = async () => ({ ok: true, status: 200, headers: { get: () => "text/plain" }, text: async () => 'data: {"choices":[{"delta":{"content":"x"}}]}\n\ndata: {"choices":[{"delta":{"content":"y"}}]}\n\n' });
  assert.equal(await ai.chatCompletion(settings, [], { fetchImpl: fetchMislabeled }), "xy");
  // no key -> no authorization header
  const noKey = [];
  await ai.chatCompletion({ ...settings, apiKey: "" }, [], { fetchImpl: async (u, i) => (noKey.push(i), jsonResponse({ choices: [{ message: { content: "ok" } }] })) });
  assert.equal(noKey[0].headers.authorization, undefined);
});

test("errors are mapped to plain sentences", async () => {
  const settings = { baseUrl: "http://router.local/v1", apiKey: "k", model: "m" };
  await assert.rejects(() => ai.chatCompletion(settings, [], { fetchImpl: async () => jsonResponse({ error: { message: "bad key" } }, { status: 401 }) }), /Check your API key/);
  await assert.rejects(() => ai.chatCompletion(settings, [], { fetchImpl: async () => jsonResponse({}, { status: 404 }) }), /no chat completions route/);
  await assert.rejects(() => ai.chatCompletion(settings, [], { fetchImpl: async () => jsonResponse({}, { status: 429 }) }), /Rate limited/);
  await assert.rejects(() => ai.chatCompletion(settings, [], { fetchImpl: async () => jsonResponse({ error: { message: "boom" } }, { status: 500 }) }), /failed \(500\)\. boom/);
  await assert.rejects(
    () =>
      ai.chatCompletion(settings, [], {
        fetchImpl: async () => {
          throw new TypeError("fetch failed");
        },
      }),
    /Could not reach http:\/\/router.local\/v1/
  );
  await assert.rejects(() => ai.chatCompletion({ ...settings, model: "" }, [], { fetchImpl: async () => jsonResponse({}) }), /model/);
  await assert.rejects(() => ai.chatCompletion(settings, [], { fetchImpl: async () => ({ ok: true, status: 200, headers: { get: () => "text/html" }, text: async () => "<html>" }) }), /not JSON/);
  const abortErr = new Error("x");
  abortErr.name = "AbortError";
  assert.equal(ai.mapError(abortErr, settings).code, "aborted");
});

test("listModels accepts the common response shapes", async () => {
  const settings = { baseUrl: "http://router.local/v1", apiKey: "k", model: "m" };
  assert.deepEqual(await ai.listModels(settings, { fetchImpl: async () => jsonResponse({ data: [{ id: "a" }, { id: "b" }] }) }), ["a", "b"]);
  assert.deepEqual(await ai.listModels(settings, { fetchImpl: async () => jsonResponse({ models: [{ name: "llama3" }] }) }), ["llama3"]);
  assert.deepEqual(await ai.listModels(settings, { fetchImpl: async () => jsonResponse(["x"]) }), ["x"]);
  await assert.rejects(() => ai.listModels({ baseUrl: "" }, { fetchImpl: async () => jsonResponse({}) }), /endpoint URL/);
});

test("translatePages works per page and chunk, keeps order, reports progress", async () => {
  const settings = { baseUrl: "http://router.local/v1", apiKey: "", model: "m" };
  const seen = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    const userText = body.messages.find((m) => m.role === "user").content;
    seen.push(userText);
    assert.equal(body.stream, false);
    return jsonResponse({ choices: [{ message: { content: `T(${userText})` } }] });
  };
  const progress = [];
  const out = await ai.translatePages(["one. two.", "a".repeat(20)], settings, { language: "German", fetchImpl, chunkChars: 6, onProgress: (p) => progress.push(p) });
  assert.equal(out.length, 2);
  assert.equal(out[0], "T(one.)\n\nT(two.)");
  assert.equal(out[1], "T(aaaaaa)\n\nT(aaaaaa)\n\nT(aaaaaa)\n\nT(aa)");
  assert.equal(progress[progress.length - 1], 1);
  assert.equal(seen.length, 6);
});

test("textToBlocks keeps paragraphs and joins wrapped lines", () => {
  assert.deepEqual(
    ai.textToBlocks("Para one\nstill one\n\n\nPara two  \r\n").map((b) => b.text),
    ["Para one still one", "Para two"]
  );
});
