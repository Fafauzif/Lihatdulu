import { ScanError } from "./scan-errors.mjs";

// Opt-in subject cleanup for room-scale scans.
//
// The recorded chair takes reconstruct the whole room: a 1-99 percentile fit
// still spans 14-32 reconstruction units while the chair is a small part of
// it. The only cleanup that isolated the subject in the overnight study was a
// sphere around the piece of furniture, positioned from the aligned camera
// axes (least-squares intersection of every camera's optical axis) and sized
// from the distance spread of the opaque splats.
//
// Everything here is CPU-only and independent of COLMAP/Brush so it can be
// unit tested directly. The profile is opt-in: SCAN_PROFILE=chair.

export const CHAIR_PROFILE = Object.freeze({
  name: "chair",
  // Radius rule calibrated on the 2026-11-22 study: 0.9 x the 90th percentile
  // radius of the opaque subject mass, clamped to a plausible chair size.
  radiusFactor: 0.9,
  minRadius: 1.8,
  maxRadius: 2.7,
  // Splats considered opaque enough to belong to the subject when measuring
  // that spread, and how far from the ray target they are searched for.
  opaqueAlpha: 0.2,
  probeRadius: 3.0,
  // A cleanup that keeps less than this cannot be a chair.
  minKeptSplats: 200,
});

const PLY_TYPES = Object.freeze({
  float: { size: 4, read: "readFloatLE", write: "writeFloatLE" },
  double: { size: 8, read: "readDoubleLE", write: "writeDoubleLE" },
  uchar: { size: 1, read: "readUInt8", write: "writeUInt8" },
  uint8: { size: 1, read: "readUInt8", write: "writeUInt8" },
  int: { size: 4, read: "readInt32LE", write: "writeInt32LE" },
  int32: { size: 4, read: "readInt32LE", write: "writeInt32LE" },
  uint: { size: 4, read: "readUInt32LE", write: "writeUInt32LE" },
  uint32: { size: 4, read: "readUInt32LE", write: "writeUInt32LE" },
  short: { size: 2, read: "readInt16LE", write: "writeInt16LE" },
});

export class CleanupError extends ScanError {
  constructor(message) {
    super("cleanup_failed", message);
  }
}

// COLMAP stores quaternions as (qw, qx, qy, qz) and poses as world-to-camera
// X_c = R * X_w + t, so the camera centre is -R^T t and its viewing axis is
// R^T * (0, 0, 1).
export function quaternionToRotation([qw, qx, qy, qz]) {
  const norm = Math.hypot(qw, qx, qy, qz) || 1;
  const w = qw / norm;
  const x = qx / norm;
  const y = qy / norm;
  const z = qz / norm;
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
    [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
    [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
  ];
}

export function cameraPose({ qvec, tvec }) {
  const rotation = quaternionToRotation(qvec);
  const transpose = [0, 1, 2].map((column) =>
    [0, 1, 2].map((row) => rotation[row][column]),
  );
  const apply = (matrix, vector) => [
    matrix[0][0] * vector[0] + matrix[0][1] * vector[1] + matrix[0][2] * vector[2],
    matrix[1][0] * vector[0] + matrix[1][1] * vector[1] + matrix[1][2] * vector[2],
    matrix[2][0] * vector[0] + matrix[2][1] * vector[1] + matrix[2][2] * vector[2],
  ];
  const negate = (vector) => vector.map((value) => -value);
  return {
    center: apply(transpose, negate(tvec)),
    forward: apply(transpose, [0, 0, 1]),
  };
}

// Parse a COLMAP 4.x images.bin: image_id (int32), qvec (4 doubles),
// tvec (3 doubles), camera_id (int32), name (NUL terminated), then the 2D
// observations which this parser skips.
export function parseImagesBin(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8)
    throw new CleanupError("model images.bin kosong.");
  let offset = 0;
  const count = Number(buffer.readBigUInt64LE(offset));
  offset += 8;
  const images = [];
  for (let index = 0; index < count; index += 1) {
    if (offset + 64 > buffer.length)
      throw new CleanupError("model images.bin terpotong.");
    const id = buffer.readInt32LE(offset);
    offset += 4;
    const qvec = [
      buffer.readDoubleLE(offset),
      buffer.readDoubleLE(offset + 8),
      buffer.readDoubleLE(offset + 16),
      buffer.readDoubleLE(offset + 24),
    ];
    offset += 32;
    const tvec = [
      buffer.readDoubleLE(offset),
      buffer.readDoubleLE(offset + 8),
      buffer.readDoubleLE(offset + 16),
    ];
    offset += 24;
    const cameraId = buffer.readInt32LE(offset);
    offset += 4;
    const end = buffer.indexOf(0, offset);
    if (end < 0) throw new CleanupError("model images.bin tanpa nama berkas.");
    const name = buffer.toString("utf8", offset, end);
    offset = end + 1;
    if (offset + 8 > buffer.length)
      throw new CleanupError("model images.bin terpotong.");
    const points = Number(buffer.readBigUInt64LE(offset));
    offset += 8 + points * 24;
    if (offset > buffer.length)
      throw new CleanupError("model images.bin terpotong.");
    images.push({ id, cameraId, name, qvec, tvec });
  }
  return images;
}

// Least-squares point closest to every optical axis:
// sum((I - d d^T)) x = sum((I - d d^T) c).
export function rayTarget(images) {
  const poses = images
    .map((image) => cameraPose(image))
    .filter(
      (pose) =>
        pose.forward.every(Number.isFinite) &&
        pose.center.every(Number.isFinite) &&
        Math.hypot(...pose.forward) > 1e-6,
    );
  if (poses.length < 3)
    throw new CleanupError("model kamera tidak cukup untuk menentukan subjek.");
  const a = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const b = [0, 0, 0];
  for (const { center, forward } of poses) {
    const length = Math.hypot(...forward);
    const d = forward.map((value) => value / length);
    for (let row = 0; row < 3; row += 1) {
      for (let column = 0; column < 3; column += 1) {
        a[row][column] += (row === column ? 1 : 0) - d[row] * d[column];
      }
      b[row] +=
        center[row] -
        d[row] * (d[0] * center[0] + d[1] * center[1] + d[2] * center[2]);
    }
  }
  const solution = solve3(a, b);
  if (!solution || !solution.every(Number.isFinite))
    throw new CleanupError("titik subjek tidak bisa dihitung.");
  return solution;
}

function solve3(matrix, vector) {
  const m = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < 3; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < 3; row += 1)
      if (Math.abs(m[row][column]) > Math.abs(m[pivot][column])) pivot = row;
    if (Math.abs(m[pivot][column]) < 1e-9) return null;
    [m[column], m[pivot]] = [m[pivot], m[column]];
    for (let row = 0; row < 3; row += 1) {
      if (row === column) continue;
      const factor = m[row][column] / m[column][column];
      for (let index = column; index < 4; index += 1)
        m[row][index] -= factor * m[column][index];
    }
  }
  return [m[0][3] / m[0][0], m[1][3] / m[1][1], m[2][3] / m[2][2]];
}

// Minimal binary little-endian PLY reader: every vertex property is read as its
// declared type and written back unchanged, so filtering cannot alter colours,
// rotations or higher-order SH terms.
export function parsePly(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 16)
    throw new CleanupError("berkas .ply kosong.");
  const headerEnd = buffer.indexOf("end_header\n", 0, "latin1");
  const headerLength = headerEnd < 0 ? -1 : headerEnd + "end_header\n".length;
  if (headerLength < 0)
    throw new CleanupError("berkas .ply tanpa header yang dikenali.");
  const header = buffer.toString("latin1", 0, headerLength);
  if (!/format\s+binary_little_endian/.test(header))
    throw new CleanupError("format .ply bukan binary little endian.");
  if (/^element\s+(?!vertex\b)\w+/m.test(header))
    throw new CleanupError("berkas .ply berisi elemen tambahan.");
  const countMatch = /^element\s+vertex\s+(\d+)/m.exec(header);
  if (!countMatch) throw new CleanupError("berkas .ply tanpa elemen vertex.");
  const count = Number(countMatch[1]);
  const properties = [];
  for (const line of header.split(/\r?\n/)) {
    const match = /^property\s+(\w+)\s+(\S+)\s*$/.exec(line.trim());
    if (!match) continue;
    const type = PLY_TYPES[match[1].toLowerCase()];
    if (!type)
      throw new CleanupError(`tipe properti .ply ${match[1]} tidak didukung.`);
    properties.push({ name: match[2], type: match[1].toLowerCase(), ...type });
  }
  const stride = properties.reduce((total, property) => total + property.size, 0);
  if (!properties.length || stride <= 0)
    throw new CleanupError("berkas .ply tanpa properti vertex.");
  if (headerLength + count * stride > buffer.length)
    throw new CleanupError("berkas .ply terpotong.");
  const index = new Map(properties.map((property, position) => [property.name, position]));
  for (const required of ["x", "y", "z"]) {
    if (!index.has(required))
      throw new CleanupError(`berkas .ply tanpa kolom ${required}.`);
  }
  return {
    header,
    headerLength,
    count,
    stride,
    properties,
    index,
    body: buffer.subarray(headerLength, headerLength + count * stride),
  };
}

export function readPlyScalar(ply, vertex, name) {
  const position = ply.index.get(name);
  if (position === undefined) return null;
  let offset = vertex * ply.stride;
  for (let index = 0; index < position; index += 1)
    offset += ply.properties[index].size;
  const property = ply.properties[position];
  return ply.body[property.read](offset);
}

export function plyPositions(ply) {
  const positions = new Float64Array(ply.count * 3);
  for (let vertex = 0; vertex < ply.count; vertex += 1) {
    positions[vertex * 3] = readPlyScalar(ply, vertex, "x");
    positions[vertex * 3 + 1] = readPlyScalar(ply, vertex, "y");
    positions[vertex * 3 + 2] = readPlyScalar(ply, vertex, "z");
  }
  return positions;
}

export function plyOpacity(ply, vertex) {
  const raw = readPlyScalar(ply, vertex, "opacity");
  if (raw === null) return 1;
  // Brush writes opacity as a logit, matching the 3DGS PLY convention.
  return 1 / (1 + Math.exp(-raw));
}

export function percentile(values, fraction) {
  if (!values.length) return Number.NaN;
  const sorted = Float64Array.from(values).sort();
  const position = Math.min(
    sorted.length - 1,
    Math.max(0, (sorted.length - 1) * fraction),
  );
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

// Width of the opaque subject mass around the ray target. The sphere stays
// centred on the camera-axis target, which the 2026-11-22 study measured as the
// better placement; only the radius follows the mass, measured as the 90th
// percentile distance from that mass's own median so a one-sided tail of room
// splats cannot inflate it. Clamped to CHAIR_PROFILE.
export function subjectRadius(ply, centre, profile = CHAIR_PROFILE) {
  const points = [];
  for (let vertex = 0; vertex < ply.count; vertex += 1) {
    const x = readPlyScalar(ply, vertex, "x");
    const y = readPlyScalar(ply, vertex, "y");
    const z = readPlyScalar(ply, vertex, "z");
    if (
      Math.hypot(x - centre[0], y - centre[1], z - centre[2]) >
      profile.probeRadius
    )
      continue;
    if (plyOpacity(ply, vertex) < profile.opaqueAlpha) continue;
    points.push([x, y, z]);
  }
  if (points.length < profile.minKeptSplats)
    throw new CleanupError("massa subjek terlalu kecil untuk diukur.");
  const median = [0, 1, 2].map((axis) =>
    percentile(
      points.map((point) => point[axis]),
      0.5,
    ),
  );
  const distances = points.map((point) =>
    Math.hypot(point[0] - median[0], point[1] - median[1], point[2] - median[2]),
  );
  const spread = percentile(distances, 0.9);
  const radius = Math.min(
    profile.maxRadius,
    Math.max(profile.minRadius, profile.radiusFactor * spread),
  );
  return {
    radius: Math.round(radius * 1000) / 1000,
    spread: Math.round(spread * 1000) / 1000,
    opaqueSplats: points.length,
    massCentre: median.map((value) => Math.round(value * 1000) / 1000),
    rule: `clamp(${profile.radiusFactor} x r90_opaque, ${profile.minRadius}, ${profile.maxRadius})`,
  };
}

export function filterPlySphere(ply, centre, radius) {
  const keep = [];
  for (let vertex = 0; vertex < ply.count; vertex += 1) {
    const dx = readPlyScalar(ply, vertex, "x") - centre[0];
    const dy = readPlyScalar(ply, vertex, "y") - centre[1];
    const dz = readPlyScalar(ply, vertex, "z") - centre[2];
    if (Math.hypot(dx, dy, dz) <= radius) keep.push(vertex);
  }
  const header = ply.header.replace(
    /(^element\s+vertex\s+)\d+/m,
    `$1${keep.length}`,
  );
  const headerBuffer = Buffer.from(header, "latin1");
  const body = Buffer.alloc(keep.length * ply.stride);
  keep.forEach((vertex, position) => {
    ply.body.copy(
      body,
      position * ply.stride,
      vertex * ply.stride,
      (vertex + 1) * ply.stride,
    );
  });
  return { buffer: Buffer.concat([headerBuffer, body]), kept: keep.length };
}

// Full decision for one exported Brush PLY: where the subject is, how far the
// sphere reaches, and what survives.
export function planSubjectCleanup(plyBuffer, rayCentre, profile = CHAIR_PROFILE) {
  const ply = parsePly(plyBuffer);
  const radius = subjectRadius(ply, rayCentre, profile);
  const filtered = filterPlySphere(ply, rayCentre, radius.radius);
  if (filtered.kept < profile.minKeptSplats)
    throw new CleanupError(
      `penyaringan menyisakan ${filtered.kept} splat, kurang dari ${profile.minKeptSplats}.`,
    );
  return {
    buffer: filtered.buffer,
    stats: {
      centre: rayCentre.map((value) => Math.round(value * 1000) / 1000),
      radius: radius.radius,
      spread: radius.spread,
      opaqueSplats: radius.opaqueSplats,
      massCentre: radius.massCentre,
      rule: radius.rule,
      splatsBefore: ply.count,
      splatsAfter: filtered.kept,
      keptRatio: Math.round((filtered.kept / ply.count) * 10000) / 10000,
    },
  };
}

export function resolveProfile(raw) {
  const value = String(raw ?? "").trim().toLowerCase();
  return value === "chair" ? "chair" : "default";
}
