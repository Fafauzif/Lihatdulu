import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

// KIRI_API_KEY is the only secret. It is read once from the environment (or a
// local .env) and never returned by an endpoint, written to a job record or
// included in an error message.

const TRUTHY = new Set(["1", "true", "yes", "on"]);
const FALSY = new Set(["0", "false", "no", "off", ""]);

export const DEFAULTS = Object.freeze({
  baseUrl: "https://api.kiriengine.app/api",
  jobsRoot: "var/kiri",
  maxUploadBytes: 200 * 1024 * 1024,
  maxZipBytes: 300 * 1024 * 1024,
  maxPlyBytes: 400 * 1024 * 1024,
  maxArtifactBytes: 60 * 1024 * 1024,
  maxSplats: 2_500_000,
  pollMinMs: 5_000,
  pollMaxMs: 30_000,
  jobTtlMs: 3 * 24 * 60 * 60 * 1000,
  keepJobs: 50,
  mockLatencyMs: 3_000,
  convertTimeoutMs: 10 * 60 * 1000,
  requestTimeoutMs: 2 * 60 * 1000,
  downloadTimeoutMs: 20 * 60 * 1000,
  port: 8787,
  host: "127.0.0.1",
});

function flag(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  const text = String(value).trim().toLowerCase();
  if (TRUTHY.has(text)) return true;
  if (FALSY.has(text)) return false;
  return fallback;
}

function positive(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function cleanBaseUrl(value) {
  return String(value || DEFAULTS.baseUrl).replace(/\/+$/, "");
}

// Minimal .env parser: KEY=value, optional quotes, # comments. It never
// overwrites a variable that is already set, so `KIRI_MOCK=1 npm run ...`
// still wins over the file.
export function parseDotEnv(text) {
  const result = {};
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(
      line,
    );
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    )
      value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, "");
    result[match[1]] = value;
  }
  return result;
}

export function loadDotEnv(file, env = process.env) {
  if (!existsSync(file)) return {};
  const values = parseDotEnv(readFileSync(file, "utf8"));
  for (const [key, value] of Object.entries(values))
    if (env[key] === undefined) env[key] = value;
  return values;
}

export function readKiriConfig(env = process.env, cwd = process.cwd()) {
  const apiKey = String(env.KIRI_API_KEY || "").trim();
  const mock = flag(env.KIRI_MOCK, false);
  const mode = mock ? "mock" : apiKey ? "live" : "unconfigured";
  return {
    mode,
    mock,
    apiKey,
    baseUrl: cleanBaseUrl(env.KIRI_API_BASE),
    jobsRoot: resolve(cwd, env.KIRI_JOBS_ROOT || DEFAULTS.jobsRoot),
    limits: {
      maxUploadBytes: positive(env.KIRI_MAX_UPLOAD_BYTES, DEFAULTS.maxUploadBytes),
      maxZipBytes: positive(env.KIRI_MAX_ZIP_BYTES, DEFAULTS.maxZipBytes),
      maxPlyBytes: positive(env.KIRI_MAX_PLY_BYTES, DEFAULTS.maxPlyBytes),
      maxArtifactBytes: positive(
        env.KIRI_MAX_ARTIFACT_BYTES,
        DEFAULTS.maxArtifactBytes,
      ),
      maxSplats: positive(env.KIRI_MAX_SPLATS, DEFAULTS.maxSplats),
      maxDurationS: 180,
      maxWidth: 1920,
      maxHeight: 1080,
    },
    poll: {
      minMs: positive(env.KIRI_POLL_MIN_MS, DEFAULTS.pollMinMs),
      maxMs: positive(env.KIRI_POLL_MAX_MS, DEFAULTS.pollMaxMs),
    },
    jobTtlMs: positive(env.KIRI_JOB_TTL_MS, DEFAULTS.jobTtlMs),
    keepJobs: positive(env.KIRI_KEEP_JOBS, DEFAULTS.keepJobs),
    convertTimeoutMs: positive(
      env.KIRI_CONVERT_TIMEOUT_MS,
      DEFAULTS.convertTimeoutMs,
    ),
    requestTimeoutMs: positive(
      env.KIRI_REQUEST_TIMEOUT_MS,
      DEFAULTS.requestTimeoutMs,
    ),
    downloadTimeoutMs: positive(
      env.KIRI_DOWNLOAD_TIMEOUT_MS,
      DEFAULTS.downloadTimeoutMs,
    ),
    port: positive(env.KIRI_PORT, DEFAULTS.port),
    host: env.KIRI_HOST || DEFAULTS.host,
    serveDist: flag(env.KIRI_SERVE_DIST, true),
    distDir: resolve(cwd, env.KIRI_DIST_DIR || "dist"),
    mockLatencyMs: positive(env.KIRI_MOCK_LATENCY_MS, DEFAULTS.mockLatencyMs),
    mockFail: String(env.KIRI_MOCK_FAIL || "").trim(),
    mockFailOnce: flag(env.KIRI_MOCK_FAIL_ONCE, false),
  };
}

// Safe to print and to serve to the browser: no key, no absolute paths.
export function publicConfig(config) {
  return {
    mode: config.mode,
    provider: "KIRI Engine",
    mock: config.mode === "mock",
    limits: {
      maxUploadBytes: config.limits.maxUploadBytes,
      maxDurationS: config.limits.maxDurationS,
      maxWidth: config.limits.maxWidth,
      maxHeight: config.limits.maxHeight,
    },
    poll: { ...config.poll },
  };
}

export function defaultEnvFile(cwd = process.cwd()) {
  return join(cwd, ".env");
}
