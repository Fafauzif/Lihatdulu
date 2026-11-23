import { inflateRawSync } from "node:zlib";
import { KiriError } from "./kiri-errors.mjs";

// KIRI returns a ZIP and we cannot add a runtime dependency just to open it.
// This reads the central directory, verifies CRC32 and inflates raw DEFLATE.
// It deliberately supports only what a KIRI 3DGS export contains (stored or
// deflated files, no encryption, no ZIP64) and refuses absolute or `..` names.

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const MAX_ENTRIES = 2_000;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1)
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

export function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function findEndOfCentralDirectory(buffer) {
  const start = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= start; offset -= 1)
    if (buffer.readUInt32LE(offset) === EOCD) return offset;
  throw new KiriError("zip_invalid", { detail: "EOCD tidak ditemukan." });
}

function safeName(name) {
  const normalised = name.replace(/\\/g, "/");
  if (
    !normalised ||
    normalised.startsWith("/") ||
    /^[A-Za-z]:/.test(normalised) ||
    normalised.split("/").some((part) => part === "..")
  )
    throw new KiriError("zip_invalid", { detail: `Nama entri ditolak: ${name}` });
  return normalised;
}

export function listZipEntries(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22)
    throw new KiriError("zip_invalid", { detail: "Berkas terlalu kecil." });
  const eocd = findEndOfCentralDirectory(buffer);
  const total = buffer.readUInt16LE(eocd + 10);
  const directoryOffset = buffer.readUInt32LE(eocd + 16);
  if (total === 0)
    throw new KiriError("zip_invalid", { detail: "ZIP tidak berisi berkas." });
  if (total > MAX_ENTRIES)
    throw new KiriError("zip_invalid", { detail: "ZIP berisi terlalu banyak berkas." });

  const entries = [];
  let cursor = directoryOffset;
  for (let index = 0; index < total; index += 1) {
    if (buffer.readUInt32LE(cursor) !== CENTRAL)
      throw new KiriError("zip_invalid", { detail: "Central directory rusak." });
    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    const crc = buffer.readUInt32LE(cursor + 16);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = safeName(buffer.toString("utf8", cursor + 46, cursor + 46 + nameLength));
    if (flags & 0x1)
      throw new KiriError("zip_invalid", { detail: "ZIP terenkripsi tidak didukung." });
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff)
      throw new KiriError("zip_invalid", { detail: "ZIP64 tidak didukung." });
    entries.push({
      name,
      method,
      crc,
      compressedSize,
      uncompressedSize,
      localOffset,
      directory: name.endsWith("/"),
    });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

export function readZipEntry(buffer, entry) {
  const offset = entry.localOffset;
  if (buffer.readUInt32LE(offset) !== LOCAL)
    throw new KiriError("zip_invalid", { detail: `Header lokal ${entry.name} rusak.` });
  const nameLength = buffer.readUInt16LE(offset + 26);
  const extraLength = buffer.readUInt16LE(offset + 28);
  const start = offset + 30 + nameLength + extraLength;
  const end = start + entry.compressedSize;
  if (end > buffer.length)
    throw new KiriError("zip_invalid", { detail: `Entri ${entry.name} terpotong.` });
  const raw = buffer.subarray(start, end);
  let data;
  if (entry.method === 0) data = Buffer.from(raw);
  else if (entry.method === 8) {
    try {
      data = inflateRawSync(raw);
    } catch (error) {
      throw new KiriError("zip_invalid", {
        cause: error,
        detail: `Entri ${entry.name} gagal di-inflate.`,
      });
    }
  } else
    throw new KiriError("zip_invalid", {
      detail: `Metode kompresi ${entry.method} tidak didukung.`,
    });
  if (data.length !== entry.uncompressedSize)
    throw new KiriError("zip_invalid", { detail: `Ukuran ${entry.name} tidak cocok.` });
  if (crc32(data) !== entry.crc)
    throw new KiriError("zip_invalid", { detail: `CRC ${entry.name} tidak cocok.` });
  return data;
}

// Picks the splat file KIRI packs: the largest `.ply`, preferring a
// `point_cloud` path when a ZIP carries several.
export function pickSplatEntry(entries) {
  const ply = entries.filter(
    (entry) => !entry.directory && /\.ply$/i.test(entry.name),
  );
  if (!ply.length)
    throw new KiriError("zip_invalid", {
      detail: "ZIP tidak berisi berkas .ply.",
    });
  return ply.sort((left, right) => {
    const preferred = (entry) =>
      /point[_-]?cloud/i.test(entry.name) ? 1 : 0;
    const byPreference = preferred(right) - preferred(left);
    if (byPreference) return byPreference;
    return right.uncompressedSize - left.uncompressedSize;
  })[0];
}

// The featureless-object pipeline returns a mesh, not splats: one GLB plus the
// camera set. Pick the largest GLB when a ZIP carries more than one.
export function pickModelEntry(entries) {
  const models = entries.filter(
    (entry) => !entry.directory && /\.glb$/i.test(entry.name),
  );
  if (!models.length)
    throw new KiriError("zip_invalid", {
      detail: "ZIP tidak berisi berkas .glb.",
    });
  return models.sort(
    (left, right) => right.uncompressedSize - left.uncompressedSize,
  )[0];
}

export function extractModel(buffer, { maxBytes = 240 * 1024 * 1024 } = {}) {
  const entries = listZipEntries(buffer);
  const entry = pickModelEntry(entries);
  if (entry.uncompressedSize > maxBytes)
    throw new KiriError("artifact_too_large", {
      detail: `GLB ${entry.uncompressedSize} byte melebihi batas.`,
    });
  return { name: entry.name, data: readZipEntry(buffer, entry) };
}

export function extractSplat(buffer, { maxBytes = 400 * 1024 * 1024 } = {}) {
  const entries = listZipEntries(buffer);
  const entry = pickSplatEntry(entries);
  if (entry.uncompressedSize > maxBytes)
    throw new KiriError("artifact_too_large", {
      detail: `PLY ${entry.uncompressedSize} byte melebihi batas.`,
    });
  return { name: entry.name, data: readZipEntry(buffer, entry) };
}
