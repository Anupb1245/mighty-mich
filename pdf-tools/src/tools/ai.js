// AI on a bring-your-own OpenAI-compatible endpoint. Pure logic: settings, chunking, prompts,
// the chat-completions call (streaming SSE with a JSON fallback) and error mapping. No DOM.

export const SETTINGS_KEY = "inkfold.ai.settings";
export const DEFAULT_SETTINGS = {
  baseUrl: "http://localhost:20128/v1",
  apiKey: "",
  model: "",
  temperature: 0.3,
  maxContextChars: 60000,
};

export const MAX_CONTEXT_CHARS = 60000;

export function loadSettings(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_SETTINGS, ...(parsed && typeof parsed === "object" ? parsed : {}) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings, storage = globalThis.localStorage) {
  const clean = { ...DEFAULT_SETTINGS, ...settings, baseUrl: normalizeBaseUrl(settings.baseUrl) };
  try {
    storage?.setItem(SETTINGS_KEY, JSON.stringify(clean));
  } catch {
    /* private mode */
  }
  return clean;
}

export function normalizeBaseUrl(url) {
  let u = String(url || "").trim();
  if (!u) return "";
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(u)) u = "http://" + u;
  u = u.replace(/\/+$/, "");
  u = u.replace(/\/(chat\/completions|models)$/i, "");
  return u;
}

/** null when fine, otherwise a sentence for the user. */
export function validateSettings(s) {
  const base = normalizeBaseUrl(s?.baseUrl);
  if (!base) return "Enter the endpoint URL (an OpenAI-compatible /v1 base).";
  try {
    const u = new URL(base);
    if (!/^https?:$/.test(u.protocol)) return "The endpoint must start with http:// or https://.";
  } catch {
    return "That endpoint URL does not look valid.";
  }
  if (!String(s?.model || "").trim()) return "Pick or type a model name.";
  const t = s?.temperature === undefined || s?.temperature === "" ? DEFAULT_SETTINGS.temperature : Number(s.temperature);
  if (Number.isNaN(t) || t < 0 || t > 2) return "Temperature must be between 0 and 2.";
  return null;
}

export const estimateTokens = (chars) => Math.ceil(Number(chars || 0) / 4);

/**
 * Split text into chunks of at most maxChars, preferring paragraph, then sentence, then word
 * boundaries. Never returns an empty chunk.
 */
export function chunkText(text, maxChars = 12000) {
  const s = String(text || "").replace(/\r\n?/g, "\n").trim();
  if (!s) return [];
  if (s.length <= maxChars) return [s];
  const chunks = [];
  let rest = s;
  while (rest.length > maxChars) {
    let cut = -1;
    for (const re of [/\n\s*\n/g, /[.!?]["')\]]?\s+/g, /\s+/g]) {
      let m;
      let best = -1;
      re.lastIndex = 0;
      while ((m = re.exec(rest)) && m.index + m[0].length <= maxChars) best = m.index + m[0].length;
      if (best > maxChars * 0.4) {
        cut = best;
        break;
      }
    }
    if (cut < 0) cut = maxChars;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks.filter(Boolean);
}

/** The slice of a document that fits one request. */
export function buildContext(text, maxChars = MAX_CONTEXT_CHARS) {
  const s = String(text || "").trim();
  if (s.length <= maxChars) return { context: s, truncated: false, chars: s.length, total: s.length };
  const cut = chunkText(s, maxChars)[0] || s.slice(0, maxChars);
  return { context: cut, truncated: true, chars: cut.length, total: s.length };
}

// ---- prompts -------------------------------------------------------------------------------

export function systemPrompt(docName = "the document") {
  return `You are a careful assistant answering questions about ${docName}. Use only the document text provided. When the answer is not in the text, say so plainly. Be concise and specific; quote short passages when useful.`;
}

export function contextMessage(context, { truncated = false, total = 0 } = {}) {
  const note = truncated ? `\n\n[Only the first ${context.length.toLocaleString()} of ${total.toLocaleString()} characters are included.]` : "";
  return `Document text:\n"""\n${context}\n"""${note}`;
}

export const SUMMARY_STYLES = {
  short: "Write a short summary of the document in one paragraph of at most 120 words.",
  detailed: "Write a detailed summary of the document: an overview paragraph, then the main sections with their key facts, figures and conclusions. Use headings and short paragraphs.",
  bullets: "Summarize the document as 8 to 15 bullet points, each one a complete, specific sentence. Put the most important points first.",
};

export function summaryPrompt(style = "short") {
  return SUMMARY_STYLES[style] || SUMMARY_STYLES.short;
}

export const QUICK_ACTIONS = [
  ["Summarize", "Summarize this document in a short paragraph."],
  ["Key points", "List the 5 to 10 most important points as bullets."],
  ["Explain simply", "Explain what this document is about in plain language a newcomer would understand."],
  ["Action items", "List every action item, deadline or decision mentioned, with who is responsible when stated."],
];

export function questionsPrompt({ count = 10, type = "mcq" } = {}) {
  const n = Math.max(1, Math.min(50, Number(count) || 10));
  if (type === "open")
    return `Write ${n} open questions that test understanding of the document, from easy to hard. After each question give a model answer in one or two sentences, prefixed "Answer:". Number the questions.`;
  return `Write ${n} multiple-choice questions that test understanding of the document, from easy to hard. Each question has four options labelled A to D with exactly one correct option. After the options, write "Answer: <letter>" and one sentence explaining why. Number the questions.`;
}

export const LANGUAGES = ["English", "Spanish", "French", "German", "Portuguese", "Italian", "Dutch", "Polish", "Turkish", "Russian", "Ukrainian", "Arabic", "Hindi", "Chinese (Simplified)", "Chinese (Traditional)", "Japanese", "Korean", "Vietnamese", "Indonesian", "Swedish"];

export function translatePrompt(language) {
  return `Translate the following text into ${language}. Keep the meaning exact, keep every paragraph break (blank lines) exactly where they are, keep numbers, names, lists and headings as they are. Output only the translation, no notes.`;
}

export function chatMessages({ docName, context, truncated, total, history = [], question }) {
  return [
    { role: "system", content: systemPrompt(docName) },
    { role: "user", content: contextMessage(context, { truncated, total }) },
    { role: "assistant", content: "I have read the document. What would you like to know?" },
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: question },
  ];
}

// ---- the call ------------------------------------------------------------------------------

export class AiError extends Error {
  constructor(message, { status, code } = {}) {
    super(message);
    this.status = status;
    this.code = code || "ai_error";
  }
}

export function mapError(err, settings) {
  const base = normalizeBaseUrl(settings?.baseUrl) || "the endpoint";
  if (err instanceof AiError) return err;
  if (err?.name === "AbortError") return new AiError("Stopped.", { code: "aborted" });
  return new AiError(`Could not reach ${base}. Is it running, and does it allow requests from this site (CORS)?`, { code: "network" });
}

export function errorForStatus(status, bodyText = "", settings) {
  const base = normalizeBaseUrl(settings?.baseUrl) || "the endpoint";
  let detail = "";
  try {
    const j = JSON.parse(bodyText);
    detail = j?.error?.message || j?.message || "";
  } catch {
    detail = String(bodyText || "").slice(0, 200);
  }
  if (status === 401 || status === 403) return new AiError("The endpoint rejected the request. Check your API key.", { status, code: "auth" });
  if (status === 404) return new AiError(`${base} has no chat completions route. Check the base URL ends with /v1 and the model name.`, { status, code: "not_found" });
  if (status === 429) return new AiError("Rate limited by the endpoint. Wait a moment and try again.", { status, code: "rate_limit" });
  if (status >= 500) return new AiError(`The endpoint failed (${status}). ${detail}`.trim(), { status, code: "upstream" });
  return new AiError(`Request failed (${status}). ${detail}`.trim(), { status, code: "request" });
}

function headersFor(settings) {
  const h = { "content-type": "application/json" };
  if (settings.apiKey) h.authorization = `Bearer ${settings.apiKey}`;
  return h;
}

/** Parse one SSE event block's data lines into the delta text it carries. */
export function deltaFromEvent(block) {
  let text = "";
  for (const line of block.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    try {
      const j = JSON.parse(data);
      const choice = j.choices?.[0];
      const piece = choice?.delta?.content ?? choice?.message?.content ?? choice?.text ?? "";
      if (typeof piece === "string") text += piece;
    } catch {
      /* partial JSON lands in the next block */
    }
  }
  return text;
}

/** Walk an SSE stream, yielding delta text per event. */
export async function* sseDeltas(stream) {
  const reader = stream.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.search(/\r?\n\r?\n/)) >= 0) {
      const block = buf.slice(0, idx);
      buf = buf.slice(idx).replace(/^\r?\n\r?\n/, "");
      const t = deltaFromEvent(block);
      if (t) yield t;
    }
  }
  if (buf.trim()) {
    const t = deltaFromEvent(buf);
    if (t) yield t;
  }
}

/**
 * One chat completion. Streams tokens through onToken when the server streams; otherwise reads
 * the JSON reply. Resolves with the full text.
 */
export async function chatCompletion(settings, messages, { signal, onToken, stream = true, fetchImpl, maxTokens } = {}) {
  const err = validateSettings(settings);
  if (err) throw new AiError(err, { code: "settings" });
  const f = fetchImpl || globalThis.fetch;
  const base = normalizeBaseUrl(settings.baseUrl);
  const body = { model: settings.model, messages, temperature: Number(settings.temperature ?? 0.3), stream: !!stream };
  if (maxTokens) body.max_tokens = maxTokens;
  let res;
  try {
    res = await f(`${base}/chat/completions`, { method: "POST", headers: headersFor(settings), body: JSON.stringify(body), signal });
  } catch (e) {
    throw mapError(e, settings);
  }
  if (!res.ok) throw errorForStatus(res.status, await res.text().catch(() => ""), settings);
  const ctype = res.headers?.get?.("content-type") || "";
  if (stream && /text\/event-stream/i.test(ctype) && res.body) {
    let full = "";
    for await (const piece of sseDeltas(res.body)) {
      full += piece;
      onToken?.(piece, full);
    }
    return full.trim();
  }
  const text = await res.text();
  let j;
  try {
    j = JSON.parse(text);
  } catch {
    // some servers stream without the right content-type
    if (/^data:/m.test(text)) {
      const full = text.split(/\r?\n\r?\n/).map(deltaFromEvent).join("");
      onToken?.(full, full);
      return full.trim();
    }
    throw new AiError("The endpoint returned something that is not JSON.", { code: "bad_response" });
  }
  const choice = j.choices?.[0];
  const content = choice?.message?.content ?? choice?.text ?? "";
  const full = Array.isArray(content) ? content.map((c) => c?.text || "").join("") : String(content || "");
  onToken?.(full, full);
  return full.trim();
}

/** GET {base}/models -> model ids. */
export async function listModels(settings, { fetchImpl, signal } = {}) {
  const f = fetchImpl || globalThis.fetch;
  const base = normalizeBaseUrl(settings.baseUrl);
  if (!base) throw new AiError("Enter the endpoint URL first.", { code: "settings" });
  let res;
  try {
    res = await f(`${base}/models`, { headers: headersFor(settings), signal });
  } catch (e) {
    throw mapError(e, settings);
  }
  if (!res.ok) throw errorForStatus(res.status, await res.text().catch(() => ""), settings);
  const j = await res.json().catch(() => ({}));
  const list = Array.isArray(j.data) ? j.data : Array.isArray(j.models) ? j.models : Array.isArray(j) ? j : [];
  return list.map((m) => (typeof m === "string" ? m : m?.id || m?.name)).filter(Boolean);
}

/**
 * Translate page texts one by one (chunked), keeping paragraph breaks.
 * Returns translated page strings. onProgress(0..1).
 */
export async function translatePages(pageTexts, settings, { language, onProgress, signal, fetchImpl, chunkChars = 6000 } = {}) {
  const jobs = [];
  pageTexts.forEach((t, pi) => chunkText(t, chunkChars).forEach((c, ci) => jobs.push({ pi, ci, text: c })));
  const out = pageTexts.map(() => []);
  for (let i = 0; i < jobs.length; i++) {
    const { pi, ci, text } = jobs[i];
    const translated = await chatCompletion(
      settings,
      [
        { role: "system", content: translatePrompt(language) },
        { role: "user", content: text },
      ],
      { signal, stream: false, fetchImpl }
    );
    out[pi][ci] = translated;
    onProgress?.((i + 1) / Math.max(1, jobs.length));
  }
  return out.map((parts) => parts.join("\n\n"));
}

/** Paragraph blocks for layoutBlocks from plain text: blank line = paragraph break. */
export function textToBlocks(text, { size = 11 } = {}) {
  return String(text || "")
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => ({ text: p.replace(/\s*\n\s*/g, " "), size }));
}
