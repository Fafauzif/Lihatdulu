import { copyFile, cp, mkdir, readdir, rm, stat, statfs } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { jobPaths } from "./scan-jobs.mjs";
import { runTool as defaultRunTool } from "./scan-tools.mjs";
import { ScanError } from "./scan-errors.mjs";

// Commands recorded from the actual binaries on the Helios:
// COLMAP 4.2.1 (CUDA) and Brush 0.3.0 (`brush_app.exe`).
// See docs/handoff/scan-toolchain.md.

export const MIN_FRAMES = 60;
export const MIN_REGISTERED = 20;
export const MIN_REGISTERED_RATIO = 0.3;
export const MIN_FREE_BYTES = 5 * 1024 ** 3;
export const MAX_ARTIFACT_BYTES = 60 * 1024 ** 2;
export const MAX_SPLATS = 2_500_000;

export const DEFAULT_LIMITS = Object.freeze({
  minFrames: MIN_FRAMES,
  minRegistered: MIN_REGISTERED,
  minRegisteredRatio: MIN_REGISTERED_RATIO,
  minFreeBytes: MIN_FREE_BYTES,
  maxArtifactBytes: MAX_ARTIFACT_BYTES,
  maxSplats: MAX_SPLATS,
});

export const TIMEOUTS = Object.freeze({
  ffprobe: 15_000,
  ffmpeg: 180_000,
  feature: 600_000,
  match: 900_000,
  mapper: 1_800_000,
  brush: 3_600_000,
  convert: 600_000,
});

export const BASE_FRAME_FPS = 3;
export const MAX_FRAME_FPS = 8;

export function extractionFps(
  durationS,
  { minFrames = MIN_FRAMES, base = BASE_FRAME_FPS, max = MAX_FRAME_FPS } = {},
) {
  const seconds = Math.max(1, durationS);
  return Math.min(max, Math.max(base, Math.ceil(minFrames / seconds)));
}

export function frameFilter(fps) {
  return `fps=${fps},scale=1280:-2`;
}

// VFR phone clips can yield one frame fewer than durationS * fps (a 15.00 s
// take at 4 fps produced 59). If the unchanged floor is missed, raise the
// rate one step at a time up to MAX_FRAME_FPS instead of rejecting usable
// footage; the 60-frame product limit itself never moves.
export function retryExtractionFps(
  fps,
  extracted,
  { minFrames = MIN_FRAMES, max = MAX_FRAME_FPS } = {},
) {
  if (extracted >= minFrames || fps >= max) return null;
  return Math.min(max, fps + 1);
}

export const FRAME_FILTER = frameFilter(BASE_FRAME_FPS);

export const buildFfprobeArgs = ({ clip }) => [
  "-v",
  "error",
  "-print_format",
  "json",
  "-show_format",
  "-show_streams",
  clip,
];

export const buildExtractArgs = ({
  clip,
  framesDir,
  fps = BASE_FRAME_FPS,
}) => [
  "-hide_banner",
  "-loglevel",
  "error",
  "-i",
  clip,
  "-vf",
  frameFilter(fps),
  "-q:v",
  "2",
  join(framesDir, "%04d.jpg"),
];

export const buildFeatureArgs = ({ database, images }) => [
  "feature_extractor",
  "--database_path",
  database,
  "--image_path",
  images,
  "--ImageReader.single_camera",
  "1",
  "--ImageReader.camera_model",
  "OPENCV",
];

export const buildMatchArgs = ({ database }) => [
  "sequential_matcher",
  "--database_path",
  database,
  "--SequentialMatching.overlap",
  "10",
  "--SequentialMatching.loop_detection",
  "0",
];

export const buildMapperArgs = ({ database, images, sparse }) => [
  "mapper",
  "--database_path",
  database,
  "--image_path",
  images,
  "--output_path",
  sparse,
];

export const buildAnalyzeArgs = ({ model }) => [
  "model_analyzer",
  "--path",
  model,
];

// Brush takes the dataset root positionally. The export options come from
// `brush_app.exe --help`; export-every equals total-steps so the run writes
// one final file.
export const BRUSH_ARGS_TEMPLATE = Object.freeze([
  "{dataset}",
  "--total-steps",
  "3000",
  "--max-splats",
  "2000000",
  "--export-path",
  "{exportPath}",
  "--export-name",
  "{exportName}",
  "--export-every",
  "3000",
]);

export const buildBrushArgs = ({ datasetDir, outputPly }) =>
  BRUSH_ARGS_TEMPLATE.map((arg) => {
    if (arg === "{dataset}") return datasetDir;
    if (arg === "{exportPath}") return dirname(outputPly);
    if (arg === "{exportName}") return basename(outputPly);
    return arg;
  });

export const buildConvertArgs = ({ inputPly, outputSpz, info = false }) => [
  inputPly,
  "--filter-nan",
  ...(info ? ["--info", "json"] : []),
  outputSpz,
];

export const buildDecimateArgs = ({ inputPly, outputPly }) => [
  inputPly,
  "--decimate",
  "2000000",
  outputPly,
];

export function parseFfprobe(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ScanError("footage_invalid", "Rekaman tidak bisa dibaca.");
  }
  const stream = Array.isArray(data?.streams)
    ? data.streams.find((entry) => entry.codec_type === "video")
    : null;
  const durationS = Number(data?.format?.duration ?? stream?.duration);
  const width = Number(stream?.width);
  const height = Number(stream?.height);
  if (
    !stream ||
    !Number.isFinite(durationS) ||
    durationS <= 0 ||
    !width ||
    !height
  )
    throw new ScanError("footage_invalid", "Rekaman tidak bisa dibaca.");
  return {
    durationS,
    width,
    height,
    bytes: Number(data?.format?.size ?? 0),
  };
}

export function parseRegisteredImages(text) {
  for (const pattern of [
    /Registered images:\s*(\d+)/i,
    /Registered frames:\s*(\d+)/i,
  ]) {
    const match = pattern.exec(text);
    if (match) return Number(match[1]);
  }
  throw new ScanError(
    "alignment_failed",
    "Jumlah bingkai terdaftar tidak terbaca.",
  );
}

// COLMAP's mapper can split one clip into several disjoint sub-models (for
// example a 2-image model 0 and a 60-image model 1). The largest registered
// set is the reconstruction the rest of the pipeline must use.
export function pickBestModel(models) {
  let best = null;
  for (const model of Array.isArray(models) ? models : []) {
    if (!best || model.registered > best.registered) best = model;
  }
  return best;
}

export function parseSplatCount(text) {
  const match =
    /"numGaussians"\s*:\s*(\d+)/i.exec(text) ??
    /numGaussians:\s*(\d+)/i.exec(text);
  if (!match)
    throw new ScanError("tool_failed", "jumlah splat tidak terbaca.");
  return Number(match[1]);
}

export async function findBrushOutput(workDir) {
  const expected = join(workDir, "scan.ply");
  try {
    const info = await stat(expected);
    if (info.isFile()) return expected;
  } catch {}
  let entries;
  try {
    entries = await readdir(workDir, { withFileTypes: true });
  } catch {
    entries = [];
  }
  const ply = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".ply"))
    .map((entry) => entry.name)
    .sort()
    .at(-1);
  if (!ply)
    throw new ScanError("tool_failed", "Brush tidak menghasilkan berkas .ply.");
  return join(workDir, ply);
}

export function buildProvenance({
  media,
  device,
  frames,
  timings,
  artifact,
  tools = {},
}) {
  const extracted = frames.extracted;
  const registered = frames.registered;
  return {
    source: {
      clipSeconds: media.durationS,
      device: device || "",
    },
    frames: {
      extracted,
      registered,
      ratio: extracted
        ? Math.round((registered / extracted) * 10000) / 10000
        : 0,
    },
    timings: { ...timings },
    artifact: {
      format: artifact.format,
      bytes: artifact.bytes,
      splatCount: artifact.splatCount,
    },
    tools: {
      ffmpeg: tools.ffmpeg ?? "",
      colmap: tools.colmap ?? "",
      brush: tools.brush ?? "",
      splatTransform: tools.splatTransform ?? "",
    },
  };
}

async function defaultDiskFree(dir) {
  try {
    const stats = await statfs(dir);
    return stats.bavail * stats.bsize;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

async function findClip(paths) {
  const names = await readdir(paths.dir);
  const name = names.find((entry) => /^clip\.[a-z0-9]+$/i.test(entry));
  if (!name) throw new ScanError("not_found", "Rekaman tidak ditemukan.");
  return join(paths.dir, name);
}

async function readToolVersions(runTool, cwd) {
  const read = async (name, args) => {
    try {
      const result = await runTool(name, args, { cwd, timeoutMs: 15_000 });
      return (result.stdout ?? "").trim().split(/\r?\n/)[0] ?? "";
    } catch {
      return "";
    }
  };
  return {
    ffmpeg: await read("ffmpeg", ["-version"]),
    colmap: await read("colmap", ["--version"]),
    brush: await read("brush", ["--version"]),
    splatTransform: await read("splatTransform", ["--version"]),
  };
}

export async function runRealPipeline(
  record,
  {
    root,
    updateStage,
    runTool = defaultRunTool,
    diskFree = defaultDiskFree,
    signal,
    limits = {},
  } = {},
) {
  const rules = { ...DEFAULT_LIMITS, ...limits };
  const tool = (name, args, options = {}) =>
    runTool(name, args, { ...options, signal });
  const paths = jobPaths(root, record.id);
  await mkdir(paths.logs, { recursive: true });
  const timings = { extractMs: 0, alignMs: 0, trainMs: 0, convertMs: 0, totalMs: 0 };
  const free = await diskFree(root);
  if (Number.isFinite(free) && free < rules.minFreeBytes)
    throw new ScanError(
      "disk_low",
      "Ruang penyimpanan laptop demo hampir penuh.",
    );

  await updateStage("validating");
  const clip = await findClip(paths);
  const probe = await tool(
    "ffprobe",
    buildFfprobeArgs({ clip }),
    { timeoutMs: TIMEOUTS.ffprobe, logPath: join(paths.logs, "ffprobe.log") },
  );
  const mediaInfo = parseFfprobe(probe.stdout);
  if (mediaInfo.durationS < 7 || mediaInfo.durationS > 50)
    throw new ScanError(
      "footage_invalid",
      "Durasi rekaman perlu 7–50 detik. Rekam ulang.",
    );
  let fps = extractionFps(mediaInfo.durationS);
  const media = {
    ...record.media,
    durationS: Number(mediaInfo.durationS.toFixed(1)),
    width: mediaInfo.width,
    height: mediaInfo.height,
  };

  await updateStage("extracting");
  await mkdir(paths.frames, { recursive: true });
  timings.extractMs = 0;
  let extract = await tool(
    "ffmpeg",
    buildExtractArgs({ clip, framesDir: paths.frames, fps }),
    { timeoutMs: TIMEOUTS.ffmpeg, logPath: join(paths.logs, "ffmpeg.log") },
  );
  timings.extractMs += extract.ms;
  let frameNames = (await readdir(paths.frames))
    .filter((name) => name.toLowerCase().endsWith(".jpg"))
    .sort();
  for (
    let retryFps = retryExtractionFps(fps, frameNames.length, {
      minFrames: rules.minFrames,
    });
    retryFps !== null;
    retryFps = retryExtractionFps(fps, frameNames.length, {
      minFrames: rules.minFrames,
    })
  ) {
    fps = retryFps;
    await rm(paths.frames, { recursive: true, force: true });
    await mkdir(paths.frames, { recursive: true });
    extract = await tool(
      "ffmpeg",
      buildExtractArgs({ clip, framesDir: paths.frames, fps }),
      { timeoutMs: TIMEOUTS.ffmpeg, logPath: join(paths.logs, "ffmpeg.log") },
    );
    timings.extractMs += extract.ms;
    frameNames = (await readdir(paths.frames))
      .filter((name) => name.toLowerCase().endsWith(".jpg"))
      .sort();
  }
  if (frameNames.length < rules.minFrames)
    throw new ScanError(
      "footage_short",
      "Rekaman terlalu singkat. Rekam 30–45 detik sambil berjalan mengelilingi barang.",
    );

  await updateStage("aligning");
  await mkdir(paths.work, { recursive: true });
  const database = join(paths.work, "db.db");
  const sparse = join(paths.work, "sparse");
  await mkdir(sparse, { recursive: true });
  const alignStarted = Date.now();
  const feature = await tool(
    "colmap",
    buildFeatureArgs({ database, images: paths.frames }),
    { cwd: paths.logs, timeoutMs: TIMEOUTS.feature, logPath: join(paths.logs, "colmap-feature.log") },
  );
  const match = await tool("colmap", buildMatchArgs({ database }), {
    cwd: paths.logs,
    timeoutMs: TIMEOUTS.match,
    logPath: join(paths.logs, "colmap-match.log"),
  });
  const map = await tool(
    "colmap",
    buildMapperArgs({ database, images: paths.frames, sparse }),
    { cwd: paths.logs, timeoutMs: TIMEOUTS.mapper, logPath: join(paths.logs, "colmap-map.log") },
  );
  const analyzeModels = (await readdir(sparse, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => Number(left) - Number(right));
  if (analyzeModels.length === 0)
    throw new ScanError(
      "alignment_failed",
      "COLMAP tidak menghasilkan model kamera. Rekam ulang dengan gerakan lebih pelan.",
    );
  const models = [];
  let analyzeMs = 0;
  for (const name of analyzeModels) {
    const analyze = await tool(
      "colmap",
      buildAnalyzeArgs({ model: join(sparse, name) }),
      {
        cwd: paths.logs,
        timeoutMs: TIMEOUTS.ffprobe,
        logPath: join(paths.logs, `colmap-analyze-${name}.log`),
      },
    );
    analyzeMs += analyze.ms;
    models.push({
      name,
      registered: parseRegisteredImages(analyze.stdout),
    });
  }
  timings.alignMs =
    feature.ms + match.ms + map.ms + analyzeMs || Date.now() - alignStarted;
  const bestModel = pickBestModel(models);
  const registered = bestModel.registered;
  const ratio = registered / frameNames.length;
  if (registered < rules.minRegistered || ratio < rules.minRegisteredRatio)
    throw new ScanError(
      "alignment_failed",
      `Kamera hanya mengenali ${registered} dari ${frameNames.length} bingkai. Rekam lebih pelan dengan cahaya lebih terang.`,
    );

  const dataset = join(paths.work, "dataset");
  await mkdir(join(dataset, "sparse"), { recursive: true });
  await cp(paths.frames, join(dataset, "images"), { recursive: true });
  await cp(join(sparse, bestModel.name), join(dataset, "sparse", "0"), {
    recursive: true,
  });

  await updateStage("reconstructing");
  await mkdir(paths.output, { recursive: true });
  const outputPly = join(paths.work, "scan.ply");
  const brush = await tool(
    "brush",
    buildBrushArgs({ datasetDir: dataset, outputPly }),
    {
      cwd: dataset,
      timeoutMs: TIMEOUTS.brush,
      logPath: join(paths.logs, "brush.log"),
    },
  );
  timings.trainMs = brush.ms;
  const ply = await findBrushOutput(paths.work);

  await updateStage("finalizing");
  const spz = join(paths.output, "scan.spz");
  const convertStarted = Date.now();
  let conversion = await tool(
    "splatTransform",
    buildConvertArgs({ inputPly: ply, outputSpz: spz, info: true }),
    { timeoutMs: TIMEOUTS.convert, logPath: join(paths.logs, "convert.log") },
  );
  let splatCount = parseSplatCount(conversion.stdout);
  let bytes = (await stat(spz)).size;
  if (bytes > rules.maxArtifactBytes || splatCount > rules.maxSplats) {
    const small = join(paths.work, "scan-small.ply");
    await tool(
      "splatTransform",
      buildDecimateArgs({ inputPly: ply, outputPly: small }),
      { timeoutMs: TIMEOUTS.convert, logPath: join(paths.logs, "decimate.log") },
    );
    conversion = await tool(
      "splatTransform",
      buildConvertArgs({ inputPly: small, outputSpz: spz, info: true }),
      { timeoutMs: TIMEOUTS.convert, logPath: join(paths.logs, "convert.log") },
    );
    splatCount = parseSplatCount(conversion.stdout);
    bytes = (await stat(spz)).size;
  }
  timings.convertMs = Date.now() - convertStarted;
  if (bytes > rules.maxArtifactBytes || splatCount > rules.maxSplats)
    throw new ScanError(
      "artifact_too_large",
      "Hasilnya terlalu besar untuk dibuka di ponsel. Rekam lebih singkat.",
    );

  await mkdir(paths.stills, { recursive: true });
  const stillFiles = [];
  const picks = [0, Math.floor(frameNames.length / 2), frameNames.length - 1];
  for (const [index, frameIndex] of picks.entries()) {
    const source = frameNames[Math.min(frameNames.length - 1, frameIndex)];
    const name = `${String(index).padStart(3, "0")}.jpg`;
    await copyFile(join(paths.frames, source), join(paths.stills, name));
    stillFiles.push(name);
  }

  const artifact = {
    format: "spz",
    bytes,
    splatCount,
    file: "scan.spz",
    stills: stillFiles,
  };
  timings.totalMs =
    timings.extractMs + timings.alignMs + timings.trainMs + timings.convertMs;
  const tools = await readToolVersions(runTool, paths.logs);
  const provenance = buildProvenance({
    media,
    device: record.meta.device,
    frames: { extracted: frameNames.length, registered },
    timings,
    artifact,
    tools,
  });

  await rm(paths.work, { recursive: true, force: true });
  return { media, provenance, artifact };
}


