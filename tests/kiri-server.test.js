import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readKiriConfig } from "../server/kiri-config.mjs";
import { createMockClient } from "../server/kiri-mock.mjs";
import { createKiriService } from "../server/kiri-service.mjs";
import { createKiriServer } from "../server/kiri-server.mjs";
import { listJobs } from "../server/kiri-jobs.mjs";

// End-to-end at the HTTP boundary with the mock adapter: a real upload, a real
// ZIP, a real PLY validation, a real splat-transform conversion and a real SPZ
// response. Only the KIRI network calls are simulated.

function mp4(size = 512) {
  return Buffer.concat([
    Buffer.from([0, 0, 0, 0x18]),
    Buffer.from("ftypisom", "latin1"),
    Buffer.alloc(size, 3),
  ]);
}

async function start(t, overrides = {}) {
  const root = await mkdtemp(join(tmpdir(), "lihatdulu-server-"));
  await mkdir(join(root, "jobs"), { recursive: true });
  t.after(() => rm(root, { recursive: true, force: true }));
  const config = readKiriConfig(
    {
      KIRI_MOCK: "1",
      KIRI_JOBS_ROOT: root,
      KIRI_MOCK_LATENCY_MS: "80",
      KIRI_POLL_MIN_MS: "20",
      KIRI_POLL_MAX_MS: "60",
      KIRI_SERVE_DIST: "0",
      ...overrides.env,
    },
    process.cwd(),
  );
  const logs = [];
  const log = (entry) => logs.push(entry);
  const client = createMockClient({
    jobsRoot: root,
    latencyMs: config.mockLatencyMs,
    failMode: config.mockFail,
    failOnce: config.mockFailOnce,
  });
  const service = createKiriService({
    config,
    client,
    log,
    ...(overrides.frames ? { frames: overrides.frames } : {}),
  });
  const server = createKiriServer({ config, service, log });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  t.after(
    () =>
      new Promise((done) => {
        service.stop();
        server.close(done);
      }),
  );
  const base = `http://127.0.0.1:${server.address().port}`;
  return { root, config, service, server, base, logs };
}

async function upload(base, body, { name = "kursi.mp4", type = "video/mp4" } = {}) {
  const response = await fetch(`${base}/api/kiri/jobs`, {
    method: "POST",
    headers: { "content-type": type, "x-file-name": encodeURIComponent(name) },
    body,
  });
  return { status: response.status, body: await response.json() };
}

async function getJob(base, id) {
  const response = await fetch(`${base}/api/kiri/jobs/${id}`);
  return { status: response.status, body: await response.json() };
}

async function waitForStage(base, id, stages, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const { body } = await getJob(base, id);
    last = body;
    if (stages.includes(body.stage)) return body;
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  return last;
}

test("config endpoint reports the mode without the key", async (t) => {
  const { base, root } = await start(t);
  const response = await fetch(`${base}/api/kiri/config`);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.mode, "mock");
  assert.equal(body.mock, true);
  assert.equal(body.provider, "KIRI Engine");
  const text = JSON.stringify(body);
  assert.ok(!text.includes(root));
  assert.ok(!("apiKey" in body));
});

test("a non-MP4 upload is refused before anything is submitted", async (t) => {
  const { base, root } = await start(t);
  const result = await upload(base, Buffer.from("not a video"));
  assert.equal(result.status, 415);
  assert.equal(result.body.error.code, "video_not_mp4");
  assert.equal((await listJobs(root)).length, 0);
});

test("an empty upload is refused", async (t) => {
  const { base } = await start(t);
  const result = await upload(base, Buffer.alloc(0));
  assert.equal(result.status, 400);
  assert.equal(result.body.error.code, "upload_empty");
});

test("the full mock flow reaches ready and serves a real SPZ", async (t) => {
  const { base, root } = await start(t);
  const created = await upload(base, mp4());
  assert.equal(created.status, 201);
  assert.equal(created.body.mock, true);
  assert.equal(created.body.deduplicated, false);
  assert.ok(["uploading", "submitting", "queued"].includes(created.body.stage));
  assert.equal(created.body.artifact, null);

  const ready = await waitForStage(base, created.body.id, ["ready", "failed"]);
  assert.equal(ready.stage, "ready");
  assert.equal(ready.artifact.format, "spz");
  assert.equal(ready.artifact.splatCount, 21600);
  assert.ok(ready.artifact.bytes > 1000);
  assert.match(ready.artifact.url, /^\/api\/kiri\/jobs\/[0-9a-f-]+\/result\.spz$/);

  const artifact = await fetch(`${base}${ready.artifact.url}`);
  assert.equal(artifact.status, 200);
  assert.equal(artifact.headers.get("content-type"), "application/octet-stream");
  assert.equal(artifact.headers.get("cache-control"), "private, max-age=31536000, immutable");
  const bytes = Buffer.from(await artifact.arrayBuffer());
  assert.equal(bytes.toString("latin1", 0, 4), "NGSP");
  assert.equal(bytes.length, ready.artifact.bytes);

  const head = await fetch(`${base}${ready.artifact.url}`, { method: "HEAD" });
  assert.equal(head.status, 200);

  // Reload: the same job id returns the same finished record, no new upload.
  const reloaded = await getJob(base, created.body.id);
  assert.equal(reloaded.body.stage, "ready");
  assert.equal(reloaded.body.artifact.splatCount, 21600);
  assert.equal((await listJobs(root)).length, 1);
});

test("uploading the same bytes again deduplicates instead of submitting twice", async (t) => {
  const { base, root } = await start(t);
  const first = await upload(base, mp4());
  const second = await upload(base, mp4());
  assert.equal(second.status, 200);
  assert.equal(second.body.deduplicated, true);
  assert.equal(second.body.id, first.body.id);
  assert.equal((await listJobs(root)).length, 1);
  const ready = await waitForStage(base, first.body.id, ["ready", "failed"]);
  assert.equal(ready.stage, "ready");
});

test("retry on a finished job is a conflict, not a second submission", async (t) => {
  const { base } = await start(t);
  const created = await upload(base, mp4());
  await waitForStage(base, created.body.id, ["ready", "failed"]);
  const retry = await fetch(`${base}/api/kiri/jobs/${created.body.id}/retry`, {
    method: "POST",
  });
  assert.equal(retry.status, 409);
  const body = await retry.json();
  assert.equal(body.error.code, "conflict");
});

test("unknown and malformed job ids answer 404", async (t) => {
  const { base } = await start(t);
  for (const id of ["00000000-0000-4000-8000-000000000000", "not-a-uuid"]) {
    const response = await fetch(`${base}/api/kiri/jobs/${id}`);
    assert.equal(response.status, 404);
    const body = await response.json();
    assert.equal(body.error.code, "not_found");
  }
  const artifact = await fetch(`${base}/api/kiri/jobs/not-a-uuid/result.spz`);
  assert.equal(artifact.status, 404);
});

test("the result route 404s before the artifact exists", async (t) => {
  const { base } = await start(t, { env: { KIRI_MOCK_LATENCY_MS: "60000" } });
  const created = await upload(base, mp4());
  const response = await fetch(`${base}/api/kiri/jobs/${created.body.id}/result.spz`);
  assert.equal(response.status, 404);
});

test("unsupported methods are rejected with an allow header", async (t) => {
  const { base } = await start(t);
  const response = await fetch(`${base}/api/kiri/jobs`, { method: "DELETE" });
  assert.equal(response.status, 405);
  assert.match(response.headers.get("allow"), /POST/);
});

test("an unconfigured server answers 503 and never reads the video", async (t) => {
  const { base } = await start(t, { env: { KIRI_MOCK: "0", KIRI_API_KEY: "" } });
  const response = await fetch(`${base}/api/kiri/jobs`, {
    method: "POST",
    headers: { "content-type": "video/mp4", "x-file-name": "kursi.mp4" },
    body: mp4(),
  });
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.error.code, "missing_key");
});

test("the configured key never appears in responses, logs or job records", async (t) => {
  const secret = "kiri-live-secret-value";
  const { base, root, logs } = await start(t, {
    env: { KIRI_API_KEY: secret },
  });
  const created = await upload(base, mp4());
  const ready = await waitForStage(base, created.body.id, ["ready", "failed"]);
  assert.equal(ready.stage, "ready");
  const jobFile = await readFile(
    join(root, "jobs", created.body.id, "job.json"),
    "utf8",
  );
  const responseText = JSON.stringify(
    await (await fetch(`${base}/api/kiri/jobs/${created.body.id}`)).json(),
  );
  const logText = JSON.stringify(logs);
  assert.ok(!jobFile.includes(secret));
  assert.ok(!responseText.includes(secret));
  assert.ok(!logText.includes(secret));
});

test("a mesh job serves its GLB at result.glb and never at result.spz", async (t) => {
  // A real clip is needed for stills; the HTTP layer is what this test checks,
  // so the frame list is fixed and the mock only reads the count.
  const frames = {
    async extract({ directory }) {
      return Array.from({ length: 24 }, (_, index) => ({
        path: join(directory, `frame-${index}.jpg`),
        filename: `frame-${index}.jpg`,
      }));
    },
  };
  const { base, root } = await start(t, {
    env: { KIRI_INPUT: "mesh" },
    frames,
  });
  const created = await upload(base, mp4());
  const ready = await waitForStage(base, created.body.id, ["ready", "failed"]);
  assert.equal(ready.stage, "ready");
  assert.equal(ready.artifact.format, "glb");
  assert.match(ready.artifact.url, /result\.glb$/);
  assert.equal(ready.artifact.triangles, 72);
  assert.equal(ready.artifact.splatCount, null);

  const artifact = await fetch(`${base}${ready.artifact.url}`);
  assert.equal(artifact.status, 200);
  assert.equal(artifact.headers.get("content-type"), "model/gltf-binary");
  const bytes = Buffer.from(await artifact.arrayBuffer());
  assert.equal(bytes.toString("latin1", 0, 4), "glTF");
  assert.equal(bytes.readUInt32LE(4), 2);
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  assert.equal(bytes.length, ready.artifact.bytes);

  // The stale splat link must not stream mesh bytes under the SPZ type.
  const wrong = await fetch(`${base}/api/kiri/jobs/${created.body.id}/result.spz`);
  assert.equal(wrong.status, 404);

  const head = await fetch(`${base}${ready.artifact.url}`, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("content-length"), String(bytes.length));
  assert.equal((await listJobs(root)).length, 1);
});
