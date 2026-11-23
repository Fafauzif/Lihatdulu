import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  convertPlyToSpz as defaultConvert,
  validateGlb as defaultValidateGlb,
  validateSplatPly as defaultValidatePly,
  validateSpz as defaultValidateSpz,
} from "./kiri-artifact.mjs";
import {
  extractModel as defaultExtractModel,
  extractSplat as defaultExtract,
  listZipEntries,
  readZipEntry,
} from "./zip.mjs";
import {
  cropToSubject,
  orbitCenter,
  readCameras,
  stripBackdrop as defaultStripBackdrop,
} from "./kiri-cleanup.mjs";
import { createFrameExtractor } from "./kiri-frames.mjs";
import { refineGlb as defaultRefineGlb } from "./kiri-refine.mjs";
import { KiriError, toKiriError } from "./kiri-errors.mjs";
import {
  findReusableByHash,
  isJobId,
  isTerminal,
  jobPaths,
  newJobRecord,
  readJob,
  saveNewJob,
  toJobDto,
  updateJob,
  listJobs,
} from "./kiri-jobs.mjs";

// Orchestration: upload -> KIRI submit -> poll with backoff -> download ZIP ->
// validate PLY -> convert SPZ -> ready. One poller per job, one job per video
// hash, so a reload, a retry or a double tap cannot submit the same clip twice.

const STATE_STAGE = Object.freeze({
  uploading: "queued",
  queuing: "queued",
  processing: "processing",
});

const MAX_POLL_ERRORS = 8;

export function backoffDelay(attempt, { minMs, maxMs }) {
  const step = Math.max(0, Number(attempt) || 0);
  return Math.min(maxMs, minMs * 2 ** Math.min(step, 10));
}

export function createKiriService({
  config,
  client,
  now = () => Date.now(),
  convert = defaultConvert,
  extract = defaultExtract,
  extractModel = defaultExtractModel,
  stripBackdrop = defaultStripBackdrop,
  validatePly = defaultValidatePly,
  validateSpz = defaultValidateSpz,
  validateGlb = defaultValidateGlb,
  refineGlb = defaultRefineGlb,
  readFileImpl = readFile,
  frames = createFrameExtractor(),
  log = () => {},
} = {}) {
  const jobsRoot = config.jobsRoot;
  const timers = new Map();
  const running = new Set();
  const hashLocks = new Map();
  let stopped = false;

  function dto(job) {
    return toJobDto(job, {
      mock: config.mode === "mock",
      ttlMs: config.jobTtlMs,
      now: now(),
    });
  }

  function logEvent(event, fields = {}) {
    log({ event, ...fields });
  }

  function errorPatch(error, job) {
    const kiriError = toKiriError(error);
    return {
      code: kiriError.code,
      message: kiriError.message,
      // Retrying server-side needs the KIRI serial; without it the seller has
      // to send the clip again, so the UI must not offer "proses ulang".
      retryable: kiriError.retryable && Boolean(job?.kiri?.serial),
    };
  }

  async function fail(job, error) {
    const kiriError = toKiriError(error);
    logEvent("job_failed", {
      id: job.id,
      code: kiriError.code,
      detail: kiriError.detail ?? null,
    });
    return updateJob(jobsRoot, job.id, {
      stage: kiriError.code === "kiri_expired" ? "expired" : "failed",
      error: errorPatch(kiriError, job),
      completedAt: new Date(now()).toISOString(),
    });
  }

  // The seller's stills are the honest fallback when no model is usable, so the
  // frames that shaped the model are copied aside before the working folder is
  // deleted. Even spacing covers the whole orbit instead of the first second.
  async function saveStills(stills, paths) {
    const limit = Math.max(1, Math.min(config.keptStills ?? 8, stills.length));
    const step = Math.max(1, Math.floor(stills.length / limit));
    await mkdir(paths.photosDir, { recursive: true });
    const saved = [];
    for (
      let index = 0;
      index < stills.length && saved.length < limit;
      index += step
    ) {
      const still = stills[index];
      const extension = /\.png$/i.test(still.filename ?? "") ? "png" : "jpg";
      const file = `photo-${saved.length + 1}.${extension}`;
      const destination = join(paths.photosDir, file);
      await copyFile(still.path, destination);
      const info = await stat(destination).catch(() => null);
      saved.push({ file, bytes: info?.size ?? 0 });
    }
    return saved;
  }

  // Refinement is a second, local stage over the GLB KIRI already returned. It
  // never touches KIRI, so it can be retried for free and its failure must not
  // take the raw scan down with it.
  async function applyRefine(job, paths) {
    const settings = config.refine ?? {};
    if (job.artifact?.format !== "glb") {
      return updateJob(jobsRoot, job.id, {
        refine: { status: "not_applicable", reason: "not_a_mesh", ms: 0 },
      });
    }
    if (!settings.enabled) {
      return updateJob(jobsRoot, job.id, {
        refine: { status: "disabled", reason: "refine_off", ms: 0 },
      });
    }
    const started = now();
    try {
      const raw = await readFileImpl(paths.model);
      const result = refineGlb(raw, settings);
      const ms = now() - started;
      if (!result?.buffer) {
        await rm(paths.refined, { force: true }).catch(() => {});
        logEvent("refine_skipped", {
          id: job.id,
          reason: result?.reason ?? "unknown",
          ms,
        });
        return updateJob(jobsRoot, job.id, {
          refine: {
            status: "skipped",
            reason: result?.reason ?? "unknown",
            ms,
            metrics: result?.metrics ?? null,
          },
          refined: null,
        });
      }
      await writeFile(paths.refined, result.buffer);
      const model = validateGlb(result.buffer, {
        maxBytes: config.limits.maxModelBytes,
      });
      logEvent("refine_applied", {
        id: job.id,
        trianglesBefore: result.metrics?.trianglesBefore ?? null,
        trianglesAfter: model.triangles,
        fragmentsRemoved: result.metrics?.fragmentsRemoved ?? null,
        gapsFilled: result.metrics?.gapsFilled ?? null,
        ms,
      });
      return updateJob(jobsRoot, job.id, {
        refine: {
          status: "applied",
          reason: null,
          ms,
          settings: { ...settings },
          metrics: result.metrics,
        },
        refined: {
          file: "refined.glb",
          bytes: model.bytes,
          triangles: model.triangles,
        },
        timings: { ...(job.timings ?? {}), refineMs: ms },
      });
    } catch (error) {
      const kiriError = toKiriError(error, "model_invalid");
      await rm(paths.refined, { force: true }).catch(() => {});
      logEvent("refine_failed", { id: job.id, code: kiriError.code });
      return updateJob(jobsRoot, job.id, {
        refine: {
          status: "failed",
          reason: kiriError.code,
          ms: now() - started,
          message: kiriError.message,
        },
        refined: null,
      });
    }
  }

  // Retry refinement from the saved raw GLB. This is the only "retry" that is
  // always safe to offer: it cannot spend a credit.
  async function refine(id) {
    const job = await readJob(jobsRoot, id);
    if (!job) throw new KiriError("not_found");
    if (job.stage !== "ready" || job.artifact?.format !== "glb")
      throw new KiriError("conflict");
    const paths = jobPaths(jobsRoot, id);
    const present = await stat(paths.model)
      .then((info) => info.isFile())
      .catch(() => false);
    if (!present) throw new KiriError("model_invalid", { detail: "GLB asli hilang." });
    const updated = await applyRefine(job, paths);
    return updated ?? job;
  }

  function schedule(jobId, delay) {
    if (stopped) return;
    const existing = timers.get(jobId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      timers.delete(jobId);
      void tick(jobId);
    }, Math.max(0, delay));
    timer.unref?.();
    timers.set(jobId, timer);
  }

  function scheduleNext(job) {
    schedule(
      job.id,
      backoffDelay(job.attempts?.poll ?? 0, config.poll),
    );
  }

  async function tick(jobId) {
    if (stopped || running.has(jobId)) return;
    running.add(jobId);
    try {
      let job = await readJob(jobsRoot, jobId);
      if (!job || isTerminal(job.stage)) return;
      if (job.createdAt && now() - new Date(job.createdAt).getTime() > config.jobTtlMs) {
        await fail(job, new KiriError("kiri_expired"));
        return;
      }
      if (!job.kiri?.serial) {
        // A job without a serial never reached KIRI; nothing to poll.
        if (job.stage === "submitting" || job.stage === "uploading")
          await fail(job, new KiriError("submit_interrupted"));
        return;
      }

      let status;
      try {
        status = await client.getStatus(job.kiri.serial, {
          jobDir: jobPaths(jobsRoot, job.id).dir,
        });
      } catch (error) {
        const pollErrors = (job.attempts?.pollErrors ?? 0) + 1;
        const kiriError = toKiriError(error);
        if (pollErrors >= MAX_POLL_ERRORS) {
          await updateJob(jobsRoot, job.id, {
            attempts: { ...job.attempts, pollErrors },
          });
          await fail(job, new KiriError("kiri_unavailable", { cause: error }));
          return;
        }
        logEvent("poll_error", {
          id: job.id,
          code: kiriError.code,
          attempt: pollErrors,
        });
        job = await updateJob(jobsRoot, job.id, {
          attempts: {
            ...job.attempts,
            poll: (job.attempts?.poll ?? 0) + 1,
            pollErrors,
          },
        });
        if (job) scheduleNext(job);
        return;
      }

      const stage = STATE_STAGE[status.state];
      if (status.state === "failed") {
        await fail(job, new KiriError("kiri_failed"));
        return;
      }
      if (status.state === "expired") {
        await fail(job, new KiriError("kiri_expired"));
        return;
      }
      if (status.state === "successful") {
        // Record KIRI's terminal status before finalizing. If the download or
        // the conversion fails, the job is retryable, but its provenance must
        // still say KIRI finished instead of freezing on "processing".
        job =
          (await updateJob(jobsRoot, job.id, {
            kiri: { ...job.kiri, status: status.status },
          })) ?? job;
        await finalize(job);
        return;
      }
      if (stage && stage !== job.stage) {
        const queuedAt = job.timings?.queuedAt;
        job = await updateJob(jobsRoot, job.id, {
          stage,
          kiri: { ...job.kiri, status: status.status },
          timings: {
            ...job.timings,
            ...(stage === "queued" && !queuedAt ? { queuedAt: new Date(now()).toISOString() } : {}),
          },
          attempts: { ...job.attempts, poll: (job.attempts?.poll ?? 0) + 1, pollErrors: 0 },
        });
      } else if (job.kiri?.status !== status.status) {
        job = await updateJob(jobsRoot, job.id, {
          kiri: { ...job.kiri, status: status.status },
          attempts: { ...job.attempts, poll: (job.attempts?.poll ?? 0) + 1, pollErrors: 0 },
        });
      }
      if (job) scheduleNext(job);
    } finally {
      running.delete(jobId);
    }
  }

  // The export ZIP also carries cameras.json. Pass it through the same cleanup
  // guards as the splats: an unreadable or flat camera set means no crop.
  function cropToOrbit(buffer, zip) {
    let cameras = null;
    try {
      const entry = listZipEntries(zip).find((item) => /(^|\/)cameras\.json$/i.test(item.name));
      if (entry) cameras = readCameras(readZipEntry(zip, entry).toString("utf8"));
    } catch {
      cameras = null;
    }
    if (!cameras) return null;
    const centre = orbitCenter(cameras);
    if (!centre) return null;
    const radius = config.crop?.radius ?? 1.6;
    const attempt = cropToSubject(buffer, { center: centre, radius });
    if (!attempt.removed) return null;
    return { buffer: attempt.buffer, centre, radius, removed: attempt.removed };
  }

  async function finalize(job) {
    const paths = jobPaths(jobsRoot, job.id);
    const started = now();
    await updateJob(jobsRoot, job.id, {
      stage: "downloading",
      attempts: { ...job.attempts, finalize: (job.attempts?.finalize ?? 0) + 1 },
    });
    try {
      const download = await client.downloadZip(job.kiri.serial, paths.zip, {
        maxBytes: config.limits.maxZipBytes,
        jobDir: paths.dir,
      });
      await updateJob(jobsRoot, job.id, { stage: "converting" });
      const zip = await readFileImpl(paths.zip);
      // The mesh profiles return a GLB and no splats: there is nothing to
      // convert, so the validated model is written and served as-is. `kind` is
      // the recorded artifact shape; older records only carry `mode`.
      const meshArtifact =
        job.input?.kind === "mesh" ||
        job.input?.mode === "mesh" ||
        job.input?.mode === "photo";
      if (meshArtifact) {
        const { name, data } = extractModel(zip, {
          maxBytes: config.limits.maxModelBytes,
        });
        const model = validateGlb(data, {
          maxBytes: config.limits.maxModelBytes,
        });
        await writeFile(paths.model, data);
        // The artifact is recorded now, but the job is not "ready" until the
        // refinement has run: a poller must never see ready with a refine field
        // that is still about to change.
        const updated = await updateJob(jobsRoot, job.id, {
          error: null,
          artifact: {
            format: "glb",
            file: "result.glb",
            bytes: model.bytes,
            triangles: model.triangles,
            sourceEntry: name,
          },
          cleanup: null,
          crop: null,
          timings: {
            ...job.timings,
            downloadMs: now() - started,
            convertMs: 0,
            finalizeMs: now() - started,
          },
        });
        // The raw GLB is already on disk and served from its own URL, so this
        // pass can fail, be disabled or be skipped without losing the scan.
        const refined = await applyRefine(updated ?? job, paths);
        const published = await updateJob(jobsRoot, job.id, {
          stage: "ready",
          completedAt: new Date(now()).toISOString(),
          timings: {
            ...(refined?.timings ?? job.timings),
            finalizeMs: now() - started,
          },
        });
        await cleanupTransient(paths);
        logEvent("job_ready", {
          id: job.id,
          format: "glb",
          bytes: model.bytes,
          triangles: model.triangles,
          refined: refined?.refine?.status ?? "unknown",
          mock: config.mode === "mock",
        });
        return published;
      }
      const { data } = extract(zip, { maxBytes: config.limits.maxPlyBytes });
      validatePly(data, {
        maxBytes: config.limits.maxPlyBytes,
        maxSplats: config.limits.maxSplats,
      });
      // KIRI appends a synthetic backdrop ball far outside the subject; it would
      // otherwise become the framing box and hide the furniture.
      const cleaned = stripBackdrop(data);
      // A 3DGS export is the whole room. For an object profile, cut to where the
      // camera axes meet: that point is the thing the seller orbited around.
      const crop = config.crop?.mode === "subject" ? cropToOrbit(cleaned.buffer, zip) : null;
      const shaped = crop ? crop.buffer : cleaned.buffer;
      await writeFile(paths.ply, shaped);
      const conversion = await convert({
        inputPath: paths.ply,
        outputPath: paths.artifact,
        timeoutMs: config.convertTimeoutMs,
      });
      const spz = await readFileImpl(paths.artifact);
      const artifact = validateSpz(spz, {
        maxBytes: config.limits.maxArtifactBytes,
        maxSplats: config.limits.maxSplats,
      });
      const updated = await updateJob(jobsRoot, job.id, {
        stage: "ready",
        error: null,
        completedAt: new Date(now()).toISOString(),
        artifact: {
          format: "spz",
          file: "result.spz",
          bytes: artifact.bytes,
          splatCount: artifact.splatCount,
        },
        cleanup: cleaned.removed
          ? { reason: cleaned.reason, splatsRemoved: cleaned.removed }
          : null,
        crop: crop
          ? {
              center: crop.centre.map((value) => Number(value.toFixed(3))),
              radius: crop.radius,
              splatsRemoved: crop.removed,
            }
          : null,
        timings: {
          ...job.timings,
          downloadMs: now() - started,
          convertMs: conversion?.ms ?? null,
          finalizeMs: now() - started,
        },
      });
      // The ZIP and PLY are only working files; keep job.json and result.spz.
      await cleanupTransient(paths);
      logEvent("job_ready", {
        id: job.id,
        bytes: artifact.bytes,
        splats: artifact.splatCount,
        mock: config.mode === "mock",
      });
      return updated;
    } catch (error) {
      await cleanupTransient(paths);
      await fail(job, toKiriError(error));
      return readJob(jobsRoot, job.id);
    }
  }

  // The GLB is an artifact, not a working file, so it is never removed here.
  async function cleanupTransient(paths) {
    for (const path of [paths.zip, paths.ply])
      await rm(path, { force: true }).catch(() => {});
  }

  // Two uploads of the same bytes can arrive at once (double tap, retry). The
  // hash lock makes the dedupe check and the job creation one step.
  async function withHashLock(hash, task) {
    const previous = hashLocks.get(hash) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(task);
    hashLocks.set(hash, next);
    try {
      return await next;
    } finally {
      if (hashLocks.get(hash) === next) hashLocks.delete(hash);
    }
  }

  // KIRI charges one credit per submission even when the reconstruction later
  // fails, so an empty balance must stop the request before the upload. Only
  // the live client exposes getBalance; the mock reports a healthy balance.
  async function creditBalance() {
    if (typeof client.getBalance !== "function") return null;
    const { balance } = await client.getBalance();
    return balance;
  }

  async function assertCredit() {
    const balance = await creditBalance();
    if (balance !== null && balance < 1) throw new KiriError("kiri_no_credit");
    return balance;
  }

  async function submit(args) {
    return withHashLock(args.videoHash, () => submitLocked(args));
  }

  async function submitLocked({
    tempPath,
    filename,
    bytes,
    videoHash,
    uploadMs = 0,
    transcodedFrom = null,
  }) {
    const reusable = await findReusableByHash(jobsRoot, videoHash);
    if (reusable) {
      await rm(tempPath, { force: true }).catch(() => {});
      logEvent("job_deduplicated", { id: reusable.id, stage: reusable.stage });
      return { job: reusable, deduplicated: true };
    }
    await assertCredit();
    const record = newJobRecord({
      videoHash,
      filename,
      bytes,
      provider: client.provider,
      transcodedFrom,
    });
    await saveNewJob(jobsRoot, record);
    let job = await updateJob(jobsRoot, record.id, {
      stage: "submitting",
      attempts: { ...record.attempts, submit: 1 },
      timings: { uploadMs },
    });

    const submitStarted = now();
    const jobDir = jobPaths(jobsRoot, job.id).dir;
    // KIRI's 3DGS image endpoint reconstructs one object from stills. A video
    // orbit of a chair reconstructs the room around it, so when the profile
    // asks for stills the clip is sampled first and the frames are sent instead.
    const splatMode =
      config.input?.mode === "splat" && typeof client.submitImages === "function";
    // Photo Scan is the route KIRI documents for an ordinary textured object and
    // the only one with quality controls. It answers with a mesh.
    const scanMode =
      config.input?.mode === "photo" &&
      typeof client.submitPhotoImages === "function";
    // The mesh profile needs stills too, but from the featureless-object
    // endpoint. A client without that method falls back to the plain video job.
    const meshMode =
      config.input?.mode === "mesh" &&
      typeof client.submitFeaturelessImages === "function";
    const stillsMode = splatMode || scanMode || meshMode;
    const framesDir = join(jobDir, "frames");
    const paths = jobPaths(jobsRoot, job.id);
    let stills = null;
    let keptStills = [];
    let input = { mode: "video" };
    if (stillsMode) {
      try {
        stills = await frames.extract({
          videoPath: tempPath,
          directory: framesDir,
          fps: config.input.fps,
          count: config.input.photos,
        });
        if (config.keepStills)
          keptStills = await saveStills(stills, paths).catch(() => []);
        const stillsKind = meshMode || scanMode ? "mesh" : "splat";
        input = {
          mode: meshMode ? "mesh" : scanMode ? "photo" : "splat",
          kind: stillsKind,
          photos: stills.length,
          ...(stillsKind === "mesh" ? { fileFormat: "GLB" } : {}),
          // Record the knobs that shaped the result: a quality claim is only
          // honest if the provenance says which settings produced it.
          ...(scanMode
            ? {
                modelQuality: config.input.modelQuality,
                textureQuality: config.input.textureQuality,
                textureSmoothing: config.input.textureSmoothing,
                mask: config.isMask ? 1 : 0,
              }
            : {}),
        };
      } catch (error) {
        // A missing ffmpeg or a clip too short for 20 stills is not a dead end:
        // the video upload is still a valid KIRI job.
        const kiriError = toKiriError(error, "kiri_unavailable");
        input = { mode: "video", fallback: kiriError.code, reason: kiriError.detail ?? null };
        logEvent("job_photo_fallback", { id: job.id, code: kiriError.code });
      }
    }
    try {
      const result = stills
        ? meshMode
          ? await client.submitFeaturelessImages({
              files: stills,
              fileFormat: config.input.fileFormat ?? "GLB",
              jobDir,
            })
          : scanMode
            ? await client.submitPhotoImages({
                files: stills,
                mask: config.isMask,
                modelQuality: config.input.modelQuality,
                textureQuality: config.input.textureQuality,
                textureSmoothing: config.input.textureSmoothing,
                fileFormat: config.input.fileFormat ?? "GLB",
                jobDir,
              })
            : await client.submitImages({ files: stills, mask: config.isMask })
        : await client.submitVideo({ filePath: tempPath, filename, jobDir });
      job = await updateJob(jobsRoot, job.id, {
        stage: "queued",
        input,
        kiri: { serial: result.serial, status: 3, statusRaw: null },
        ...(keptStills.length
          ? {
              photos: keptStills,
              source: { ...job.source, photos: keptStills.length },
            }
          : {}),
        timings: {
          ...job.timings,
          submitMs: now() - submitStarted,
          queuedAt: new Date(now()).toISOString(),
        },
      });
      logEvent("job_submitted", {
        id: job.id,
        mock: config.mode === "mock",
        input: input.mode,
        photos: input.photos ?? null,
      });
    } catch (error) {
      await fail(job, toKiriError(error));
      job = await readJob(jobsRoot, job.id);
    } finally {
      if (stillsMode)
        await rm(framesDir, { recursive: true, force: true }).catch(() => {});
      await rm(tempPath, { force: true }).catch(() => {});
    }
    schedule(job.id, config.poll.minMs);
    return { job, deduplicated: false };
  }

  // A photoset is the other legal input: the seller already has stills of the
  // piece, so the frames are copied into the job first (they are what the buyer
  // falls back to) and then sent to the Photo Scan route.
  async function submitPhotos(args) {
    return withHashLock(args.videoHash, () => submitPhotosLocked(args));
  }

  async function submitPhotosLocked({
    files = [],
    videoHash,
    bytes = 0,
    filename = "foto.zip",
    dimensions = null,
    uploadMs = 0,
  }) {
    const reusable = await findReusableByHash(jobsRoot, videoHash);
    if (reusable) {
      logEvent("job_deduplicated", { id: reusable.id, stage: reusable.stage });
      return { job: reusable, deduplicated: true };
    }
    await assertCredit();
    const record = newJobRecord({
      videoHash,
      filename,
      bytes,
      provider: client.provider,
      dimensions,
      kind: "photos",
    });
    await saveNewJob(jobsRoot, record);
    const paths = jobPaths(jobsRoot, record.id);
    let job = await updateJob(jobsRoot, record.id, {
      stage: "submitting",
      attempts: { ...record.attempts, submit: 1 },
      timings: { uploadMs },
    });
    const submitStarted = now();
    await mkdir(paths.photosDir, { recursive: true });
    const saved = [];
    const copies = [];
    for (let index = 0; index < files.length; index += 1) {
      const source = files[index];
      const extension = /\.png$/i.test(source.filename ?? "") ? "png" : "jpg";
      const file = `photo-${index + 1}.${extension}`;
      const destination = join(paths.photosDir, file);
      await copyFile(source.path, destination);
      const info = await stat(destination).catch(() => null);
      saved.push({ file, bytes: info?.size ?? 0, original: source.filename ?? file });
      copies.push({ path: destination, filename: source.filename ?? file });
    }
    const photoMode = typeof client.submitPhotoImages === "function";
    const input = {
      mode: photoMode ? "photo" : "splat",
      kind: "mesh",
      source: "photos",
      photos: copies.length,
      ...(photoMode
        ? {
            fileFormat: "GLB",
            modelQuality: config.input.modelQuality,
            textureQuality: config.input.textureQuality,
            textureSmoothing: config.input.textureSmoothing,
            mask: config.isMask ? 1 : 0,
          }
        : {}),
    };
    try {
      const result = photoMode
        ? await client.submitPhotoImages({
            files: copies,
            mask: config.isMask,
            modelQuality: config.input.modelQuality,
            textureQuality: config.input.textureQuality,
            textureSmoothing: config.input.textureSmoothing,
            fileFormat: "GLB",
            jobDir: paths.dir,
          })
        : await client.submitImages({ files: copies, mask: config.isMask, jobDir: paths.dir });
      job = await updateJob(jobsRoot, job.id, {
        stage: "queued",
        input,
        photos: saved,
        source: { ...job.source, photos: saved.length },
        kiri: { serial: result.serial, status: 3, statusRaw: null },
        timings: {
          ...job.timings,
          submitMs: now() - submitStarted,
          queuedAt: new Date(now()).toISOString(),
        },
      });
      logEvent("job_submitted", {
        id: job.id,
        mock: config.mode === "mock",
        input: input.mode,
        photos: input.photos,
        source: "photos",
      });
    } catch (error) {
      await fail(job, toKiriError(error));
      job = await readJob(jobsRoot, job.id);
    }
    schedule(job.id, config.poll.minMs);
    return { job, deduplicated: false };
  }

  async function retry(id) {
    const job = await readJob(jobsRoot, id);
    if (!job) throw new KiriError("not_found");
    if (!isJobId(id)) throw new KiriError("not_found");
    if (job.stage !== "failed" || !job.error?.retryable || !job.kiri?.serial)
      throw new KiriError("conflict");
    const updated = await updateJob(jobsRoot, id, {
      stage: "downloading",
      error: null,
      completedAt: null,
    });
    void finalize({ ...updated, attempts: updated.attempts });
    return updated;
  }

  async function resume() {
    const jobs = await listJobs(jobsRoot);
    for (const job of jobs) {
      if (isTerminal(job.stage)) continue;
      if (!job.kiri?.serial) {
        await fail(job, new KiriError("submit_interrupted"));
        continue;
      }
      schedule(job.id, config.poll.minMs);
    }
    return jobs.filter((job) => !isTerminal(job.stage)).length;
  }

  function stop() {
    stopped = true;
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
  }

  return {
    submit,
    submitPhotos,
    retry,
    refine,
    resume,
    stop,
    dto,
    tick,
    finalize,
    balance: creditBalance,
  };
}
