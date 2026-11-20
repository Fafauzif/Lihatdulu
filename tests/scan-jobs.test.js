import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  STAGES,
  TERMINAL_STAGES,
  createJob,
  isJobId,
  jobPaths,
  listJobs,
  pruneJobs,
  readJob,
  updateJob,
  validateJob,
  writeJob,
} from "../server/scan-jobs.mjs";

const meta = {
  title: "Kursi",
  widthCm: 58,
  depthCm: 63,
  heightCm: 84,
  conditionNote: "",
  device: "Android",
  clientId: "",
};

let root;
let job;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "scan-jobs-"));
  job = await createJob(root, meta);
});

test("createJob writes a queued record under the root", async () => {
  assert.match(
    job.id,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  assert.equal(job.stage, "queued");
  assert.equal(job.clientId, "");
  assert.equal(job.provenance, null);
  assert.equal(job.artifact, null);
  assert.equal(job.error, null);
  assert.equal("clientId" in job.meta, false);
  assert.ok((await readJob(root, job.id)).id === job.id);
});

test("createJob keeps the client id as a top-level idempotency key", async () => {
  const withClient = await createJob(root, {
    ...meta,
    clientId: "6f1c2b7e-8a4d-4c3e-9f10-2b3c4d5e6f70",
  });
  assert.equal(withClient.clientId, "6f1c2b7e-8a4d-4c3e-9f10-2b3c4d5e6f70");
  assert.equal("clientId" in withClient.meta, false);
});

test("validateJob rejects an unknown stage and a bad id", () => {
  assert.throws(() => validateJob({ ...job, stage: "uploading" }), /Tahap/);
  assert.throws(() => validateJob({ ...job, id: "../x" }), /ID/);
  assert.equal(validateJob(job).id, job.id);
  assert.equal(STAGES.includes(job.stage), true);
  assert.deepEqual(TERMINAL_STAGES, ["ready", "failed"]);
});

test("updateJob refuses to leave a terminal stage and bumps updatedAt", async () => {
  const ready = await updateJob(root, job.id, { stage: "ready" });
  assert.ok(ready.updatedAt >= job.updatedAt);
  await assert.rejects(
    () => updateJob(root, job.id, { stage: "extracting" }),
    /selesai/,
  );
});

test("readJob returns null for traversal, missing and malformed ids", async () => {
  assert.equal(await readJob(root, "../package.json"), null);
  assert.equal(
    await readJob(root, "00000000-0000-4000-8000-000000000000"),
    null,
  );
  assert.equal(await readJob(root, "not-a-uuid"), null);
  assert.throws(() => jobPaths(root, "../x"), /ID/);
  assert.equal(isJobId("../x"), false);
});

test("pruneJobs keeps 10 newest terminal jobs and never removes a live job", async () => {
  for (let i = 0; i < 12; i++) {
    const extra = await createJob(root, meta);
    await writeJob(root, {
      ...extra,
      stage: "ready",
      updatedAt: new Date(Date.now() + i).toISOString(),
    });
  }
  const live = await createJob(root, meta);
  const removed = await pruneJobs(root, 10);
  const jobs = await listJobs(root);
  assert.equal(removed.length, 2);
  assert.equal(
    jobs.filter((record) => TERMINAL_STAGES.includes(record.stage)).length,
    10,
  );
  assert.ok(await readJob(root, live.id));
});
