import { randomUUID } from "node:crypto";
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

// One folder per opaque job id. The client id is the only cross-job identity:
// it exists so a retried upload after a lost response reuses its job.

export const STAGES = Object.freeze([
  "queued",
  "validating",
  "extracting",
  "aligning",
  "reconstructing",
  "finalizing",
  "ready",
  "failed",
]);

export const TERMINAL_STAGES = Object.freeze(["ready", "failed"]);

const JOB_KEYS = Object.freeze([
  "schema",
  "id",
  "clientId",
  "createdAt",
  "updatedAt",
  "stage",
  "meta",
  "media",
  "provenance",
  "artifact",
  "error",
]);
const META_KEYS = Object.freeze([
  "title",
  "widthCm",
  "depthCm",
  "heightCm",
  "conditionNote",
  "device",
]);
const MEDIA_KEYS = Object.freeze([
  "contentType",
  "bytes",
  "durationS",
  "width",
  "height",
]);
const ARTIFACT_KEYS = Object.freeze([
  "format",
  "bytes",
  "splatCount",
  "file",
  "stills",
]);
const ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function isJobId(value) {
  return typeof value === "string" && ID_PATTERN.test(value);
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`Bentuk ${label} tidak valid.`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  )
    throw new Error(`Bentuk ${label} tidak valid.`);
}

function isoDate(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    Number.isFinite(Date.parse(value))
  );
}

function finiteOrNull(value) {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

export function validateJob(record) {
  if (!record || typeof record !== "object" || Array.isArray(record))
    throw new Error("Bentuk pekerjaan tidak valid.");
  if (!isJobId(record.id)) throw new Error("ID pekerjaan tidak valid.");
  if (!STAGES.includes(record.stage))
    throw new Error(`Tahap pekerjaan tidak dikenal: ${record.stage}.`);
  exactKeys(record, JOB_KEYS, "pekerjaan");
  if (record.schema !== 1) throw new Error("Versi pekerjaan tidak dikenal.");
  if (typeof record.clientId !== "string")
    throw new Error("ID klien tidak valid.");
  if (!isoDate(record.createdAt) || !isoDate(record.updatedAt))
    throw new Error("Waktu pekerjaan tidak valid.");
  exactKeys(record.meta, META_KEYS, "detail pekerjaan");
  if (typeof record.meta.title !== "string" || record.meta.title.length < 1)
    throw new Error("Judul pekerjaan tidak valid.");
  for (const key of ["widthCm", "depthCm", "heightCm"])
    if (typeof record.meta[key] !== "number" || !Number.isFinite(record.meta[key]))
      throw new Error("Ukuran pekerjaan tidak valid.");
  if (typeof record.meta.conditionNote !== "string")
    throw new Error("Catatan kondisi tidak valid.");
  if (typeof record.meta.device !== "string")
    throw new Error("Perangkat tidak valid.");
  exactKeys(record.media, MEDIA_KEYS, "media pekerjaan");
  if (
    record.media.contentType !== null &&
    typeof record.media.contentType !== "string"
  )
    throw new Error("Tipe media tidak valid.");
  for (const key of ["bytes", "durationS", "width", "height"])
    if (!finiteOrNull(record.media[key]))
      throw new Error("Angka media tidak valid.");
  if (record.provenance !== null && typeof record.provenance !== "object")
    throw new Error("Provenans tidak valid.");
  if (record.artifact !== null) {
    exactKeys(record.artifact, ARTIFACT_KEYS, "artefak");
    if (!["spz", "ply"].includes(record.artifact.format))
      throw new Error("Format artefak tidak valid.");
    if (
      typeof record.artifact.bytes !== "number" ||
      typeof record.artifact.splatCount !== "number"
    )
      throw new Error("Ukuran artefak tidak valid.");
    if (
      typeof record.artifact.file !== "string" ||
      !/^[\w.-]+$/.test(record.artifact.file)
    )
      throw new Error("Nama artefak tidak valid.");
    if (
      !Array.isArray(record.artifact.stills) ||
      record.artifact.stills.some(
        (name) => typeof name !== "string" || !/^[\w.-]+$/.test(name),
      )
    )
      throw new Error("Bingkai artefak tidak valid.");
  }
  if (record.error !== null) {
    exactKeys(record.error, ["code", "message"], "galat");
    if (
      typeof record.error.code !== "string" ||
      typeof record.error.message !== "string"
    )
      throw new Error("Galat pekerjaan tidak valid.");
  }
  return record;
}

export function jobPaths(root, id) {
  if (!isJobId(id)) throw new Error("ID pekerjaan tidak valid.");
  const dir = join(root, id);
  return {
    dir,
    job: join(dir, "job.json"),
    clip: join(dir, "clip"),
    frames: join(dir, "frames"),
    work: join(dir, "work"),
    logs: join(dir, "logs"),
    output: join(dir, "output"),
    stills: join(dir, "stills"),
    result: join(dir, "output", "scan.spz"),
  };
}

function freshRecord(metaInput) {
  const { clientId = "", ...meta } = metaInput ?? {};
  const now = new Date().toISOString();
  return {
    schema: 1,
    id: randomUUID(),
    clientId: typeof clientId === "string" ? clientId : "",
    createdAt: now,
    updatedAt: now,
    stage: "queued",
    meta: {
      title: meta.title,
      widthCm: meta.widthCm,
      depthCm: meta.depthCm,
      heightCm: meta.heightCm,
      conditionNote: meta.conditionNote ?? "",
      device: meta.device ?? "",
    },
    media: {
      contentType: null,
      bytes: null,
      durationS: null,
      width: null,
      height: null,
    },
    provenance: null,
    artifact: null,
    error: null,
  };
}

export async function createJob(root, meta) {
  const record = freshRecord(meta);
  await mkdir(jobPaths(root, record.id).dir, { recursive: true });
  await writeJob(root, record);
  return record;
}

// One in-process lock per job: read-modify-write cycles from the queue, the
// pipeline and shutdown must not interleave. Writes use a unique temp file so
// two writers can never rename the same path.
const writeChains = new Map();

function withLock(id, task) {
  const previous = writeChains.get(id) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(task);
  writeChains.set(id, next);
  return next.finally(() => {
    if (writeChains.get(id) === next) writeChains.delete(id);
  });
}

async function persistJob(root, record) {
  validateJob(record);
  const paths = jobPaths(root, record.id);
  await mkdir(paths.dir, { recursive: true });
  const temporary = `${paths.job}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  try {
    for (let attempt = 0; ; attempt += 1) {
      try {
        await rename(temporary, paths.job);
        return record;
      } catch (error) {
        // Windows can briefly refuse to replace a file opened by a reader.
        // Retry instead of unlinking: a missing record would strand the job.
        if (
          !["EPERM", "EACCES", "EBUSY"].includes(error?.code) ||
          attempt >= 3
        )
          throw error;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
}

export async function writeJob(root, record) {
  validateJob(record);
  return withLock(record.id, () => persistJob(root, record));
}

export async function readJob(root, id) {
  if (!isJobId(id)) return null;
  try {
    const text = await readFile(jobPaths(root, id).job, "utf8");
    return validateJob(JSON.parse(text));
  } catch {
    return null;
  }
}

export async function updateJob(root, id, patch = {}) {
  return withLock(id, async () => {
    const current = await readJob(root, id);
    if (!current) throw new Error("Pekerjaan tidak ditemukan.");
    if (patch.id && patch.id !== current.id)
      throw new Error("ID pekerjaan tidak boleh diubah.");
    if (TERMINAL_STAGES.includes(current.stage))
      throw new Error("Pekerjaan sudah selesai.");
    const next = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    return persistJob(root, next);
  });
}

export async function listJobs(root) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const jobs = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !isJobId(entry.name)) continue;
    const record = await readJob(root, entry.name);
    if (record) jobs.push(record);
  }
  return jobs.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

export async function pruneJobs(root, keep = 10) {
  const jobs = await listJobs(root);
  const terminal = jobs
    .filter((record) => TERMINAL_STAGES.includes(record.stage))
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const remove = terminal.slice(Math.max(0, Number(keep) || 0));
  for (const record of remove)
    await rm(jobPaths(root, record.id).dir, { recursive: true, force: true });
  return remove.map((record) => record.id);
}
