import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readKiriConfig } from "../server/kiri-config.mjs";
import { backoffDelay, createKiriService } from "../server/kiri-service.mjs";
import { createMockClient } from "../server/kiri-mock.mjs";
import { listJobs, newJobRecord, readJob, saveNewJob } from "../server/kiri-jobs.mjs";

async function setup(
  t,
  { failMode = "", failOnce = false, latencyMs = 40, convert, stripBackdrop } = {},
) {
  const root = await mkdtemp(join(tmpdir(), "lihatdulu-service-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const config = readKiriConfig(
    {
      KIRI_MOCK: "1",
      KIRI_JOBS_ROOT: root,
      KIRI_MOCK_LATENCY_MS: String(latencyMs),
      // No automatic poller in unit tests: each test drives the stage it needs.
      KIRI_POLL_MIN_MS: "600000",
      KIRI_POLL_MAX_MS: "600000",
    },
    process.cwd(),
  );
  const client = createMockClient({ jobsRoot: root, latencyMs, failMode, failOnce });
  const service = createKiriService({
    config,
    client,
    ...(convert ? { convert } : {}),
    ...(stripBackdrop ? { stripBackdrop } : {}),
  });
  t.after(() => service.stop());
  const upload = async (name = "kursi.mp4", hash = `hash-${name}`) => {
    const temp = join(root, "tmp", `${Math.random().toString(16).slice(2)}.mp4`);
    await mkdir(join(root, "tmp"), { recursive: true });
    await writeFile(temp, Buffer.alloc(64, 1));
    return service.submit({ tempPath: temp, filename: name, bytes: 64, videoHash: hash, uploadMs: 5 });
  };
  return { root, config, service, client, upload };
}

async function waitForStage(root, id, stage, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = await readJob(root, id);
    if (job?.stage === stage) return job;
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
  return readJob(root, id);
}

test("backoff doubles up to the configured ceiling", () => {
  const poll = { minMs: 100, maxMs: 1000 };
  assert.equal(backoffDelay(0, poll), 100);
  assert.equal(backoffDelay(1, poll), 200);
  assert.equal(backoffDelay(2, poll), 400);
  assert.equal(backoffDelay(3, poll), 800);
  assert.equal(backoffDelay(4, poll), 1000);
  assert.equal(backoffDelay(99, poll), 1000);
});

test("submitting the same bytes twice reuses one job", async (t) => {
  const { root, upload } = await setup(t);
  const [first, second] = await Promise.all([upload(), upload()]);
  assert.equal(first.job.id, second.job.id);
  // Either call can win the lock, but exactly one must create the job.
  assert.deepEqual(
    [first.deduplicated, second.deduplicated].sort(),
    [false, true],
  );
  assert.equal((await listJobs(root)).length, 1);
});

test("an accepted submit stores the KIRI serial and queues polling", async (t) => {
  const { root, upload } = await setup(t);
  const { job } = await upload();
  const stored = await readJob(root, job.id);
  assert.equal(stored.stage, "queued");
  assert.match(stored.kiri.serial, /^mock-/);
  assert.equal(stored.attempts.submit, 1);
  assert.ok(stored.timings.submitMs >= 0);
});

test("a failed submit is stored without a serial and cannot be retried server-side", async (t) => {
  const { root, upload, service } = await setup(t, { failMode: "submit" });
  const { job } = await upload();
  const stored = await readJob(root, job.id);
  assert.equal(stored.stage, "failed");
  assert.equal(stored.error.code, "kiri_unavailable");
  assert.equal(stored.error.retryable, false);
  assert.equal(stored.kiri.serial, null);
  await assert.rejects(() => service.retry(job.id), (error) => error.code === "conflict");
});

test("a download failure is retryable and retry finishes without a new upload", async (t) => {
  const { root, service, upload } = await setup(t, { failMode: "zip", failOnce: true });
  const { job } = await upload();
  const submitted = await readJob(root, job.id);
  await service.finalize(submitted);
  const failed = await readJob(root, job.id);
  assert.equal(failed.stage, "failed");
  assert.equal(failed.error.code, "zip_invalid");
  assert.equal(failed.error.retryable, true);

  await service.retry(job.id);
  const ready = await waitForStage(root, job.id, "ready");
  assert.equal(ready.stage, "ready");
  assert.ok(ready.artifact.splatCount > 0);
  assert.equal(ready.attempts.finalize, 2);
});

test("a conversion failure is reported as retryable", async (t) => {
  const { KiriError } = await import("../server/kiri-errors.mjs");
  const { root, service, upload } = await setup(t, {
    convert: async () => {
      throw new KiriError("convert_failed", { detail: "stub" });
    },
  });
  const { job } = await upload();
  await service.finalize(await readJob(root, job.id));
  const failed = await readJob(root, job.id);
  assert.equal(failed.stage, "failed");
  assert.equal(failed.error.code, "convert_failed");
  assert.equal(failed.error.retryable, true);
});

test("an expired KIRI job is marked expired, not retryable", async (t) => {
  const { root, service, upload } = await setup(t, { latencyMs: 5_000 });
  const { job } = await upload();
  const client = {
    getStatus: async () => ({ status: 4, state: "expired" }),
  };
  const expiring = createKiriService({
    config: readKiriConfig(
      { KIRI_MOCK: "1", KIRI_JOBS_ROOT: root, KIRI_POLL_MIN_MS: "600000" },
      process.cwd(),
    ),
    client,
  });
  t.after(() => expiring.stop());
  await expiring.tick(job.id);
  const stored = await readJob(root, job.id);
  assert.equal(stored.stage, "expired");
  assert.equal(stored.error.code, "kiri_expired");
  assert.equal(stored.error.retryable, false);
  assert.ok(service);
});

test("resume marks a job interrupted mid-submit instead of polling forever", async (t) => {
  const { root, service } = await setup(t);
  const record = newJobRecord({
    videoHash: "interrupted",
    filename: "kursi.mp4",
    bytes: 64,
    provider: "mock",
  });
  record.stage = "submitting";
  await saveNewJob(root, record);
  await service.resume();
  const stored = await readJob(root, record.id);
  assert.equal(stored.stage, "failed");
  assert.equal(stored.error.code, "submit_interrupted");
});

test("a ready job keeps only its record and the SPZ", async (t) => {
  const { root, service, upload } = await setup(t);
  const { job } = await upload();
  await service.finalize(await readJob(root, job.id));
  const ready = await readJob(root, job.id);
  assert.equal(ready.stage, "ready");
  assert.equal(ready.cleanup, null);
  const files = (await readdir(join(root, "jobs", job.id))).sort();
  assert.deepEqual(files, ["job.json", "mock.json", "result.spz"]);
  assert.ok(ready.artifact.bytes > 0);
});

test("a stripped backdrop is recorded on the job", async (t) => {
  const { root, service, upload } = await setup(t, {
    stripBackdrop: (buffer) => ({ buffer, removed: 50_000, reason: "kiri-backdrop" }),
  });
  const { job } = await upload();
  await service.finalize(await readJob(root, job.id));
  const ready = await readJob(root, job.id);
  assert.equal(ready.stage, "ready");
  assert.deepEqual(ready.cleanup, { reason: "kiri-backdrop", splatsRemoved: 50_000 });
  const files = (await readdir(join(root, "jobs", job.id))).sort();
  assert.deepEqual(files, ["job.json", "mock.json", "result.spz"]);
});
