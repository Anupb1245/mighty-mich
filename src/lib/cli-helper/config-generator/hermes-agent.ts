/**
 * Hermes Agent — Rich multi-role config generator & saver
 *
 * This is the implementation for the advanced "Hermes Agent" (Nous Research terminal agent).
 * It is treated completely separately from the original simple "Hermes" guide tool.
 *
 * Hermes Agent supports many independent model slots:
 *   - default (main conversation)
 *   - delegation (sub-agent orchestrator)
 *   - auxiliary.* (vision, compression, web_extract, skills_hub, approval, ...)
 *
 * The UI (HermesAgentToolCard) will offer a dropdown for EACH of these roles.
 *
 * Data Model (what the frontend sends and this module consumes):
 *
 * interface HermesAgentRoleSelection {
 *   role: 'default' | 'delegation' | 'vision' | 'compression' | 'web_extract' | 'skills_hub' | 'approval' | ...;
 *   model: string;                    // the model name the user chose from OmniRoute
 * }
 *
 * interface HermesAgentConfigPayload {
 *   baseUrl: string;                  // usually the OmniRoute base URL
 *   keyId?: string | null;            // preferred: reference to a stored key
 *   apiKey?: string | null;           // fallback plaintext key
 *   selections: HermesAgentRoleSelection[];
 * }
 */

import * as yaml from "js-yaml";
import { getHermesConfigPath, getHermesEnvPath } from "./hermesHome.ts";

export const HERMES_AGENT_ROLES = [
  { id: "default", label: "Default (main)", description: "Primary conversation model" },
  {
    id: "delegation",
    label: "Delegation (subagents)",
    description: "Orchestrator and sub-agent spawning model",
  },
  { id: "vision", label: "Vision", description: "Image and screenshot understanding" },
  { id: "web_extract", label: "Web Extract", description: "Web page / content extraction" },
  { id: "compression", label: "Compression", description: "Prompt compression and summarization" },
  { id: "skills_hub", label: "Skills Hub", description: "Skills and tool-use reasoning" },
  { id: "approval", label: "Approval", description: "Safety and approval decisions" },
  { id: "mcp", label: "MCP", description: "MCP server tool calls" },
  { id: "title_generation", label: "Title Generation", description: "Session title generation" },
  {
    id: "memory_query_rewrite",
    label: "Memory Query Rewrite",
    description: "Memory search query rewriting",
  },
  { id: "tts_audio_tags", label: "TTS Audio Tags", description: "TTS audio tag generation" },
  {
    id: "triage_specifier",
    label: "Triage Specifier",
    description: "Issue / PR triage specification",
  },
  {
    id: "kanban_decomposer",
    label: "Kanban Decomposer",
    description: "Kanban task decomposition",
  },
  { id: "profile_describer", label: "Profile Describer", description: "User profile description" },
  { id: "goal_judge", label: "Goal Judge", description: "Goal completion judging" },
  { id: "curator", label: "Curator", description: "Skill and memory curation" },
  { id: "monitor", label: "Monitor", description: "Background monitoring" },
  {
    id: "background_review",
    label: "Background Review",
    description: "Background code review",
  },
] as const;

export type HermesAgentRole = (typeof HERMES_AGENT_ROLES)[number]["id"];

export interface HermesAgentRoleSelection {
  role: HermesAgentRole;
  model: string;
}

export interface HermesAgentConfigPayload {
  baseUrl: string;
  keyId?: string | null;
  apiKey?: string | null;
  selections: HermesAgentRoleSelection[];
}

// Resolved lazily at call-time so HERMES_HOME is always honoured (#3628).
const getConfigPath = () => getHermesConfigPath();

// Placeholder written into config.yaml when the caller supplies no key. Never
// persist it to .env — Hermes would then try to authenticate with it.
const API_KEY_PLACEHOLDER = "YOUR_OMNIROUTE_API_KEY_HERE";

// Build a normalized base URL for Hermes (no trailing slash, no /v1 suffix on the provider entry)
function normalizeBaseUrl(base: string): string {
  let b = base.trim();
  while (b.endsWith("/")) b = b.slice(0, -1);
  if (b.endsWith("/v1")) b = b.slice(0, -3);
  return b;
}

function getProviderBlock(baseUrl: string, apiKey: string) {
  const normalized = normalizeBaseUrl(baseUrl);
  return {
    provider: "omniroute",
    model: "", // will be filled per-role
    base_url: `${normalized}/v1`,
    api_key: apiKey,
  };
}

/**
 * Generate the full merged YAML for Hermes Agent config.
 * This is the core of the rich implementation.
 */
export async function generateHermesAgentConfig(
  payload: HermesAgentConfigPayload
): Promise<{ yaml: string; error?: string }> {
  const { baseUrl, keyId, apiKey, selections } = payload;

  if (!baseUrl) {
    return { yaml: "", error: "baseUrl is required" };
  }

  // Resolve the actual key to use (in real impl we would look up keyId)
  const resolvedKey = apiKey || API_KEY_PLACEHOLDER;

  // Read existing config if present (non-destructive merge)
  let existing: any = {};
  try {
    const fs = await import("node:fs/promises");
    const raw = await fs.readFile(getConfigPath(), "utf-8");
    existing = yaml.load(raw) || {};
  } catch {
    // no existing file — start fresh
  }

  // Build the providers.omniroute entry (shared)
  const normalizedBase = normalizeBaseUrl(baseUrl);
  const omnirouteProvider = {
    base_url: `${normalizedBase}/v1`,
    api_key: resolvedKey,
  };

  // Start from existing or empty
  const next: any = {
    ...existing,
    providers: {
      ...(existing.providers || {}),
      omniroute: omnirouteProvider,
    },
  };

  // Apply each role selection
  for (const sel of selections) {
    const { role, model } = sel;

    if (role === "default") {
      next.model = {
        ...(existing.model || {}),
        default: model,
        provider: "omniroute",
        base_url: `${normalizedBase}/v1`,
      };
    } else if (role === "delegation") {
      next.delegation = {
        ...(existing.delegation || {}),
        model,
        provider: "omniroute",
        base_url: `${normalizedBase}/v1`,
        api_key: resolvedKey,
      };
    } else {
      // auxiliary.* roles
      if (!next.auxiliary) next.auxiliary = {};
      next.auxiliary[role] = {
        ...(existing.auxiliary?.[role] || {}),
        provider: "omniroute",
        model,
        base_url: `${normalizedBase}/v1`,
        api_key: resolvedKey,
      };
    }
  }

  const outputYaml = yaml.dump(next, { lineWidth: -1, noRefs: true });
  return { yaml: outputYaml };
}

/**
 * Read the current Hermes Agent configuration and extract the model
 * for each supported role.
 */
export async function getCurrentHermesAgentRoles(): Promise<
  Record<string, { model: string; provider?: string; base_url?: string }>
> {
  const fs = await import("node:fs/promises");
  let config: any = {};

  try {
    const raw = await fs.readFile(getConfigPath(), "utf-8");
    config = yaml.load(raw) || {};
  } catch {
    return {};
  }

  const result: Record<string, any> = {};

  // default
  if (config.model?.default) {
    result.default = {
      model: config.model.default,
      provider: config.model.provider,
      base_url: config.model.base_url,
    };
  }

  // delegation
  if (config.delegation?.model) {
    result.delegation = {
      model: config.delegation.model,
      provider: config.delegation.provider,
      base_url: config.delegation.base_url,
    };
  }

  // auxiliary roles
  if (config.auxiliary && typeof config.auxiliary === "object") {
    for (const [role, val] of Object.entries(config.auxiliary)) {
      if (val && typeof val === "object" && (val as any).model) {
        result[role] = {
          model: (val as any).model,
          provider: (val as any).provider,
          base_url: (val as any).base_url,
        };
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// .env persistence
//
// Hermes Agent resolves its inference provider from API keys in
// `<HERMES_HOME>/.env` (`OPENAI_API_KEY`, `OPENROUTER_API_KEY`, ...). The
// `providers.omniroute.api_key` entry in config.yaml alone is not enough — with
// only config.yaml written, `hermes` aborts at startup with
// "No inference provider configured ... set an API key ... in ~/.hermes/.env".
//
// OmniRoute is an OpenAI-compatible endpoint, so the key is exposed as
// `OPENAI_API_KEY` together with `OPENAI_BASE_URL` pointing at OmniRoute's /v1.
// ---------------------------------------------------------------------------

const ENV_KEY_RE = /^[A-Z_][A-Z0-9_]*$/;

function formatEnvValue(value: string): string {
  // Quote when the value could be misparsed by a dotenv reader.
  if (value === "" || /[\s#"'`$\\]/.test(value)) {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return value;
}

/**
 * Upsert `vars` into dotenv-formatted `existing` text.
 *
 * - An existing `KEY=` / `export KEY=` line is rewritten in place (its `export`
 *   prefix is kept); every other line — comments, blanks, unrelated keys — is
 *   preserved verbatim.
 * - Keys not yet present are appended at the end, in the order given.
 * - The result always ends with a single trailing newline.
 */
export function upsertHermesEnv(existing: string, vars: Record<string, string>): string {
  for (const key of Object.keys(vars)) {
    if (!ENV_KEY_RE.test(key)) throw new Error(`Invalid env var name: ${key}`);
  }

  const lines = existing.length ? existing.replace(/\r\n/g, "\n").split("\n") : [];
  // A trailing newline yields an empty last element — drop it so we don't emit a blank line.
  if (lines.length && lines[lines.length - 1] === "") lines.pop();

  const remaining = new Map(Object.entries(vars));
  const out = lines.map((line) => {
    const m = line.match(/^(\s*(?:export\s+)?)([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (!m) return line;
    const key = m[2];
    if (!remaining.has(key)) return line;
    const value = remaining.get(key) as string;
    remaining.delete(key);
    return `${m[1]}${key}=${formatEnvValue(value)}`;
  });

  for (const [key, value] of remaining) {
    out.push(`${key}=${formatEnvValue(value)}`);
  }

  return out.length ? `${out.join("\n")}\n` : "";
}

/** The env vars OmniRoute contributes to the Hermes `.env`. */
export function buildHermesAgentEnvVars(payload: {
  baseUrl: string;
  apiKey: string;
}): Record<string, string> {
  return {
    OPENAI_API_KEY: payload.apiKey,
    OPENAI_BASE_URL: `${normalizeBaseUrl(payload.baseUrl)}/v1`,
  };
}

/** Render the `.env` fragment OmniRoute would write (used for previews). */
export function generateHermesAgentEnv(payload: { baseUrl: string; apiKey: string }): string {
  return upsertHermesEnv("", buildHermesAgentEnvVars(payload));
}

function hasRealApiKey(apiKey: string | null | undefined): apiKey is string {
  const k = (apiKey || "").trim();
  return k.length > 0 && k !== API_KEY_PLACEHOLDER;
}

/**
 * Merge the OmniRoute key + base URL into `<HERMES_HOME>/.env`, creating the
 * file (owner-only, 0600) when absent and preserving any other entries.
 *
 * Returns the written path, or `null` when there is no real key to persist
 * (empty / placeholder) — in that case the file is left untouched.
 */
export async function writeHermesAgentEnv(payload: {
  baseUrl: string;
  apiKey?: string | null;
}): Promise<string | null> {
  if (!hasRealApiKey(payload.apiKey)) return null;

  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const envPath = getHermesEnvPath();

  let existing = "";
  try {
    existing = await fs.readFile(envPath, "utf-8");
  } catch {
    // no .env yet — start fresh
  }

  const next = upsertHermesEnv(
    existing,
    buildHermesAgentEnvVars({ baseUrl: payload.baseUrl, apiKey: payload.apiKey })
  );

  await fs.mkdir(path.dirname(envPath), { recursive: true });
  await fs.writeFile(envPath, next, { encoding: "utf-8", mode: 0o600 });
  // writeFile's `mode` only applies on creation; enforce it for pre-existing files too.
  if (process.platform !== "win32") {
    await fs.chmod(envPath, 0o600);
  }
  return envPath;
}
