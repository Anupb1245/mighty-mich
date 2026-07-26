import { test } from "node:test";
import assert from "node:assert";
import { validateSecrets } from "../../src/shared/utils/secretsValidator";

const BASE_ENV = {
  API_KEY_SECRET: "a".repeat(32),
  JWT_SECRET: "b".repeat(48),
} as NodeJS.ProcessEnv;

test("missing STORAGE_ENCRYPTION_KEY fails validation (fail-closed)", () => {
  const result = validateSecrets({ ...BASE_ENV });
  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.some((e) => e.name === "STORAGE_ENCRYPTION_KEY"));
});

test("ALLOW_PLAINTEXT_STORAGE=1 downgrades missing key to a warning", () => {
  const result = validateSecrets({ ...BASE_ENV, ALLOW_PLAINTEXT_STORAGE: "1" });
  assert.strictEqual(result.valid, true);
  assert.ok(result.warnings.some((w) => w.name === "STORAGE_ENCRYPTION_KEY"));
});

test("configured STORAGE_ENCRYPTION_KEY passes with no encryption warning", () => {
  const result = validateSecrets({
    ...BASE_ENV,
    STORAGE_ENCRYPTION_KEY: "c".repeat(44),
  });
  assert.strictEqual(result.valid, true);
  assert.ok(!result.warnings.some((w) => w.name === "STORAGE_ENCRYPTION_KEY"));
});

test("short STORAGE_ENCRYPTION_KEY is rejected", () => {
  const result = validateSecrets({ ...BASE_ENV, STORAGE_ENCRYPTION_KEY: "short" });
  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.some((e) => e.name === "STORAGE_ENCRYPTION_KEY"));
});
