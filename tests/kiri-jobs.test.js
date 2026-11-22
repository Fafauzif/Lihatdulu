import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  artifactUrl,
  findReusableByHash,
  isJobId,
  isTerminal,
  listJobs,
  newJobRecord,
  pruneJobs,
  readJob,
  saveNewJob,
  toJobDto,
  updateJob,
} from "../server/kiri-jobs.mjs";

async function tempRoot(t) {
  const dir = await mkdtemp(join(tmpdir(), "lihatdulu-jobs-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test("job ids are uuid v4 and reject path-like input", () => {
  const job = newJobRecord({ videoHash: "h", filename: "a.mp4", bytes: 1, provider: "mock" });
  assert.ok(isJobId(job.id));
  assert.equal(isJobId("../../etc"), false);
  assert.equal(isJobId(job.id.toUpperCase()), false);
});

test("a job record persists, reads back and merges updates atomically", async (t) => {
  const root = await tempRoot(t);
  const job = newJobRecord({ videoHash: "hash-1", filename: "kursi.mp4", bytes: 10, provider: "mock" });
  await saveNewJob(root, job);
  const loaded = await readJob(root, job.id);
  assert.equal(loaded.stage, "uploading");
  const updated = await updateJob(root, job.id, {
    stage: "ready",
    artifact: { format: "spz", file: "result.spz", bytes: 20, splatCount: 3 },
  });
  assert.equal(updated.stage, "ready");
  assert.equal(updated.videoHash, "hash-1");
  const text = await readFile(join(root, "jobs", job.id, "job.json"), "utf8");
  assert.match(text, /"stage": "ready"/);
  assert.equal(await readJob(root, "00000000-0000-4000-8000-000000000000"), null);
});

test("concurrent reads never see a partial record while writes land", async (t) => {
  const root = await tempRoot(t);
  const job = newJobRecord({ videoHash: "hash-race", filename: "kursi.mp4", bytes: 10, provider: "mock" });
  await saveNewJob(root, job);
  const reads = [];
  const writes = [];
  for (let index = 0; index < 40; index += 1) {
    writes.push(updateJob(root, job.id, { stage: index % 2 ? "processing" : "queued" }));
    reads.push(readJob(root, job.id));
  }
  const observed = await Promise.all(reads);
  await Promise.all(writes);
  for (const record of observed) {
    assert.ok(record, "a reader saw a missing job.json");
    assert.equal(record.id, job.id);
  }
  const final = await readJob(root, job.id);
  assert.equal(final.id, job.id);
});

test("dedupe ignores failed and expired jobs", async (t) => {
  const root = await tempRoot(t);
  const first = newJobRecord({ videoHash: "same", filename: "a.mp4", bytes: 1, provider: "mock" });
  await saveNewJob(root, first);
  assert.equal((await findReusableByHash(root, "same")).id, first.id);
  await updateJob(root, first.id, { stage: "failed" });
  assert.equal(await findReusableByHash(root, "same"), null);
  await updateJob(root, first.id, { stage: "expired" });
  assert.equal(await findReusableByHash(root, "same"), null);
});

test("pruning keeps active jobs and the newest finished ones", async (t) => {
  const root = await tempRoot(t);
  const made = [];
  for (let index = 0; index < 4; index += 1) {
    const job = newJobRecord({ videoHash: `h${index}`, filename: "a.mp4", bytes: 1, provider: "mock" });
    job.createdAt = new Date(2026, 0, index + 1).toISOString();
    await saveNewJob(root, job);
    await updateJob(root, job.id, { stage: index === 3 ? "processing" : "ready" });
    made.push(job);
  }
  const removed = await pruneJobs(root, 1);
  assert.equal(removed, 2);
  const left = await listJobs(root);
  assert.equal(left.length, 2);
  assert.ok(left.some((job) => job.stage === "processing"));
});

test("a mesh job's DTO points at result.glb and reports triangles", async (t) => {
  const root = await tempRoot(t);
  const job = newJobRecord({ videoHash: "mesh-hash", filename: "kursi.mp4", bytes: 10, provider: "mock" });
  await saveNewJob(root, job);
  await updateJob(root, job.id, {
    stage: "ready",
    input: { mode: "mesh", photos: 101, fileFormat: "GLB" },
    artifact: { format: "glb", file: "result.glb", bytes: 4096, triangles: 72 },
  });
  const dto = toJobDto(await readJob(root, job.id), { mock: true });
  assert.equal(dto.artifact.format, "glb");
  assert.equal(dto.artifact.url, artifactUrl(job.id, "glb"));
  assert.match(dto.artifact.url, /result\.glb$/);
  assert.equal(dto.artifact.triangles, 72);
  assert.equal(dto.artifact.splatCount, null);
  assert.equal(dto.input.mode, "mesh");
});

test("the DTO exposes the artifact URL but no hash or local path", async (t) => {
  const root = await tempRoot(t);
  const job = newJobRecord({ videoHash: "secret-hash", filename: "kursi.mp4", bytes: 10, provider: "mock" });
  await saveNewJob(root, job);
  await updateJob(root, job.id, {
    stage: "ready",
    kiri: { serial: "serial-123", status: 2 },
    completedAt: new Date().toISOString(),
    artifact: { format: "spz", file: "result.spz", bytes: 99, splatCount: 7 },
  });
  const dto = toJobDto(await readJob(root, job.id), { mock: true, ttlMs: 1000 });
  const text = JSON.stringify(dto);
  assert.equal(dto.artifact.url, artifactUrl(job.id));
  assert.equal(dto.mock, true);
  assert.equal(dto.artifact.splatCount, 7);
  assert.ok(!text.includes("secret-hash"));
  assert.equal("file" in dto.artifact, false);
  assert.ok(!text.includes(root));
  assert.equal(isTerminal(dto.stage), true);
});
