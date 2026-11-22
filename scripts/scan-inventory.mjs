import { execFile } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".m4v"]);
const MIN_SHORT_EDGE = 720;
const MIN_BITRATE = 2_500_000;
const MIN_DURATION_S = 8;
const SHEET_COLUMNS = 3;
const SHEET_THUMB_WIDTH = 300;
const MAX_BUFFER = 16 * 1024 * 1024;

const USAGE = `Pemakaian: node scripts/scan-inventory.mjs [--dir var/spike/clips] [--out var/spike]

  --dir   folder berisi klip kamera (*.mp4, *.mov, *.m4v)
  --out   folder keluaran untuk clip-inventory.json, contact-sheet.jpg, dan frames/<slug>/
  --help  tampilkan bantuan ini`;

function round2(value) {
  return Math.round(value * 100) / 100;
}

function parseRate(value) {
  if (typeof value !== "string" || value.length === 0) return 0;
  const [numerator, denominator] = value.split("/").map(Number);
  if (!Number.isFinite(numerator)) return 0;
  const rate = denominator ? numerator / denominator : numerator;
  return Number.isFinite(rate) ? round2(rate) : 0;
}

function formatMbps(bitRate) {
  return (bitRate / 1_000_000).toFixed(1);
}

/**
 * Label a clip as the camera original or a compressed copy, and surface the
 * problems the batch must know about before it runs.
 */
export function classifyClip({ width = 0, height = 0, durationS = 0, bitRate = 0 } = {}) {
  const shortEdge = Math.min(width || 0, height || 0);
  const warnings = [];
  const lowResolution = shortEdge < MIN_SHORT_EDGE;
  const lowBitRate = bitRate < MIN_BITRATE;

  if (lowResolution) {
    warnings.push(
      `Resolusi ${width}×${height} di bawah 720p; minta file original dari pengirim.`,
    );
  }
  if (lowBitRate) {
    warnings.push(
      `Bitrate ${formatMbps(bitRate)} Mbps di bawah 2,5 Mbps; minta file original dari pengirim.`,
    );
  }
  if (durationS > 0 && durationS < MIN_DURATION_S) {
    warnings.push(`Durasi ${durationS} detik; minimal 8 detik.`);
  }

  return {
    quality: lowResolution || lowBitRate ? "compressed" : "original",
    warnings,
  };
}

/** Sample 10 %, 50 % and 90 % of the clip, rounded to two decimals. */
export function frameTimes(durationS, count = 3) {
  const total = Number.isFinite(durationS) ? durationS : 0;
  const samples = Math.max(1, Math.trunc(count) || 3);
  if (samples === 1) return [round2(total / 2)];

  return Array.from({ length: samples }, (_, index) =>
    round2(total * (0.1 + (0.8 * index) / (samples - 1))),
  );
}

function parseArgs(argv) {
  const args = { dir: "var/spike/clips", out: "var/spike" };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help" || token === "-h") {
      return { help: true };
    }
    const [flag, inlineValue] = token.includes("=") ? token.split(/=(.*)/s) : [token, undefined];
    if (flag !== "--dir" && flag !== "--out") {
      throw new Error(`Argumen tidak dikenal: ${token}. ${USAGE}`);
    }
    const value = inlineValue ?? argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Argumen ${flag} butuh nilai.`);
    }
    if (inlineValue === undefined) index += 1;
    args[flag.slice(2)] = value;
  }

  return args;
}

async function run(command, args) {
  try {
    return await execFileAsync(command, args, {
      maxBuffer: MAX_BUFFER,
      windowsHide: true,
    });
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(
        `Perintah ${command} tidak ditemukan; pastikan FFmpeg dan ffprobe ada di PATH.`,
      );
    }
    const detail = (error.stderr || "").trim() || error.message;
    throw new Error(`${command} gagal: ${detail}`);
  }
}

async function listClips(dirPath) {
  let entries;
  try {
    entries = await readdir(dirPath, { withFileTypes: true });
  } catch (error) {
    throw new Error(`Folder klip tidak bisa dibaca: ${dirPath} (${error.code || error.message})`);
  }

  return entries
    .filter(
      (entry) =>
        entry.isFile() && VIDEO_EXTENSIONS.has(extname(entry.name).toLowerCase()),
    )
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, "en"));
}

async function probeClip(filePath) {
  const { stdout } = await run("ffprobe", [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_streams",
    "-show_format",
    filePath,
  ]);

  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(`ffprobe tidak mengembalikan JSON valid untuk ${basename(filePath)}.`);
  }

  const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
  const video = streams.find((stream) => stream.codec_type === "video");
  if (!video) {
    throw new Error(`Tidak ada stream video di ${basename(filePath)}.`);
  }

  const format = parsed.format ?? {};
  const durationS =
    round2(Number.parseFloat(format.duration ?? video.duration)) || 0;
  const fps =
    parseRate(video.r_frame_rate) || parseRate(video.avg_frame_rate) || 0;

  return {
    width: Number(video.width) || 0,
    height: Number(video.height) || 0,
    durationS,
    fps,
    codec: video.codec_name ?? "",
    declaredBitRate: Number(format.bit_rate ?? video.bit_rate) || 0,
  };
}

async function extractFrames({ filePath, durationS, framesDir, relativeDir }) {
  if (!(durationS > 0)) return [];

  await mkdir(framesDir, { recursive: true });
  const frames = [];

  for (const [index, timeSeconds] of frameTimes(durationS).entries()) {
    const fileName = `frame-${index + 1}.jpg`;
    const framePath = join(framesDir, fileName);
    await run("ffmpeg", [
      "-y",
      "-v",
      "error",
      "-ss",
      String(timeSeconds),
      "-i",
      filePath,
      "-frames:v",
      "1",
      "-q:v",
      "2",
      framePath,
    ]);
    const info = await stat(framePath);
    if (info.size === 0) {
      throw new Error(`Frame kosong untuk ${basename(filePath)} pada ${timeSeconds} detik.`);
    }
    frames.push({ timeSeconds, file: `${relativeDir}/${fileName}` });
  }

  return frames;
}

async function buildContactSheet(framePaths, sheetPath) {
  if (framePaths.length === 0) {
    return { file: null, count: 0, bytes: 0, tile: null };
  }

  const tempDir = await mkdtemp(join(tmpdir(), "lihatdulu-scan-sheet-"));
  try {
    for (const [index, framePath] of framePaths.entries()) {
      const numbered = `f${String(index + 1).padStart(2, "0")}.jpg`;
      await copyFile(framePath, join(tempDir, numbered));
    }

    const rows = Math.max(1, Math.ceil(framePaths.length / SHEET_COLUMNS));
    const tile = `${SHEET_COLUMNS}x${rows}`;
    await mkdir(dirname(sheetPath), { recursive: true });
    await run("ffmpeg", [
      "-y",
      "-v",
      "error",
      "-framerate",
      "1",
      "-i",
      join(tempDir, "f%02d.jpg"),
      "-vf",
      `scale=${SHEET_THUMB_WIDTH}:-1,tile=${tile}:padding=4:margin=4`,
      "-frames:v",
      "1",
      sheetPath,
    ]);

    const info = await stat(sheetPath);
    if (info.size === 0) {
      throw new Error(`Contact sheet kosong: ${sheetPath}.`);
    }
    return { file: sheetPath, count: framePaths.length, bytes: info.size, tile };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function formatTableRow(clip) {
  const resolution = `${clip.width}×${clip.height}`;
  return [
    clip.file.padEnd(30),
    `${clip.durationS.toFixed(2)} s`.padEnd(9),
    resolution.padEnd(11),
    clip.fps.toFixed(2).padEnd(6),
    `${formatMbps(clip.bitRate)} Mbps`.padEnd(10),
    clip.quality.padEnd(10),
    clip.warnings.join("; ") || "-",
  ].join(" | ");
}

async function main(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(USAGE);
    return;
  }

  const clipsDir = resolve(args.dir);
  const outDir = resolve(args.out);
  const frameRoot = join(outDir, "frames");
  const sheetPath = join(outDir, "contact-sheet.jpg");

  const names = await listClips(clipsDir);
  if (names.length === 0) {
    throw new Error(`Tidak ada klip ${[...VIDEO_EXTENSIONS].join("/")} di ${clipsDir}.`);
  }

  const clips = [];
  const framePaths = [];

  for (const name of names) {
    const filePath = join(clipsDir, name);
    const slug = basename(name, extname(name));
    const fileInfo = await stat(filePath);
    const probe = await probeClip(filePath);
    const bitRate =
      probe.declaredBitRate ||
      (probe.durationS > 0 ? Math.round((fileInfo.size * 8) / probe.durationS) : 0);
    const { quality, warnings } = classifyClip({
      width: probe.width,
      height: probe.height,
      durationS: probe.durationS,
      bitRate,
    });

    const frames = await extractFrames({
      filePath,
      durationS: probe.durationS,
      framesDir: join(frameRoot, slug),
      relativeDir: `frames/${slug}`,
    });

    if (frames.length === 0) {
      warnings.push("Durasi tidak terbaca; frame tidak diekstrak.");
    }

    const clip = {
      file: name,
      sizeBytes: fileInfo.size,
      width: probe.width,
      height: probe.height,
      durationS: probe.durationS,
      fps: probe.fps,
      codec: probe.codec,
      bitRate,
      quality,
      warnings,
      frames,
    };
    clips.push(clip);

    for (const frame of frames) {
      framePaths.push(join(outDir, frame.file));
    }

    console.log(formatTableRow(clip));
  }

  const sheet = await buildContactSheet(framePaths, sheetPath);
  const inventoryPath = join(outDir, "clip-inventory.json");
  await writeFile(inventoryPath, `${JSON.stringify(clips, null, 2)}\n`, "utf8");

  const originalCount = clips.filter((clip) => clip.quality === "original").length;
  console.log("");
  console.log(`Klip: ${clips.length} · original ${originalCount} · compressed ${clips.length - originalCount}`);
  console.log(`Inventaris: ${inventoryPath}`);
  if (sheet.file) {
    console.log(
      `Contact sheet: ${sheet.file} (${sheet.count} frame, ${sheet.bytes} byte, tile ${sheet.tile})`,
    );
  } else {
    console.log("Contact sheet: tidak dibuat (tidak ada frame).");
  }
}

const isMain =
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`Inventaris gagal: ${error.message}`);
    process.exitCode = 1;
  });
}
