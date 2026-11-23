import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

// One folder per job under the run-local jobs root. job.json is the only
// durable state: a browser reload or a server restart reads it back and
// resumes polling, so nothing is submitted twice.

export const STAGES = Object.freeze([
  "uploading",
  "submitting",
  "queued",
  "processing",
  "downloading",
  "converting",
  "ready",
  "failed",
  "expired",
]);

export const TERMINAL_STAGES = Object.freeze(["ready", "failed", "expired"]);
export const ACTIVE_STAGES = Object.freeze(
  STAGES.filter((stage) => !TERMINAL_STAGES.includes(stage)),
);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const locks = new Map();

export function isJobId(value) {
  return typeof value === "string" && UUID.test(value);
}

export function isTerminal(stage) {
  return TERMINAL_STAGES.includes(stage);
}

export function jobPaths(jobsRoot, id) {
  const dir = join(jobsRoot, "jobs", id);
  return {
    dir,
    record: join(dir, "job.json"),
    source: join(dir, "source.mp4"),
    zip: join(dir, "result.zip"),
    ply: join(dir, "result.ply"),
    // result.glb is KIRI's own export and is never rewritten. refined.glb is
    // this app's separate candidate, written beside it.
    model: join(dir, "result.glb"),
    refined: join(dir, "refined.glb"),
    photosDir: join(dir, "photos"),
    artifact: join(dir, "result.spz"),
  };
}

async function withLock(key, task) {
  const previous = locks.get(key) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(task);
  locks.set(key, next);
  try {
    return await next;
  } finally {
    if (locks.get(key) === next) locks.delete(key);
  }
}

// Windows can refuse a rename while another handle (a reader, a scanner) still
// has the destination open. Retrying briefly keeps job.json atomic without
// falling back to a torn in-place write.
const RENAME_RETRIES = new Set(["EPERM", "EACCES", "EBUSY", "ENOENT"]);

async function replaceFile(temporary, destination) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(temporary, destination);
      return;
    } catch (error) {
      if (!RENAME_RETRIES.has(error.code) || attempt >= 5) throw error;
      await new Promise((resolve) => setTimeout(resolve, 15 * (attempt + 1)));
    }
  }
}

async function writeRecord(jobsRoot, job) {
  const paths = jobPaths(jobsRoot, job.id);
  await mkdir(paths.dir, { recursive: true });
  const temporary = `${paths.record}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(job, null, 2)}\n`, "utf8");
  await replaceFile(temporary, paths.record);
}

export function newJobRecord({ videoHash, filename, bytes, provider, dimensions = null, kind = "video" }) {
  const now = new Date().toISOString();
  return {
    schema: 1,
    id: randomUUID(),
    videoHash,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    stage: "uploading",
    provider,
    source: { filename, bytes, kind, dimensions, photos: 0 },
    kiri: { serial: null, status: null, statusRaw: null },
    attempts: { submit: 0, poll: 0, finalize: 0 },
    timings: {},
    artifact: null,
    photos: [],
    refine: null,
    error: null,
  };
}

export async function saveNewJob(jobsRoot, record) {
  await withLock(`${jobsRoot}:${record.id}`, () => writeRecord(jobsRoot, record));
  return record;
}

export async function readJob(jobsRoot, id) {
  if (!isJobId(id)) return null;
  try {
    const text = await readFile(jobPaths(jobsRoot, id).record, "utf8");
    const job = JSON.parse(text);
    return job?.id === id ? job : null;
  } catch {
    return null;
  }
}

export async function updateJob(jobsRoot, id, patch) {
  if (!isJobId(id)) return null;
  return withLock(`${jobsRoot}:${id}`, async () => {
    let job;
    try {
      job = JSON.parse(await readFile(jobPaths(jobsRoot, id).record, "utf8"));
    } catch {
      return null;
    }
    const next = { ...job, ...patch, updatedAt: new Date().toISOString() };
    await writeRecord(jobsRoot, next);
    return next;
  });
}

export async function listJobs(jobsRoot) {
  let names;
  try {
    names = await readdir(join(jobsRoot, "jobs"));
  } catch {
    return [];
  }
  const jobs = [];
  for (const name of names) {
    if (!isJobId(name)) continue;
    const job = await readJob(jobsRoot, name);
    if (job) jobs.push(job);
  }
  return jobs.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function findReusableByHash(jobsRoot, videoHash) {
  const jobs = await listJobs(jobsRoot);
  return (
    jobs.find(
      (job) => job.videoHash === videoHash && !["failed", "expired"].includes(job.stage),
    ) ?? null
  );
}

export async function findLatestByHash(jobsRoot, videoHash) {
  return (await listJobs(jobsRoot)).find((job) => job.videoHash === videoHash) ?? null;
}

// Non-terminal jobs are never pruned: a poller may still be working on them.
export async function pruneJobs(jobsRoot, keep = 50) {
  const jobs = await listJobs(jobsRoot);
  const removable = jobs.filter((job) => isTerminal(job.stage)).slice(keep);
  for (const job of removable)
    await rm(jobPaths(jobsRoot, job.id).dir, { recursive: true, force: true });
  return removable.length;
}

// The file name carries the format, because a mesh job serves a GLB and a splat
// job serves an SPZ. `format` is always the artifact's own value.
export function artifactUrl(id, format = "spz") {
  return `/api/kiri/jobs/${id}/result.${format === "glb" ? "glb" : "spz"}`;
}

export function artifactFile(format) {
  return format === "glb" ? "result.glb" : "result.spz";
}

export function rawArtifactUrl(id) {
  return `/api/kiri/jobs/${id}/raw.glb`;
}

export function photoUrl(id, index) {
  return `/api/kiri/jobs/${id}/photos/${index + 1}`;
}

// Only the numbers a buyer can act on. The loop-by-loop geometry stays in
// job.json: it is evidence for the operator, not a product fact.
export function refineSummary(refine) {
  if (!refine) return null;
  const metrics = refine.metrics ?? null;
  return {
    status: refine.status ?? "unknown",
    reason: refine.reason ?? null,
    ms: refine.ms ?? null,
    metrics: metrics
      ? {
          trianglesBefore: metrics.trianglesBefore ?? null,
          trianglesAfter: metrics.trianglesAfter ?? null,
          fragmentsRemoved: metrics.fragmentsRemoved ?? null,
          fragmentTrianglesRemoved: metrics.fragmentTrianglesRemoved ?? null,
          boundaryLoops: metrics.boundaryLoops ?? null,
          loopsKept: metrics.loopsKept ?? metrics.openingsKept ?? null,
          gapsFilled: metrics.gapsFilled ?? null,
          gapTrianglesAdded: metrics.gapTrianglesAdded ?? null,
          scale: metrics.scale ?? null,
          targetSize: metrics.targetSize ?? null,
          // How much of the silhouette still sees through the mesh, measured on
          // three axes. This is the one number that keeps the refined tab from
          // promising a closed surface the scan never had.
          coverage: metrics.coverage
            ? {
                verdict: metrics.coverage.verdict ?? null,
                holeRatioBefore: metrics.coverage.holeRatioBefore ?? null,
                holeRatioAfter: metrics.coverage.holeRatioAfter ?? null,
                worstAxis: metrics.coverage.worstAxis ?? null,
              }
            : null,
        }
      : null,
  };
}

// The DTO is everything the browser may know. The API key, the local paths and
// the video hash stay on the server.
export function toJobDto(job, { mock = false, now = Date.now(), ttlMs = 0 } = {}) {
  const createdAt = new Date(job.createdAt).getTime();
  const format = job.artifact?.format === "glb" ? "glb" : "spz";
  const refined = format === "glb" && job.refine?.status === "applied";
  return {
    id: job.id,
    stage: job.stage,
    provider: job.provider,
    mock: mock || job.provider === "mock",
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt,
    expiresAt: ttlMs ? new Date(createdAt + ttlMs).toISOString() : null,
    source: {
      filename: job.source?.filename ?? null,
      bytes: job.source?.bytes ?? 0,
      kind: job.source?.kind ?? "video",
      // Seller-provided measurements, in centimetres. The model itself is only
      // ever a preview, so its dimensions are never inferred from the mesh.
      dimensions: job.source?.dimensions ?? null,
      photos: job.source?.photos ?? job.photos?.length ?? 0,
    },
    // How the model was built: the clip itself or stills sampled from it.
    input: job.input ?? null,
    kiri: {
      serial: job.kiri?.serial ?? null,
      status: job.kiri?.status ?? null,
    },
    timings: {
      uploadMs: job.timings?.uploadMs ?? null,
      submitMs: job.timings?.submitMs ?? null,
      queueMs: job.timings?.queueMs ?? null,
      finalizeMs: job.timings?.finalizeMs ?? null,
      refineMs: job.timings?.refineMs ?? null,
      totalMs:
        job.completedAt && job.createdAt
          ? new Date(job.completedAt).getTime() - new Date(job.createdAt).getTime()
          : null,
    },
    artifact: job.artifact
      ? {
          format,
          bytes: (refined ? job.refined?.bytes : null) ?? job.artifact.bytes,
          splatCount: job.artifact.splatCount ?? null,
          triangles:
            (refined ? job.refined?.triangles : null) ?? job.artifact.triangles ?? null,
          url: artifactUrl(job.id, format),
          refined: refined || false,
          raw:
            format === "glb"
              ? {
                  bytes: job.artifact.bytes,
                  triangles: job.artifact.triangles ?? null,
                  url: rawArtifactUrl(job.id),
                }
              : null,
        }
      : null,
    // The seller's own photos, kept so the buyer can check the item itself when
    // no model is good enough.
    photos: (job.photos ?? []).map((photo, index) => ({
      url: photoUrl(job.id, index),
      bytes: photo.bytes ?? 0,
    })),
    refine: refineSummary(job.refine),
    error: job.error
      ? {
          code: job.error.code,
          message: job.error.message,
          retryable: job.error.retryable === true,
        }
      : null,
    now: new Date(now).toISOString(),
  };
}
