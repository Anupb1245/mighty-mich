"use client";

// src/app/(dashboard)/dashboard/compare/page.tsx
//
// Compare — side-by-side model comparison grid.
// Fires the same prompt to 2-4 selected models in parallel via the local
// OpenAI-compatible /v1/chat/completions endpoint (non-streaming) and renders
// each response in a card with latency, token usage, and a "Best" vote button.
// Votes are persisted in localStorage ("mm-compare-votes") keyed by prompt hash.

import { useEffect, useMemo, useState } from "react";

const MIN_SLOTS = 2;
const MAX_SLOTS = 4;
const VOTES_STORAGE_KEY = "mm-compare-votes";

interface ModelOption {
  id: string;
}

interface CompareVote {
  promptHash: string;
  model: string;
}

type SlotStatus = "idle" | "running" | "done" | "error";

interface SlotResult {
  status: SlotStatus;
  response: string;
  latencyMs: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  errorMessage?: string;
}

const INITIAL_RESULT: SlotResult = {
  status: "idle",
  response: "",
  latencyMs: null,
  promptTokens: null,
  completionTokens: null,
};

/** Simple djb2 hash → hex string. Enough to key votes by prompt text. */
function hashPrompt(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16);
}

function readVotes(): CompareVote[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(VOTES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (v): v is CompareVote =>
        v != null &&
        typeof v === "object" &&
        typeof (v as CompareVote).promptHash === "string" &&
        typeof (v as CompareVote).model === "string"
    );
  } catch {
    return [];
  }
}

function writeVotes(votes: CompareVote[]): void {
  try {
    window.localStorage.setItem(VOTES_STORAGE_KEY, JSON.stringify(votes));
  } catch {
    // Storage full/unavailable — voting is best-effort.
  }
}

/** Extract assistant text from an OpenAI-compatible non-streaming response. */
function extractContent(payload: Record<string, unknown>): string {
  const choices = (payload["choices"] as Array<Record<string, unknown>> | undefined) ?? [];
  const message = choices[0]?.["message"] as Record<string, unknown> | undefined;
  const content = message?.["content"];
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        part != null &&
        typeof part === "object" &&
        typeof (part as { text?: unknown }).text === "string"
          ? (part as { text: string }).text
          : ""
      )
      .join("");
  }
  return "";
}

export default function ComparePage() {
  const [models, setModels] = useState<ModelOption[]>([]);
  const [modelsError, setModelsError] = useState<string | null>(null);

  // Selected model per slot (2-4 slots)
  const [slots, setSlots] = useState<string[]>(["", ""]);
  const [results, setResults] = useState<SlotResult[]>([INITIAL_RESULT, INITIAL_RESULT]);

  const [prompt, setPrompt] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  // Prompt hash of the last completed run — votes attach to this
  const [runPromptHash, setRunPromptHash] = useState<string | null>(null);

  const [votes, setVotes] = useState<CompareVote[]>([]);

  // Load available models (same pattern as playground ApiTab: plain same-origin fetch)
  useEffect(() => {
    let cancelled = false;
    fetch("/v1/models")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<{ data?: ModelOption[] }>;
      })
      .then((data) => {
        if (cancelled) return;
        const list = (data?.data ?? []).filter((m) => typeof m?.id === "string");
        list.sort((a, b) => a.id.localeCompare(b.id));
        setModels(list);
        // Auto-fill empty slots with the first models
        setSlots((prev) =>
          prev.map((slot, i) => (slot === "" && list[i] != null ? list[i].id : slot))
        );
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setModelsError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Load persisted votes
  useEffect(() => {
    setVotes(readVotes());
  }, []);

  const voteTally = useMemo(() => {
    const tally = new Map<string, number>();
    for (const vote of votes) {
      tally.set(vote.model, (tally.get(vote.model) ?? 0) + 1);
    }
    return Array.from(tally.entries()).sort((a, b) => b[1] - a[1]);
  }, [votes]);

  const currentVote = useMemo(
    () => (runPromptHash ? votes.find((v) => v.promptHash === runPromptHash) : undefined),
    [votes, runPromptHash]
  );

  function setSlotModel(index: number, model: string) {
    setSlots((prev) => prev.map((s, i) => (i === index ? model : s)));
  }

  function addSlot() {
    if (slots.length >= MAX_SLOTS) return;
    const nextModel = models.find((m) => !slots.includes(m.id))?.id ?? "";
    setSlots((prev) => [...prev, nextModel]);
    setResults((prev) => [...prev, INITIAL_RESULT]);
  }

  function removeSlot(index: number) {
    if (slots.length <= MIN_SLOTS) return;
    setSlots((prev) => prev.filter((_, i) => i !== index));
    setResults((prev) => prev.filter((_, i) => i !== index));
  }

  function updateResult(index: number, patch: Partial<SlotResult>) {
    setResults((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  async function runSlot(index: number, model: string, userPrompt: string): Promise<void> {
    updateResult(index, { ...INITIAL_RESULT, status: "running" });
    const startedAt = Date.now();
    try {
      const res = await fetch("/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          stream: false,
          messages: [{ role: "user", content: userPrompt }],
        }),
      });
      const latencyMs = Date.now() - startedAt;

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`);
      }

      const payload = (await res.json()) as Record<string, unknown>;
      const usage = payload["usage"] as
        { prompt_tokens?: number; completion_tokens?: number } | undefined;

      updateResult(index, {
        status: "done",
        response: extractContent(payload),
        latencyMs,
        promptTokens: usage?.prompt_tokens ?? null,
        completionTokens: usage?.completion_tokens ?? null,
      });
    } catch (err) {
      updateResult(index, {
        status: "error",
        latencyMs: Date.now() - startedAt,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function runAll() {
    const trimmed = prompt.trim();
    if (!trimmed || isRunning) return;
    const activeSlots = slots
      .map((model, index) => ({ model, index }))
      .filter((s) => s.model !== "");
    if (activeSlots.length === 0) return;

    setIsRunning(true);
    setRunPromptHash(hashPrompt(trimmed));
    try {
      await Promise.allSettled(activeSlots.map((s) => runSlot(s.index, s.model, trimmed)));
    } finally {
      setIsRunning(false);
    }
  }

  function voteBest(model: string) {
    if (!runPromptHash) return;
    setVotes((prev) => {
      const next = prev.filter((v) => v.promptHash !== runPromptHash);
      next.push({ promptHash: runPromptHash, model });
      writeVotes(next);
      return next;
    });
  }

  const canRun = !isRunning && prompt.trim() !== "" && slots.some((s) => s !== "");

  return (
    <div className="p-6 space-y-4 max-w-6xl mx-auto">
      {/* Prompt input */}
      <div className="space-y-2">
        <label htmlFor="compare-prompt" className="text-sm font-medium text-text-main">
          Prompt
        </label>
        <textarea
          id="compare-prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Enter a prompt to send to every selected model…"
          rows={4}
          className="w-full text-sm bg-surface border border-border rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary text-text-main resize-y"
        />
      </div>

      {/* Model slot pickers + Run */}
      <div className="flex flex-wrap items-end gap-3">
        {slots.map((slot, index) => (
          <div key={index} className="flex items-center gap-1.5">
            <div className="flex flex-col gap-1">
              <span className="text-[11px] text-text-muted">Model {index + 1}</span>
              <select
                value={slot}
                onChange={(e) => setSlotModel(index, e.target.value)}
                className="text-xs bg-surface border border-border rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary text-text-main w-56"
                aria-label={`Model slot ${index + 1}`}
              >
                <option value="">Select a model…</option>
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.id}
                  </option>
                ))}
              </select>
            </div>
            {slots.length > MIN_SLOTS && (
              <button
                onClick={() => removeSlot(index)}
                className="text-text-muted hover:text-destructive transition-colors mt-4"
                title="Remove model slot"
                aria-label={`Remove model slot ${index + 1}`}
              >
                <span className="material-symbols-outlined text-[16px]">close</span>
              </button>
            )}
          </div>
        ))}

        {slots.length < MAX_SLOTS && (
          <button
            onClick={addSlot}
            className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded border border-border text-text-muted hover:text-text-main hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
            aria-label="Add model slot"
          >
            <span className="material-symbols-outlined text-[14px]">add</span>
            Add model
          </button>
        )}

        <button
          onClick={() => void runAll()}
          disabled={!canRun}
          className="flex items-center gap-1.5 text-xs px-4 py-2 rounded bg-primary text-white hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed ml-auto"
          aria-label="Run comparison"
        >
          <span className="material-symbols-outlined text-[14px]">
            {isRunning ? "hourglass_top" : "play_arrow"}
          </span>
          {isRunning ? "Running…" : "Run"}
        </button>
      </div>

      {modelsError && (
        <p className="text-xs text-destructive">Failed to load models: {modelsError}</p>
      )}

      {/* Vote tally */}
      {voteTally.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-text-muted">
          <span className="material-symbols-outlined text-[14px]">emoji_events</span>
          {voteTally.map(([model, count]) => (
            <span key={model} className="px-2 py-0.5 rounded-full border border-border bg-surface">
              {model}: {count} {count === 1 ? "win" : "wins"}
            </span>
          ))}
        </div>
      )}

      {/* Results grid: 1 col mobile, 2 cols desktop */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {slots.map((slot, index) => {
          const result = results[index] ?? INITIAL_RESULT;
          const isBest = currentVote != null && slot !== "" && currentVote.model === slot;
          return (
            <div
              key={index}
              className={`rounded-lg border bg-surface p-4 flex flex-col gap-2 min-h-[10rem] transition-colors ${
                isBest ? "border-primary ring-1 ring-primary" : "border-border"
              }`}
            >
              {/* Card header */}
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-text-main truncate">
                  {slot || `Model ${index + 1}`}
                </span>
                <div className="flex items-center gap-2 shrink-0">
                  {result.latencyMs != null && (
                    <span className="text-[11px] text-text-muted">{result.latencyMs} ms</span>
                  )}
                  <button
                    onClick={() => voteBest(slot)}
                    disabled={slot === "" || result.status !== "done" || runPromptHash == null}
                    className={`flex items-center gap-1 text-[11px] px-2 py-1 rounded border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                      isBest
                        ? "border-primary text-primary bg-primary/10"
                        : "border-border text-text-muted hover:text-text-main hover:bg-black/5 dark:hover:bg-white/5"
                    }`}
                    title="Mark this response as best"
                    aria-label={`Mark ${slot || `model ${index + 1}`} as best`}
                  >
                    <span className="material-symbols-outlined text-[14px]">thumb_up</span>
                    Best
                  </button>
                </div>
              </div>

              {/* Token usage */}
              {(result.promptTokens != null || result.completionTokens != null) && (
                <div className="text-[11px] text-text-muted">
                  {result.promptTokens != null && <span>in: {result.promptTokens}</span>}
                  {result.promptTokens != null && result.completionTokens != null && (
                    <span> · </span>
                  )}
                  {result.completionTokens != null && <span>out: {result.completionTokens}</span>}
                </div>
              )}

              {/* Body */}
              {result.status === "idle" && (
                <p className="text-xs text-text-muted/60 flex-1">
                  {slot === "" ? "Select a model for this slot." : "Awaiting run."}
                </p>
              )}
              {result.status === "running" && (
                <p className="text-xs text-text-muted flex-1 animate-pulse">
                  Waiting for response…
                </p>
              )}
              {result.status === "error" && (
                <p className="text-xs text-destructive flex-1 break-words">
                  {result.errorMessage ?? "Request failed"}
                </p>
              )}
              {result.status === "done" && (
                <div className="text-sm text-text-main whitespace-pre-wrap break-words flex-1 overflow-auto max-h-96">
                  {result.response || <span className="text-text-muted">(empty response)</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
