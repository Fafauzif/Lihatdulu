import { copyFile, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import {
  basename,
  delimiter,
  dirname,
  extname,
  join,
  resolve,
} from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  createJob,
  jobPaths,
  updateJob,
} from "../server/scan-jobs.mjs";
import { ScanError } from "../server/scan-errors.mjs";
import { runRealPipeline } from "../server/scan-pipeline.mjs";
import { resolveTool } from "../server/scan-tools.mjs";

// Batch harness for the real chair clip study. It reuses the server's
// one-worker job model and `runRealPipeline`, writes the results after every
// clip, and keeps going when a clip fails: the failure is the data.

const repoRoot = fileURLToPath(new URL("../", import.meta.url));

export const CLIP_EXTENSIONS = Object.freeze([".mp4", ".mov", ".m4v"]);

const CONTENT_TYPES = Object.freeze({
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".m4v": "video/x-m4v",
});

export const DEFAULT_META = Object.freeze({
  widthCm: 60,
  depthCm: 60,
  heightCm: 100,
  conditionNote: "Uji klip pindai, bukan listing.",
  device: "clip study",
  clientId: "",
});

const TOOL_HINTS = Object.freeze({
  colmap: "Ekstrak COLMAP 4.2.1 dan set SCAN_COLMAP ke colmap.exe.",
  brush: "Ekstrak Brush 0.3.0 dan set SCAN_BRUSH ke brush_app.exe.",
});

export async function listClips(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const clips = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const extension = extname(entry.name).toLowerCase();
    if (!CLIP_EXTENSIONS.includes(extension)) continue;
    const path = join(dir, entry.name);
    clips.push({ name: entry.name, path, sizeBytes: (await stat(path)).size });
  }
  return clips.sort((a, b) => a.name.localeCompare(b.name));
}

export function selectClips(clips, tokens = []) {
  const needles = (Array.isArray(tokens) ? tokens : [])
    .map((token) => String(token).trim().toLowerCase())
    .filter(Boolean);
  if (needles.length === 0) return [...clips];
  return clips.filter((clip) =>
    needles.some((needle) => clip.name.toLowerCase().includes(needle)),
  );
}

export function toolDefaults(root) {
  const colmap = join(root, "var", "tools", "colmap", "bin", "colmap.exe");
  const brush = join(root, "var", "tools", "brush", "brush_app.exe");
  return {
    colmap: existsSync(colmap) ? colmap : "",
    brush: existsSync(brush) ? brush : "",
  };
}

export function summarizeRun({ provenance = {}, artifact = {} } = {}) {
  const frames = provenance?.frames ?? {};
  const timings = provenance?.timings ?? {};
  return {
    extracted: frames.extracted ?? null,
    registered: frames.registered ?? null,
    ratio: frames.ratio ?? null,
    totalMs: timings.totalMs ?? null,
    splatCount: artifact?.splatCount ?? null,
    bytes: artifact?.bytes ?? null,
    format: artifact?.format ?? null,
  };
}

export async function runBatch({
  root,
  clips,
  meta = {},
  pipeline = runRealPipeline,
  limits,
  onProgress,
  onResult,
} = {}) {
  if (!root) throw new Error("Folder hasil belum ditentukan.");
  if (!Array.isArray(clips)) throw new Error("Daftar klip tidak valid.");
  // The real pipeline runs COLMAP with cwd set to the job's logs folder, so a
  // relative root would resolve the database path against that cwd and fail.
  const jobRoot = resolve(root);
  const settings = { ...DEFAULT_META, ...meta };
  const results = [];
  for (const clip of clips) {
    const extension = extname(clip.name).toLowerCase();
    const record = await createJob(jobRoot, {
      title: basename(clip.name, extname(clip.name)),
      widthCm: settings.widthCm,
      depthCm: settings.depthCm,
      heightCm: settings.heightCm,
      conditionNote: settings.conditionNote,
      device: settings.device,
      clientId: settings.clientId ?? "",
    });
    let row;
    try {
      const paths = jobPaths(jobRoot, record.id);
      await copyFile(clip.path, `${paths.clip}${extension}`);
      const sizeBytes =
        clip.sizeBytes ?? (await stat(clip.path)).size;
      const current = await updateJob(jobRoot, record.id, {
        media: {
          ...record.media,
          contentType: CONTENT_TYPES[extension] ?? null,
          bytes: sizeBytes,
        },
      });
      const options = {
        root: jobRoot,
        updateStage: async (stage) => {
          await onProgress?.(clip.name, stage);
        },
      };
      if (limits) options.limits = limits;
      const outcome = await pipeline(current, options);
      await updateJob(jobRoot, record.id, {
        stage: "ready",
        media: outcome.media,
        provenance: outcome.provenance,
        artifact: outcome.artifact,
      });
      row = {
        clip: clip.name,
        ok: true,
        jobId: record.id,
        stage: "ready",
        summary: summarizeRun(outcome),
        provenance: outcome.provenance,
        artifact: outcome.artifact,
        error: null,
      };
    } catch (error) {
      const failure = {
        code:
          error instanceof ScanError
            ? error.code
            : typeof error?.code === "string"
              ? error.code
              : "internal",
        message: error?.message ?? String(error),
      };
      await updateJob(jobRoot, record.id, { stage: "failed", error: failure });
      row = {
        clip: clip.name,
        ok: false,
        jobId: record.id,
        stage: "failed",
        summary: null,
        provenance: null,
        artifact: null,
        error: failure,
      };
    }
    results.push(row);
    await onResult?.(results);
  }
  return results;
}

function commandExists(command) {
  if (!command) return false;
  if (command.includes("/") || command.includes("\\")) return existsSync(command);
  const extensions =
    process.platform === "win32"
      ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM")
          .split(";")
          .filter(Boolean)
      : [""];
  const directories = (process.env.PATH ?? "")
    .split(delimiter)
    .filter(Boolean);
  return directories.some((directory) => {
    if (existsSync(join(directory, command))) return true;
    return extensions.some((extension) =>
      existsSync(join(directory, `${command}${extension}`)),
    );
  });
}

// `resolveTool` only checks that `@playcanvas/splat-transform` exists; an env
// override is returned without testing the path. The batch must fail before
// the first clip, with an install hint, so probe the resolved command too.
function assertTool(name) {
  const tool = resolveTool(name);
  if (commandExists(tool.command)) return tool;
  throw new ScanError(
    "tool_missing",
    `Alat ${name} tidak ditemukan. ${TOOL_HINTS[name] ?? ""}`.trim(),
  );
}

function positiveNumber(value, flag) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0)
    throw new Error(`Nilai ${flag} harus angka positif.`);
  return number;
}

function parseArgs(argv) {
  const options = {
    dir: "var/spike/clips",
    root: "var/scans",
    out: "var/spike/results.json",
    only: [],
    limit: null,
    dryRun: false,
    widthCm: DEFAULT_META.widthCm,
    depthCm: DEFAULT_META.depthCm,
    heightCm: DEFAULT_META.heightCm,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`Nilai ${flag} belum diisi.`);
      return argv[index];
    };
    switch (flag) {
      case "--dir":
        options.dir = value();
        break;
      case "--root":
        options.root = value();
        break;
      case "--out":
        options.out = value();
        break;
      case "--only":
        options.only = value()
          .split(",")
          .map((token) => token.trim())
          .filter(Boolean);
        break;
      case "--limit": {
        const limit = Number(value());
        if (!Number.isInteger(limit) || limit < 0)
          throw new Error("Nilai --limit harus bilangan bulat >= 0.");
        options.limit = limit;
        break;
      }
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--w":
        options.widthCm = positiveNumber(value(), flag);
        break;
      case "--d":
        options.depthCm = positiveNumber(value(), flag);
        break;
      case "--h":
        options.heightCm = positiveNumber(value(), flag);
        break;
      default:
        throw new Error(`Argumen tidak dikenal: ${flag}.`);
    }
  }
  return options;
}

function formatRow(row) {
  if (!row.ok) return `${row.clip} | - | - | - | - | - | - | FAILED`;
  const { extracted, registered, ratio, totalMs, splatCount, bytes } =
    row.summary;
  const megabytes =
    bytes === null ? "-" : (bytes / (1024 * 1024)).toFixed(1);
  return [
    row.clip,
    extracted ?? "-",
    registered ?? "-",
    ratio === null ? "-" : `${(ratio * 100).toFixed(1)}%`,
    totalMs ?? "-",
    splatCount ?? "-",
    megabytes,
    "OK",
  ].join(" | ");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  const tools = toolDefaults(repoRoot);
  process.env.SCAN_COLMAP ||= tools.colmap;
  process.env.SCAN_BRUSH ||= tools.brush;
  assertTool("colmap");
  assertTool("brush");

  let clips;
  try {
    clips = await listClips(options.dir);
  } catch {
    console.error(`Folder klip tidak ditemukan: ${options.dir}`);
    process.exitCode = 1;
    return;
  }
  if (clips.length === 0) {
    console.error(
      `Tidak ada klip ${CLIP_EXTENSIONS.join("/")} di ${options.dir}.`,
    );
    process.exitCode = 1;
    return;
  }

  let selected = selectClips(clips, options.only);
  if (options.limit !== null) selected = selected.slice(0, options.limit);
  if (selected.length === 0) {
    console.error(`Tidak ada klip yang cocok: ${options.only.join(", ")}.`);
    process.exitCode = 1;
    return;
  }

  if (options.dryRun) {
    for (const clip of selected) console.log(clip.name);
    return;
  }

  await mkdir(dirname(options.out), { recursive: true });
  const writeResults = async (results) => {
    await writeFile(
      options.out,
      `${JSON.stringify(results, null, 2)}\n`,
      "utf8",
    );
  };
  console.log(
    "clip | extracted | registered | ratio | totalMs | splats | MB | status",
  );
  await runBatch({
    root: options.root,
    clips: selected,
    meta: {
      widthCm: options.widthCm,
      depthCm: options.depthCm,
      heightCm: options.heightCm,
    },
    onProgress: (name, stage) => console.log(`  ${name}: ${stage}`),
    onResult: async (results) => {
      await writeResults(results);
      const row = results.at(-1);
      console.log(formatRow(row));
      if (!row.ok)
        console.error(`  ${row.error.code}: ${row.error.message}`);
    },
  });
}

const entry = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : "";
if (entry === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof ScanError ? error.message : error?.message ?? error);
    process.exitCode = 1;
  });
}
