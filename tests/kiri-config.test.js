import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULTS,
  artifactKind,
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

test("KIRI_INPUT selects the stills profiles and unknown values fall back to Photo Scan", () => {
  const base = { KIRI_API_KEY: "kiri-test-key" };
  // The shipped default is the route that isolated the chair: Photo Scan.
  assert.equal(readKiriConfig(base, process.cwd()).input.mode, "photo");
  assert.equal(
    readKiriConfig({ ...base, KIRI_INPUT: "video" }, process.cwd()).input.mode,
    "video",
  );
  for (const mode of ["splat", "photo", "mesh"]) {
    assert.equal(
      readKiriConfig({ ...base, KIRI_INPUT: mode }, process.cwd()).input.mode,
      mode,
    );
  }
  // A typo must behave exactly like no setting at all, never like a third
  // profile the operator did not ask for.
  assert.equal(
    readKiriConfig({ ...base, KIRI_INPUT: "glb" }, process.cwd()).input.mode,
    "photo",
  );
  assert.equal(
    readKiriConfig({ ...base, KIRI_INPUT: "mesh" }, process.cwd()).input.fileFormat,
    "GLB",
  );
});

test("the artifact kind follows the route, not the quality settings", () => {
  const base = { KIRI_API_KEY: "kiri-test-key" };
  const configured = (mode) =>
    readKiriConfig({ ...base, KIRI_INPUT: mode }, process.cwd());
  assert.equal(artifactKind(configured("video").input.mode), "splat");
  assert.equal(artifactKind(configured("splat").input.mode), "splat");
  // Photo Scan answers with a mesh, so the viewer must not wait for an SPZ.
  assert.equal(artifactKind(configured("photo").input.mode), "mesh");
  assert.equal(artifactKind(configured("mesh").input.mode), "mesh");
  assert.equal(publicConfig(configured("photo")).artifactKind, "mesh");
  assert.equal(publicConfig(configured("video")).artifactKind, "splat");
});

test("Photo Scan quality knobs default to KIRI's documented values", () => {
  const base = { KIRI_API_KEY: "kiri-test-key" };
  const input = (env = {}) => readKiriConfig({ ...base, ...env }, process.cwd()).input;
  const defaults = input();
  // 3 is Ultra, the model that produced the best chair; 0 is a 4K texture.
  assert.equal(defaults.modelQuality, 3);
  assert.equal(defaults.textureQuality, 0);
  // The docs recommend texture smoothing off for precise professional scans.
  assert.equal(defaults.textureSmoothing, 0);

  const ultra = input({
    KIRI_MODEL_QUALITY: "3",
    KIRI_TEXTURE_QUALITY: "3",
    KIRI_TEXTURE_SMOOTHING: "1",
  });
  assert.equal(ultra.modelQuality, 3);
  assert.equal(ultra.textureQuality, 3);
  assert.equal(ultra.textureSmoothing, 1);

  // Out-of-range and non-integer values fall back instead of reaching KIRI.
  assert.equal(input({ KIRI_MODEL_QUALITY: "9" }).modelQuality, 3);
  assert.equal(input({ KIRI_MODEL_QUALITY: "-1" }).modelQuality, 3);
  assert.equal(input({ KIRI_TEXTURE_QUALITY: "2.5" }).textureQuality, 0);
  assert.equal(input({ KIRI_TEXTURE_QUALITY: "8k" }).textureQuality, 0);
});

test("the mesh artifact has its own size ceiling", () => {
  const config = readKiriConfig(
    { KIRI_API_KEY: "k", KIRI_MAX_MODEL_BYTES: "123456" },
    process.cwd(),
  );
  assert.equal(config.limits.maxModelBytes, 123456);
  // The SPZ ceiling is untouched by the mesh knob.
  assert.equal(config.limits.maxArtifactBytes, DEFAULTS.maxArtifactBytes);
  assert.equal(publicConfig(config).inputMode, "photo");
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

test("object masking is on by default and switchable from the environment", () => {
  const defaults = readKiriConfig({ KIRI_API_KEY: "k" }, "C:/work");
  assert.equal(defaults.isMask, 1);
  const off = readKiriConfig({ KIRI_API_KEY: "k", KIRI_ISMASK: "0" }, "C:/work");
  assert.equal(off.isMask, 0);
  const noise = readKiriConfig({ KIRI_API_KEY: "k", KIRI_ISMASK: "nope" }, "C:/work");
  assert.equal(noise.isMask, 1);
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
