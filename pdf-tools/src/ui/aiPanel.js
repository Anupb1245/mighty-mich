// Shared workspace for the AI tools. mode: "chat" | "summary" | "translate" | "questions".
import * as ai from "../tools/ai.js";
import { PDFDocument } from "../tools/core.js";
import { layoutBlocks } from "../tools/text.js";

export function mountAiPanel({ file, container, api, mode = "chat", chatFirst = false }) {
  const { h, icons, toast, download } = api;
  let settings = ai.loadSettings();
  let docText = "";
  let pages = [];
  let context = { context: "", truncated: false, chars: 0, total: 0 };
  let abort = null;
  let connection = null; // null unknown, true ok, false bad

  // ---- header ------------------------------------------------------------------------------
  const dot = h("span", { class: "dot" });
  const endpointLabel = h("span", {}, shortBase(settings.baseUrl) || "Set up endpoint");
  const endpointBtn = h("button", { class: "endpoint", type: "button", html: icons.settings, onclick: () => toggleSettings(), title: "Endpoint settings" }, dot, endpointLabel);
  const docInfo = h("span", { id: "ai-docinfo" }, "Reading the document…");
  const top = h("div", { class: "ai-top" }, h("div", { class: "doc" }, h("span", { html: icons.ai, style: "width:20px;height:20px;color:var(--c-ai)" }), h("b", {}, file.name), docInfo), endpointBtn);

  // ---- settings ----------------------------------------------------------------------------
  const inBase = h("input", { type: "text", value: settings.baseUrl, placeholder: "http://localhost:20128/v1", autocomplete: "off", spellcheck: false, "aria-label": "Endpoint base URL", id: "ai-base" });
  const inKey = h("input", { type: "password", value: settings.apiKey, placeholder: "sk-… (optional for local routers)", autocomplete: "off", "aria-label": "API key", id: "ai-key" });
  const inModel = h("input", { type: "text", value: settings.model, placeholder: "e.g. gpt-4o-mini, claude-sonnet-4, llama3", autocomplete: "off", spellcheck: false, "aria-label": "Model", id: "ai-model", list: "ai-models" });
  const modelList = h("datalist", { id: "ai-models" });
  const inTemp = h("input", { type: "number", value: settings.temperature, min: 0, max: 2, step: 0.1, "aria-label": "Temperature", id: "ai-temp" });
  const status = h("span", { class: "status" });
  const settingsBox = h(
    "div",
    { class: "ai-settings", hidden: true },
    h("p", { class: "note" }, "Your browser talks to this endpoint directly: the document text goes there and nowhere else. Any OpenAI-compatible API works: your own router on this machine, a hosted provider, Ollama, LM Studio. Settings are saved only in this browser."),
    h("div", { class: "row" }, h("div", { class: "opt" }, h("label", { for: "ai-base" }, "Endpoint (base URL ending in /v1)"), inBase), h("div", { class: "opt" }, h("label", { for: "ai-key" }, "API key"), inKey)),
    h("div", { class: "row" }, h("div", { class: "opt" }, h("label", { for: "ai-model" }, "Model"), inModel, modelList), h("div", { class: "opt" }, h("label", { for: "ai-temp" }, "Temperature"), inTemp)),
    h(
      "div",
      { class: "acts" },
      h("button", { class: "btn secondary", type: "button", id: "ai-test", onclick: testConnection }, "Test connection & load models"),
      h("button", { class: "btn", type: "button", id: "ai-save", onclick: () => saveFromForm(true) }, "Save"),
      status
    )
  );
  function readForm() {
    return { ...settings, baseUrl: inBase.value, apiKey: inKey.value, model: inModel.value.trim(), temperature: Number(inTemp.value) };
  }
  function saveFromForm(announce) {
    settings = ai.saveSettings(readForm());
    inBase.value = settings.baseUrl;
    endpointLabel.textContent = shortBase(settings.baseUrl) || "Set up endpoint";
    const v = ai.validateSettings(settings);
    if (announce) {
      status.className = "status " + (v ? "bad" : "ok");
      status.textContent = v || "Saved.";
    }
    return !v;
  }
  function toggleSettings(force) {
    settingsBox.hidden = force === undefined ? !settingsBox.hidden : !force;
  }
  async function testConnection() {
    status.className = "status";
    status.textContent = "Connecting…";
    const s = { ...readForm() };
    try {
      const models = await ai.listModels(s);
      modelList.replaceChildren(...models.slice(0, 200).map((m) => h("option", { value: m })));
      if (!s.model && models.length) inModel.value = models[0];
      connection = true;
      dot.className = "dot ok";
      status.className = "status ok";
      status.textContent = models.length ? `Connected. ${models.length} model${models.length === 1 ? "" : "s"} available; pick one above.` : "Connected, but the endpoint listed no models. Type the model name.";
      saveFromForm(false);
    } catch (err) {
      connection = false;
      dot.className = "dot bad";
      status.className = "status bad";
      status.textContent = err.message;
    }
  }

  // ---- body per mode ----------------------------------------------------------------------
  const main = h("div", { class: "ai-main" });
  const root = h("div", { class: "ai" }, top, h("div", { class: "ai-body" }, settingsBox, main));
  container.append(root);
  if (ai.validateSettings(settings)) toggleSettings(true);

  const ensureSettings = () => {
    if (saveFromForm(false)) return true;
    toggleSettings(true);
    status.className = "status bad";
    status.textContent = ai.validateSettings(readForm());
    return false;
  };

  const stopBtn = () => h("button", { class: "btn secondary", type: "button", onclick: () => abort?.abort() }, "Stop");

  async function complete(messages, { onToken, stream = true } = {}) {
    abort?.abort();
    abort = new AbortController();
    try {
      return await ai.chatCompletion(settings, messages, { signal: abort.signal, onToken, stream });
    } finally {
      abort = null;
    }
  }

  function downloadText(text, name) {
    download(new TextEncoder().encode(text), name, "text/plain;charset=utf-8");
  }
  async function downloadPdf(text, name, { title } = {}) {
    const doc = await PDFDocument.create({ updateMetadata: false });
    const blocks = ai.textToBlocks(text);
    if (title) blocks.unshift({ text: title, size: 18, bold: true, spaceAfter: 12 });
    await layoutBlocks(doc, blocks);
    download(await doc.save({ useObjectStreams: true }), name, "application/pdf");
  }
  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast("Copied.");
    } catch {
      toast("Could not copy. Select the text instead.", "error");
    }
  }

  const base = (file.name || "document").replace(/\.pdf$/i, "");

  if (mode === "chat") mountChat();
  else if (mode === "summary") mountSummary();
  else if (mode === "translate") mountTranslate();
  else if (mode === "questions") mountQuestions();

  // chat --------------------------------------------------------------------------------------
  function mountChat() {
    const history = [];
    const msgs = h("div", { class: "ai-msgs", "aria-live": "polite", id: "ai-msgs" });
    const input = h("textarea", { placeholder: "Ask anything about this document…", rows: 1, id: "ai-input", onkeydown: (e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), ask(input.value)) });
    const send = h("button", { class: "btn", type: "button", id: "ai-send", html: `${icons.chat}<span>Send</span>`, onclick: () => ask(input.value) });
    const chips = h("div", { class: "ai-chips" }, ai.QUICK_ACTIONS.map(([label, q]) => h("button", { class: "chip", type: "button", onclick: () => ask(q) }, label)));
    main.append(chatFirst ? msgs : chips, chatFirst ? chips : msgs, h("div", { class: "ai-compose" }, input, send));
    async function ask(q) {
      q = String(q || "").trim();
      if (!q || !ensureSettings()) return;
      input.value = "";
      msgs.append(h("div", { class: "ai-msg user" }, q));
      const bubble = h("div", { class: "ai-msg assistant streaming" }, "");
      msgs.append(bubble);
      msgs.scrollTop = msgs.scrollHeight;
      send.disabled = true;
      try {
        const messages = ai.chatMessages({ docName: file.name, context: context.context, truncated: context.truncated, total: context.total, history, question: q });
        const answer = await complete(messages, {
          onToken: (_, full) => {
            bubble.textContent = full;
            msgs.scrollTop = msgs.scrollHeight;
          },
        });
        bubble.textContent = answer || "(empty reply)";
        history.push({ role: "user", content: q }, { role: "assistant", content: answer });
      } catch (err) {
        bubble.remove();
        msgs.append(h("div", { class: "ai-msg error", role: "alert" }, err.message));
        if (err.code === "auth" || err.code === "settings") toggleSettings(true);
      } finally {
        bubble.classList.remove("streaming");
        send.disabled = false;
      }
    }
  }

  // summary -----------------------------------------------------------------------------------
  function mountSummary() {
    let style = "short";
    const out = h("div", { class: "ai-out", id: "ai-out", "data-empty": "The summary appears here." });
    const opts = h(
      "div",
      { class: "ai-opts", role: "radiogroup", "aria-label": "Summary style" },
      [["short", "Short"], ["detailed", "Detailed"], ["bullets", "Bullet points"]].map(([v, l]) => h("label", {}, h("input", { type: "radio", name: "style", value: v, checked: v === style, onchange: () => (style = v) }), l))
    );
    const go = h("button", { class: "btn", type: "button", id: "ai-go", html: `${icons.ai}<span>Summarize</span>`, onclick: run });
    const acts = h("div", { class: "ai-acts" }, go, h("span", { class: "grow" }), h("button", { class: "btn secondary", type: "button", onclick: () => copy(out.textContent) }, "Copy"), h("button", { class: "btn secondary", type: "button", onclick: () => downloadText(out.textContent, `${base}-summary.txt`) }, ".txt"), h("button", { class: "btn secondary", type: "button", id: "ai-dl-pdf", onclick: () => downloadPdf(out.textContent, `${base}-summary.pdf`, { title: `Summary of ${file.name}` }) }, ".pdf"));
    main.append(opts, acts, out);
    async function run() {
      if (!ensureSettings()) return;
      out.textContent = "";
      go.disabled = true;
      try {
        await complete(
          [
            { role: "system", content: ai.systemPrompt(file.name) },
            { role: "user", content: `${ai.contextMessage(context.context, context)}\n\n${ai.summaryPrompt(style)}` },
          ],
          { onToken: (_, full) => (out.textContent = full) }
        );
      } catch (err) {
        out.textContent = "";
        api.setError(err.message);
        if (err.code === "auth" || err.code === "settings") toggleSettings(true);
      } finally {
        go.disabled = false;
      }
    }
  }

  // translate ---------------------------------------------------------------------------------
  function mountTranslate() {
    const sel = h("select", { id: "ai-lang", "aria-label": "Target language" }, ai.LANGUAGES.map((l) => h("option", { value: l, selected: l === "Spanish" }, l)));
    const bar = h("div", { class: "ai-progress" }, h("i", {}));
    const hint = h("div", { class: "ai-hint" }, "Each page is translated in turn, so long documents take a while.");
    const out = h("div", { class: "ai-out", id: "ai-out", "data-empty": "The translation appears here, page by page." });
    let translated = null;
    const dl = h("button", { class: "btn", type: "button", id: "ai-dl-pdf", disabled: true, html: `${icons.download}<span>Download translated PDF</span>`, onclick: () => translated && downloadPdfPages(translated) });
    const go = h("button", { class: "btn", type: "button", id: "ai-go", html: `${icons.translate}<span>Translate</span>`, onclick: run });
    main.append(h("div", { class: "ai-opts" }, h("label", { for: "ai-lang" }, "Translate into"), sel), h("div", { class: "ai-acts" }, go, stopBtn(), h("span", { class: "grow" }), h("button", { class: "btn secondary", type: "button", onclick: () => translated && downloadText(translated.join("\n\n"), `${base}-${sel.value}.txt`) }, ".txt"), dl), bar, hint, out);
    async function run() {
      if (!ensureSettings()) return;
      go.disabled = true;
      dl.disabled = true;
      out.textContent = "";
      translated = null;
      abort?.abort();
      abort = new AbortController();
      try {
        const texts = pages.map((p) => p.text);
        const res = await ai.translatePages(texts, settings, {
          language: sel.value,
          signal: abort.signal,
          onProgress: (p) => {
            bar.firstChild.style.width = `${Math.round(p * 100)}%`;
          },
        });
        translated = res;
        out.textContent = res.map((t, i) => `— Page ${i + 1} —\n${t}`).join("\n\n");
        dl.disabled = false;
      } catch (err) {
        api.setError(err.message);
        if (err.code === "auth" || err.code === "settings") toggleSettings(true);
      } finally {
        abort = null;
        go.disabled = false;
      }
    }
    async function downloadPdfPages(texts) {
      const doc = await PDFDocument.create({ updateMetadata: false });
      const blocks = [];
      texts.forEach((t, i) => {
        if (i) blocks.push({ pageBreak: true });
        blocks.push(...ai.textToBlocks(t));
      });
      await layoutBlocks(doc, blocks.length ? blocks : [{ text: "" }]);
      download(await doc.save({ useObjectStreams: true }), `${base}-${sel.value}.pdf`, "application/pdf");
    }
  }

  // questions ---------------------------------------------------------------------------------
  function mountQuestions() {
    const count = h("input", { type: "number", value: 10, min: 1, max: 50, id: "ai-count", "aria-label": "Number of questions" });
    const type = h("select", { id: "ai-type", "aria-label": "Question type" }, h("option", { value: "mcq" }, "Multiple choice"), h("option", { value: "open" }, "Open questions"));
    const out = h("div", { class: "ai-out", id: "ai-out", "data-empty": "The questions appear here." });
    const go = h("button", { class: "btn", type: "button", id: "ai-go", html: `${icons.question}<span>Generate questions</span>`, onclick: run });
    main.append(
      h("div", { class: "ai-opts" }, h("label", { for: "ai-count" }, "How many"), count, h("label", { for: "ai-type" }, "Type"), type),
      h("div", { class: "ai-acts" }, go, h("span", { class: "grow" }), h("button", { class: "btn secondary", type: "button", onclick: () => copy(out.textContent) }, "Copy"), h("button", { class: "btn secondary", type: "button", onclick: () => downloadText(out.textContent, `${base}-questions.txt`) }, ".txt"), h("button", { class: "btn secondary", type: "button", id: "ai-dl-pdf", onclick: () => downloadPdf(out.textContent, `${base}-questions.pdf`, { title: `Questions on ${file.name}` }) }, ".pdf")),
      out
    );
    async function run() {
      if (!ensureSettings()) return;
      out.textContent = "";
      go.disabled = true;
      try {
        await complete(
          [
            { role: "system", content: ai.systemPrompt(file.name) },
            { role: "user", content: `${ai.contextMessage(context.context, context)}\n\n${ai.questionsPrompt({ count: count.value, type: type.value })}` },
          ],
          { onToken: (_, full) => (out.textContent = full) }
        );
      } catch (err) {
        out.textContent = "";
        api.setError(err.message);
        if (err.code === "auth" || err.code === "settings") toggleSettings(true);
      } finally {
        go.disabled = false;
      }
    }
  }

  // ---- read the document ------------------------------------------------------------------
  (async () => {
    try {
      pages = await api.render.extractText(file.bytes, { password: file.password });
      docText = pages.map((p) => p.text).join("\n\n");
      context = ai.buildContext(docText, settings.maxContextChars || ai.MAX_CONTEXT_CHARS);
      const chars = docText.length;
      if (!chars) {
        docInfo.textContent = `${pages.length} pages · no text found`;
        main.prepend(h("div", { class: "ai-hint warn" }, "This PDF has no text layer (a scan or photos). Run it through PDF OCR first, then come back."));
      } else {
        docInfo.textContent = `${pages.length} page${pages.length === 1 ? "" : "s"} · ${chars.toLocaleString()} characters · ~${ai.estimateTokens(context.chars).toLocaleString()} tokens sent per request${context.truncated ? ` (first ${Math.round((context.chars / context.total) * 100)}% only)` : ""}`;
        if (context.truncated && mode !== "translate") main.prepend(h("div", { class: "ai-hint warn" }, `The document is long, so only the first ${context.chars.toLocaleString()} of ${context.total.toLocaleString()} characters are sent with each request. Translation works page by page and covers everything.`));
      }
    } catch (err) {
      docInfo.textContent = "Could not read the text.";
      api.setError(err.message || String(err));
    }
  })();

  return {
    destroy() {
      abort?.abort();
    },
  };
}

function shortBase(url) {
  try {
    const u = new URL(url);
    return u.host + (u.pathname === "/" ? "" : u.pathname);
  } catch {
    return "";
  }
}
