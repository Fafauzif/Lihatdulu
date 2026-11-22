import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULTS,
  loadDotEnv,
  parseDotEnv,
  publicConfig,
  readKiriConfig,
} from "../server/kiri-config.mjs";

test("parseDotEnv reads plain, quoted and exported values", () => {
  const values = parseDotEnv(
    [
      "# comment",
      "KIRI_API_KEY=abc123",
      'KIRI_API_BASE="https://example.test/api/"',
      "export KIRI_MOCK=1",
      "KIRI_JOBS_ROOT=var/kiri # local jobs",
      "",
    ].join("\n"),
  );
  assert.equal(values.KIRI_API_KEY, "abc123");
  assert.equal(values.KIRI_API_BASE, "https://example.test/api/");
  assert.equal(values.KIRI_MOCK, "1");
  assert.equal(values.KIRI_JOBS_ROOT, "var/kiri");
});

test("loadDotEnv never overwrites an existing variable", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "lihatdulu-env-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, ".env");
  await writeFile(file, "KIRI_API_KEY=from-file\nKIRI_MOCK=1\n", "utf8");
  const env = { KIRI_API_KEY: "from-shell" };
  loadDotEnv(file, env);
  assert.equal(env.KIRI_API_KEY, "from-shell");
  assert.equal(env.KIRI_MOCK, "1");
});

test("readKiriConfig requires either a key or an explicit mock flag", () => {
  const unconfigured = readKiriConfig({}, "C:/work");
  assert.equal(unconfigured.mode, "unconfigured");
  assert.equal(unconfigured.apiKey, "");

  const live = readKiriConfig({ KIRI_API_KEY: "secret-key" }, "C:/work");
  assert.equal(live.mode, "live");

  const mock = readKiriConfig(
    { KIRI_API_KEY: "secret-key", KIRI_MOCK: "1" },
    "C:/work",
  );
  assert.equal(mock.mode, "mock");
});

test("readKiriConfig applies limits and poll backoff overrides", () => {
  const config = readKiriConfig(
    {
      KIRI_MOCK: "1",
      KIRI_MAX_UPLOAD_BYTES: "1234",
      KIRI_POLL_MIN_MS: "50",
      KIRI_POLL_MAX_MS: "400",
      KIRI_JOB_TTL_MS: "60000",
    },
    "C:/work",
  );
  assert.equal(config.limits.maxUploadBytes, 1234);
  assert.equal(config.poll.minMs, 50);
  assert.equal(config.poll.maxMs, 400);
  assert.equal(config.jobTtlMs, 60000);
  assert.equal(config.limits.maxDurationS, 180);
  assert.equal(config.limits.maxWidth, 1920);
});

test("the upload has its own, much longer timeout than control calls", () => {
  assert.equal(DEFAULTS.uploadTimeoutMs, 15 * 60 * 1000);
  const defaults = readKiriConfig({ KIRI_API_KEY: "k" }, "C:/work");
  assert.equal(defaults.uploadTimeoutMs, DEFAULTS.uploadTimeoutMs);
  assert.ok(
    defaults.uploadTimeoutMs > defaults.requestTimeoutMs * 5,
    "a phone clip must not share the two-minute control timeout",
  );
  const custom = readKiriConfig(
    { KIRI_API_KEY: "k", KIRI_UPLOAD_TIMEOUT_MS: "900000" },
    "C:/work",
  );
  assert.equal(custom.uploadTimeoutMs, 900000);
});

test("publicConfig exposes the mode but never the key or local paths", () => {
  const config = readKiriConfig(
    { KIRI_API_KEY: "super-secret", KIRI_JOBS_ROOT: "C:/private/jobs" },
    "C:/work",
  );
  const published = publicConfig(config);
  const text = JSON.stringify(published);
  assert.equal(published.mode, "live");
  assert.equal(published.provider, "KIRI Engine");
  assert.equal(published.mock, false);
  assert.ok(!text.includes("super-secret"));
  assert.ok(!text.includes("C:/private"));
  assert.equal(published.limits.maxUploadBytes, DEFAULTS.maxUploadBytes);
});
