/**
 * Hermes Agent must also persist the OmniRoute key to `<HERMES_HOME>/.env`.
 *
 * Hermes resolves its inference provider from env keys (`OPENAI_API_KEY`, ...) in
 * `~/.hermes/.env`, not from the `providers:` map in config.yaml. Writing only
 * config.yaml left users with:
 *   "agent init failed: No inference provider configured. Run 'hermes model' ...
 *    or set an API key (OPENROUTER_API_KEY, OPENAI_API_KEY, etc.) in ~/.hermes/.env."
 *
 * Hard Rule #18 — TDD: written red before the fix.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const _originalHermesHome = process.env.HERMES_HOME;
let tmpHome = "";

describe("hermes-agent .env persistence", () => {
  before(async () => {
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "hermes-env-test-"));
    process.env.HERMES_HOME = tmpHome;
  });

  after(async () => {
    if (_originalHermesHome === undefined) delete process.env.HERMES_HOME;
    else process.env.HERMES_HOME = _originalHermesHome;
    await fs.rm(tmpHome, { recursive: true, force: true });
  });

  it("getHermesEnvPath resolves to <HERMES_HOME>/.env", async () => {
    const { getHermesEnvPath } =
      await import("../../../src/lib/cli-helper/config-generator/hermesHome.ts");
    assert.strictEqual(getHermesEnvPath(), path.join(tmpHome, ".env"));
  });

  it("upsertHermesEnv adds keys to an empty file", async () => {
    const { upsertHermesEnv } =
      await import("../../../src/lib/cli-helper/config-generator/hermes-agent.ts");
    const out = upsertHermesEnv("", { OPENAI_API_KEY: "sk-omni" });
    assert.strictEqual(out, "OPENAI_API_KEY=sk-omni\n");
  });

  it("upsertHermesEnv replaces an existing key in place and preserves other lines", async () => {
    const { upsertHermesEnv } =
      await import("../../../src/lib/cli-helper/config-generator/hermes-agent.ts");
    const existing = "# my hermes env\nOPENAI_API_KEY=old\nBRAVE_API_KEY=keep-me\n";
    const out = upsertHermesEnv(existing, { OPENAI_API_KEY: "sk-new" });
    assert.strictEqual(out, "# my hermes env\nOPENAI_API_KEY=sk-new\nBRAVE_API_KEY=keep-me\n");
  });

  it("upsertHermesEnv handles `export KEY=` lines and no trailing newline", async () => {
    const { upsertHermesEnv } =
      await import("../../../src/lib/cli-helper/config-generator/hermes-agent.ts");
    const out = upsertHermesEnv("export OPENAI_API_KEY=old\nOTHER=1", {
      OPENAI_API_KEY: "sk-new",
      OPENAI_BASE_URL: "http://localhost:20128/v1",
    });
    assert.strictEqual(
      out,
      "export OPENAI_API_KEY=sk-new\nOTHER=1\nOPENAI_BASE_URL=http://localhost:20128/v1\n"
    );
  });

  it("upsertHermesEnv quotes values containing whitespace or #", async () => {
    const { upsertHermesEnv } =
      await import("../../../src/lib/cli-helper/config-generator/hermes-agent.ts");
    const out = upsertHermesEnv("", { OPENAI_API_KEY: "sk with space#x" });
    assert.strictEqual(out, 'OPENAI_API_KEY="sk with space#x"\n');
  });

  it("generateHermesAgentEnv emits OPENAI_API_KEY and OPENAI_BASE_URL for the OmniRoute endpoint", async () => {
    const { generateHermesAgentEnv } =
      await import("../../../src/lib/cli-helper/config-generator/hermes-agent.ts");
    const out = generateHermesAgentEnv({ baseUrl: "http://localhost:20128/", apiKey: "sk-omni" });
    assert.ok(out.includes("OPENAI_API_KEY=sk-omni\n"));
    assert.ok(out.includes("OPENAI_BASE_URL=http://localhost:20128/v1\n"));
  });

  it("writeHermesAgentEnv creates <HERMES_HOME>/.env with the key", async () => {
    const { writeHermesAgentEnv } =
      await import("../../../src/lib/cli-helper/config-generator/hermes-agent.ts");
    const envPath = await writeHermesAgentEnv({
      baseUrl: "http://localhost:20128",
      apiKey: "sk-omni-1",
    });
    assert.strictEqual(envPath, path.join(tmpHome, ".env"));
    const content = await fs.readFile(envPath, "utf8");
    assert.ok(content.includes("OPENAI_API_KEY=sk-omni-1\n"));
    assert.ok(content.includes("OPENAI_BASE_URL=http://localhost:20128/v1\n"));
    if (process.platform !== "win32") {
      const st = await fs.stat(envPath);
      assert.strictEqual(st.mode & 0o777, 0o600, ".env must be owner-only (holds a secret)");
    }
  });

  it("writeHermesAgentEnv merges into an existing .env without dropping other keys", async () => {
    const { writeHermesAgentEnv } =
      await import("../../../src/lib/cli-helper/config-generator/hermes-agent.ts");
    const envPath = path.join(tmpHome, ".env");
    await fs.writeFile(envPath, "BRAVE_API_KEY=brave\nOPENAI_API_KEY=stale\n", "utf8");
    await writeHermesAgentEnv({ baseUrl: "http://localhost:20128", apiKey: "sk-omni-2" });
    const content = await fs.readFile(envPath, "utf8");
    assert.ok(content.includes("BRAVE_API_KEY=brave\n"));
    assert.ok(content.includes("OPENAI_API_KEY=sk-omni-2\n"));
    assert.ok(!content.includes("stale"));
    assert.strictEqual(content.match(/^(export )?OPENAI_API_KEY=/gm)?.length, 1);
  });

  it("writeHermesAgentEnv is a no-op (returns null) without a real apiKey", async () => {
    const { writeHermesAgentEnv } =
      await import("../../../src/lib/cli-helper/config-generator/hermes-agent.ts");
    const before = await fs.readFile(path.join(tmpHome, ".env"), "utf8");
    const r1 = await writeHermesAgentEnv({ baseUrl: "http://localhost:20128", apiKey: "" });
    const r2 = await writeHermesAgentEnv({ baseUrl: "http://localhost:20128", apiKey: null });
    assert.strictEqual(r1, null);
    assert.strictEqual(r2, null);
    assert.strictEqual(await fs.readFile(path.join(tmpHome, ".env"), "utf8"), before);
  });
});
