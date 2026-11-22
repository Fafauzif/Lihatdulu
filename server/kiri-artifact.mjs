import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { KiriError, redact } from "./kiri-errors.mjs";

// Everything that touches the KIRI result file. Nothing here needs COLMAP,
// Brush, CUDA or FFmpeg: a PLY goes in, the pinned splat-transform CLI writes
// an SPZ, and both sides are validated before the file is served.

const repoRoot = fileURLToPath(new URL("../", import.meta.url));

export const SPLAT_CLI = join(
  repoRoot,
  "node_modules",
  "@playcanvas",
  "splat-transform",
  "bin",
  "cli.mjs",
);

export const REQUIRED_PLY_PROPERTIES = Object.freeze([
  "x",
  "y",
  "z",
  "f_dc_0",
  "f_dc_1",
  "f_dc_2",
  "opacity",
  "scale_0",
  "scale_1",
  "scale_2",
  "rot_0",
  "rot_1",
  "rot_2",
  "rot_3",
]);

const TYPE_BYTES = {
  char: 1,
  uchar: 1,
  int8: 1,
  uint8: 1,
  short: 2,
  ushort: 2,
  int16: 2,
  uint16: 2,
  int: 4,
  uint: 4,
  int32: 4,
  uint32: 4,
  float: 4,
  float32: 4,
  double: 8,
  float64: 8,
};

const HEADER_LIMIT = 256 * 1024;

export function parsePlyHeader(buffer) {
  const text = buffer.toString("latin1", 0, Math.min(buffer.length, HEADER_LIMIT));
  const end = text.indexOf("end_header");
  if (!text.startsWith("ply") || end === -1)
    throw new KiriError("ply_invalid", { detail: "Header PLY tidak ditemukan." });
  const lineEnd = text.indexOf("\n", end);
  if (lineEnd === -1)
    throw new KiriError("ply_invalid", { detail: "Header PLY terpotong." });
  const header = { format: null, count: 0, properties: [], stride: 0 };
  let vertexBlock = false;
  for (const raw of text.slice(0, lineEnd).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const [keyword, ...rest] = line.split(/\s+/);
    if (keyword === "format") header.format = rest[0];
    else if (keyword === "element") {
      vertexBlock = rest[0] === "vertex";
      if (vertexBlock) header.count = Number(rest[1]) || 0;
    } else if (keyword === "property" && vertexBlock) {
      if (rest[0] === "list")
        throw new KiriError("ply_invalid", {
          detail: "Properti list tidak didukung.",
        });
      const name = rest[1];
      header.properties.push(name);
      header.stride += TYPE_BYTES[rest[0]] ?? 0;
    }
  }
  header.headerBytes = lineEnd + 1;
  return header;
}

export function validateSplatPly(
  buffer,
  { maxBytes = 400 * 1024 * 1024, maxSplats = 2_500_000 } = {},
) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0)
    throw new KiriError("ply_empty", { detail: "PLY kosong." });
  if (buffer.length > maxBytes)
    throw new KiriError("artifact_too_large", {
      detail: `PLY ${buffer.length} byte melebihi batas.`,
    });
  const header = parsePlyHeader(buffer);
  const missing = REQUIRED_PLY_PROPERTIES.filter(
    (name) => !header.properties.includes(name),
  );
  if (missing.length)
    throw new KiriError("ply_invalid", {
      detail: `Properti splat hilang: ${missing.join(", ")}.`,
    });
  if (!Number.isInteger(header.count) || header.count <= 0)
    throw new KiriError("ply_empty", { detail: "PLY tidak berisi titik splat." });
  if (header.count > maxSplats)
    throw new KiriError("artifact_too_large", {
      detail: `${header.count} splat melebihi batas ${maxSplats}.`,
    });
  if (!["binary_little_endian", "binary_big_endian", "ascii"].includes(header.format))
    throw new KiriError("ply_invalid", {
      detail: `Format PLY ${header.format} tidak dikenal.`,
    });
  if (header.format !== "ascii" && header.stride > 0) {
    const expected = header.headerBytes + header.count * header.stride;
    if (buffer.length < expected)
      throw new KiriError("ply_invalid", {
        detail: `PLY terpotong: ${buffer.length} dari ${expected} byte.`,
      });
  }
  return { splatCount: header.count, properties: header.properties };
}

export function validateSpz(
  buffer,
  { maxBytes = 60 * 1024 * 1024, maxSplats = 2_500_000 } = {},
) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 16 || buffer.toString("latin1", 0, 4) !== "NGSP")
    throw new KiriError("spz_invalid", { detail: "Magic SPZ tidak ditemukan." });
  const version = buffer.readUInt32LE(4);
  const splatCount = buffer.readUInt32LE(8);
  if (version < 1 || version > 4)
    throw new KiriError("spz_invalid", { detail: `Versi SPZ ${version} tidak dikenal.` });
  if (!splatCount)
    throw new KiriError("spz_invalid", { detail: "SPZ tanpa splat." });
  if (splatCount > maxSplats)
    throw new KiriError("artifact_too_large", {
      detail: `${splatCount} splat melebihi batas ${maxSplats}.`,
    });
  if (buffer.length > maxBytes)
    throw new KiriError("artifact_too_large", {
      detail: `SPZ ${buffer.length} byte melebihi batas.`,
    });
  return { version, splatCount, bytes: buffer.length };
}

export function buildConvertArgs({ inputPly, outputSpz }) {
  return [inputPly, "--filter-nan", outputSpz];
}

export async function convertPlyToSpz({
  inputPath,
  outputPath,
  timeoutMs = 10 * 60 * 1000,
  cli = SPLAT_CLI,
  spawnImpl = spawn,
} = {}) {
  await mkdir(dirname(outputPath), { recursive: true });
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawnImpl(process.execPath, [cli, ...buildConvertArgs({
      inputPly: inputPath,
      outputSpz: outputPath,
    })], { windowsHide: true, shell: false });
    const tail = [];
    let settled = false;
    const timer = setTimeout(() => {
      child.kill();
      finish(new KiriError("convert_failed", { detail: "Konversi melebihi batas waktu." }));
    }, timeoutMs);
    const capture = (chunk) => {
      for (const line of chunk.toString("utf8").split(/\r?\n/))
        if (line.trim()) tail.push(line.trim());
      while (tail.length > 20) tail.shift();
    };
    function finish(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve({ ms: Date.now() - started });
    }
    child.stdout?.on("data", capture);
    child.stderr?.on("data", capture);
    child.once("error", (error) =>
      finish(new KiriError("convert_failed", { cause: error, detail: redact(error.message) })),
    );
    child.once("close", (code) => {
      if (code === 0) finish();
      else
        finish(
          new KiriError("convert_failed", {
            detail: redact(`kode ${code}: ${tail.slice(-4).join(" ")}`),
          }),
        );
    });
  });
}

export async function downloadToFile(
  url,
  destination,
  { maxBytes = 300 * 1024 * 1024, timeoutMs = 20 * 60 * 1000, fetchImpl = fetch } = {},
) {
  await mkdir(dirname(destination), { recursive: true });
  let response;
  try {
    response = await fetchImpl(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new KiriError("kiri_network", { cause: error, detail: redact(error.message) });
  }
  if (!response.ok)
    throw new KiriError("kiri_network", {
      detail: `Unduhan hasil gagal (HTTP ${response.status}).`,
    });
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared && declared > maxBytes)
    throw new KiriError("artifact_too_large", {
      detail: `ZIP ${declared} byte melebihi batas.`,
    });
  if (!response.body) throw new KiriError("zip_invalid", { detail: "Respons tanpa isi." });

  const file = createWriteStream(destination);
  let bytes = 0;
  try {
    for await (const chunk of Readable.fromWeb(response.body)) {
      bytes += chunk.length;
      if (bytes > maxBytes)
        throw new KiriError("artifact_too_large", {
          detail: `ZIP melebihi ${maxBytes} byte.`,
        });
      if (!file.write(chunk)) await new Promise((resolve) => file.once("drain", resolve));
    }
  } catch (error) {
    file.destroy();
    throw error instanceof KiriError
      ? error
      : new KiriError("kiri_network", { cause: error, detail: redact(error.message) });
  }
  await new Promise((resolve, reject) => {
    file.end(() => resolve());
    file.once("error", reject);
  });
  return { bytes, contentType: response.headers.get("content-type") || "" };
}

export async function fileSize(path) {
  try {
    return (await stat(path)).size;
  } catch {
    return 0;
  }
}
