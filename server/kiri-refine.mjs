import { KiriError } from "./kiri-errors.mjs";

// Pure GLB surgery for KIRI's Photo Scan mesh.
//
// Three defects show up on a real capture: the automatic mask leaves detached
// shards floating beside the subject, the per-patch shading normals disagree
// with the surface (the knit backrest reads as a field of dark blotches), and
// the topology carries micro-seams where photogrammetry patches meet. All three
// are fixable on the CPU without the scan server:
//
//   1. weld by quantised position, union-find the triangles, drop components
//      that are small in triangles *and* small against the model box, so a
//      shard goes and a legitimately separate part (an arm, a shelf) stays;
//   2. recompute angle-weighted vertex normals on the welded surface with a
//      crease threshold, splitting vertices at hard edges and averaging across
//      seams: `normals: "keep"` opts out;
//   3. walk the boundary loops (edges used by one kept triangle) and fan-fill
//      only the loops that are micro-cracks: a perimeter and a span under
//      `gapMaxRatio` of the model diagonal, few vertices, and a fan whose
//      normals agree with the surface it bridges. A handle hole, an open shelf,
//      the open bottom of a shell and the missing arm of a subject stay open.
//
// Afterwards the referenced vertices are centred and scaled to `targetSize`,
// then POSITION / NORMAL / TEXCOORD_0 and the index buffer are re-packed. Every
// other buffer view (the JPEG) is copied as-is, so the texture, the material and
// the node's own transform survive untouched.
//
// Nothing here touches the file system or the network: refineGlb takes a Buffer
// and returns a Buffer. A malformed GLB throws KiriError("model_invalid"); a
// layout the surgery cannot do safely returns { buffer: null, reason } so the
// caller can keep the raw artifact.
//
// A fourth question is measured, not repaired: how much of the model looks
// straight through it. analyzeCoverage voxelises the surface and projects it
// along x, y and z; a silhouette pixel whose whole depth column holds no cell
// is a see-through hole. That is the number the boundary-loop walk above cannot
// give: on a real chair the rims of four visible holes are not one-face edges at
// all (the shell is closed, boundaryEdges is 0), so refineGlb now records the
// coverage before and after its own edits together with a stable verdict,
// COVERAGE_VERDICTS.clean ("bersih") or .perforated ("berlubang"), for the
// server DTO and the UI copy. The holes themselves are left open: this is a
// mesh-backed office chair, and a membrane across a real opening would invent
// surface that the capture never saw.

export const REFINE_DEFAULTS = Object.freeze({
  /** A component is never treated as a fragment above this triangle count. */
  minFragmentTriangles: 8,
  /** Fragment triangle budget, as a share of the largest component's triangles. */
  fragmentTriShare: 0.03,
  /** Fragment diagonal budget, as a share of the model bounding-box diagonal. */
  minFragmentRatio: 0.15,
  /** Largest loop perimeter, as a fraction of the model bounding-box diagonal. */
  gapMaxRatio: 0.02,
  /** Largest loop vertex count that may be filled. */
  gapMaxVertices: 48,
  /** A fan triangle may not stray this far from the surface it bridges, in degrees. */
  fillMaxNormalDeg: 70,
  /** Welding cell size in model units. */
  weldEpsilon: 1e-5,
  /** Largest bounding-box dimension after centring. */
  targetSize: 1,
  /** Crease angle for the smooth-normal pass, in degrees. */
  normalCreaseDeg: 40,
  /** "smooth" recomputes crease-aware normals; "keep" copies the input normals. */
  normals: "smooth",
});

// Knobs for the see-through coverage measurement (analyzeCoverage, and the
// coverageBefore / coverageAfter pair refineGlb records).
export const COVERAGE_DEFAULTS = Object.freeze({
  /** Cells on the longest side of the voxel grid; cells are cubes. */
  grid: 128,
  /** Edge welding for the boundary / non-manifold diagnostics, as a fraction
   *  of the bounding-box diagonal. */
  weldEpsilonRatio: 1e-6,
  /** A preview reads as clean when no more than this share of the silhouette
   *  looks through the geometry: "bersih" <= holeBudget < "berlubang". */
  holeBudget: 0.02,
});

// The two verdict strings are a contract: the server DTO and the UI copy read
// them verbatim. Do not translate or re-case them here.
export const COVERAGE_VERDICTS = Object.freeze({
  clean: "bersih",
  perforated: "berlubang",
});

const AXIS_NAMES = Object.freeze(["x", "y", "z"]);

// Reason codes refineGlb may return instead of a refined buffer. The first four
// are the contract; the rest are extra refusals the same caller handles.
export const REFINE_REASONS = Object.freeze([
  "unsupported_attribute",
  "unsupported_accessor",
  "no_triangles",
  "nothing_left",
  "glb_too_large",
  "unsupported_buffer",
  "unsupported_mode",
  "unsupported_extension",
  "unsupported_animation",
  "unsupported_skin",
]);

const GLB_MAGIC = 0x46546c67;
const GLB_JSON = 0x4e4f534a;
const GLB_BIN = 0x004e4942;
const GLB_HEADER_BYTES = 12;
const GLB_CHUNK_HEADER_BYTES = 8;
const MAX_GLB_BYTES = 240 * 1024 * 1024;

const FLOAT = 5126;
const UNSIGNED_BYTE = 5121;
const UNSIGNED_SHORT = 5123;
const UNSIGNED_INT = 5125;

const TYPE_COMPONENTS = Object.freeze({
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT2: 4,
  MAT3: 9,
  MAT4: 16,
});

const KEPT_ATTRIBUTES = new Set(["POSITION", "NORMAL", "TEXCOORD_0"]);
const COMPRESSED_EXTENSIONS = new Set([
  "KHR_draco_mesh_compression",
  "EXT_meshopt_compression",
]);

const pad4 = (value) => (value + 3) & ~3;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function round6(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 1e6) / 1e6;
}

function numberArray(values) {
  return values.map((value) => round6(value));
}

// Thrown internally for a layout the surgery must not touch. refineGlb turns it
// into { buffer: null, metrics: null, reason } instead of failing the request.
class RefineSkip extends Error {
  constructor(reason, detail) {
    super(detail ?? reason);
    this.name = "RefineSkip";
    this.reason = reason;
    this.detail = detail ?? null;
  }
}

function skip(reason, detail) {
  throw new RefineSkip(reason, detail);
}

function unsupportedAccessor(detail) {
  skip("unsupported_accessor", detail);
}

function normalizeOptions(options) {
  const source = options && typeof options === "object" ? options : {};
  const pick = (key) => (Number.isFinite(source[key]) ? source[key] : REFINE_DEFAULTS[key]);
  return Object.freeze({
    minFragmentTriangles: Math.max(0, pick("minFragmentTriangles")),
    fragmentTriShare: clamp(pick("fragmentTriShare"), 0, 1),
    minFragmentRatio: clamp(pick("minFragmentRatio"), 0, 1),
    gapMaxRatio: Math.max(0, pick("gapMaxRatio")),
    gapMaxVertices: Math.max(3, Math.floor(pick("gapMaxVertices"))),
    fillMaxNormalDeg: clamp(pick("fillMaxNormalDeg"), 0, 180),
    weldEpsilon: Math.max(1e-12, pick("weldEpsilon")),
    targetSize: pick("targetSize") > 0 ? pick("targetSize") : REFINE_DEFAULTS.targetSize,
    normalCreaseDeg: clamp(pick("normalCreaseDeg"), 0, 180),
    normals: source.normals === "keep" ? "keep" : "smooth",
    coverageGrid: clamp(
      Math.round(
        Number.isFinite(source.coverageGrid) ? source.coverageGrid : COVERAGE_DEFAULTS.grid,
      ),
      8,
      512,
    ),
    holeBudget: clamp(
      Number.isFinite(source.holeBudget) ? source.holeBudget : COVERAGE_DEFAULTS.holeBudget,
      0,
      1,
    ),
  });
}

// --- GLB container ---------------------------------------------------------

/**
 * Split a GLB into its JSON document and its BIN chunk.
 * Throws KiriError("model_invalid") for a bad magic, a truncated file, an
 * unreadable JSON chunk or a missing BIN chunk.
 */
export function parseGlbChunks(buffer) {
  if (!Buffer.isBuffer(buffer))
    throw new KiriError("model_invalid", { detail: "GLB bukan Buffer." });
  if (buffer.length < GLB_HEADER_BYTES + GLB_CHUNK_HEADER_BYTES)
    throw new KiriError("model_invalid", { detail: "Berkas GLB terlalu kecil." });
  if (buffer.readUInt32LE(0) !== GLB_MAGIC)
    throw new KiriError("model_invalid", { detail: "Magic GLB tidak ditemukan." });
  const version = buffer.readUInt32LE(4);
  if (version !== 2)
    throw new KiriError("model_invalid", { detail: `Versi GLB ${version} tidak dikenal.` });
  const declared = buffer.readUInt32LE(8);
  if (declared < GLB_HEADER_BYTES + GLB_CHUNK_HEADER_BYTES)
    throw new KiriError("model_invalid", {
      detail: `Panjang GLB ${declared} byte tidak masuk akal.`,
    });
  if (declared > buffer.length)
    throw new KiriError("model_invalid", {
      detail: `GLB terpotong: ${buffer.length} dari ${declared} byte.`,
    });

  let offset = GLB_HEADER_BYTES;
  let json = null;
  let bin = null;
  while (offset + GLB_CHUNK_HEADER_BYTES <= declared) {
    const chunkLength = buffer.readUInt32LE(offset);
    const chunkType = buffer.readUInt32LE(offset + 4);
    const start = offset + GLB_CHUNK_HEADER_BYTES;
    const end = start + chunkLength;
    if (end > declared || end > buffer.length)
      throw new KiriError("model_invalid", { detail: "Chunk GLB terpotong." });
    if (chunkType === GLB_JSON && json === null) {
      let parsed;
      try {
        parsed = JSON.parse(buffer.toString("utf8", start, end));
      } catch (error) {
        throw new KiriError("model_invalid", {
          cause: error,
          detail: "Chunk JSON GLB tidak bisa dibaca.",
        });
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        throw new KiriError("model_invalid", { detail: "Chunk JSON GLB bukan objek glTF." });
      json = parsed;
    } else if (chunkType === GLB_BIN && bin === null) {
      bin = buffer.subarray(start, end);
    }
    // Chunk lengths are 4-byte aligned by spec; tolerate a writer that forgot.
    offset = end + ((4 - (chunkLength % 4)) % 4);
  }
  if (json === null)
    throw new KiriError("model_invalid", { detail: "Chunk JSON GLB tidak ditemukan." });
  if (bin === null)
    throw new KiriError("model_invalid", { detail: "Chunk BIN GLB tidak ditemukan." });
  return { json, bin };
}

/**
 * Write a GLB: 12-byte header, JSON chunk padded with 0x20, BIN chunk padded
 * with 0x00. Exported so callers and tests can round-trip a parsed document.
 */
export function buildGlb({ json, bin } = {}) {
  if (!json || typeof json !== "object" || Array.isArray(json))
    throw new TypeError("buildGlb butuh objek JSON glTF.");
  let binBytes;
  if (bin == null) binBytes = Buffer.alloc(0);
  else if (Buffer.isBuffer(bin)) binBytes = bin;
  else if (ArrayBuffer.isView(bin)) binBytes = Buffer.from(bin.buffer, bin.byteOffset, bin.byteLength);
  else throw new TypeError("buildGlb butuh BIN berupa Buffer.");

  const jsonBytes = Buffer.from(JSON.stringify(json), "utf8");
  const jsonLength = pad4(jsonBytes.length);
  const binLength = pad4(binBytes.length);
  const total =
    GLB_HEADER_BYTES + GLB_CHUNK_HEADER_BYTES + jsonLength + GLB_CHUNK_HEADER_BYTES + binLength;
  const out = Buffer.alloc(total);
  out.writeUInt32LE(GLB_MAGIC, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(total, 8);
  out.writeUInt32LE(jsonLength, 12);
  out.writeUInt32LE(GLB_JSON, 16);
  jsonBytes.copy(out, 20);
  out.fill(0x20, 20 + jsonBytes.length, 20 + jsonLength);
  const binAt = 20 + jsonLength;
  out.writeUInt32LE(binLength, binAt);
  out.writeUInt32LE(GLB_BIN, binAt + 4);
  binBytes.copy(out, binAt + 8);
  return out;
}

// --- accessor decoding -----------------------------------------------------

function accessorLayout(json, bin, accessorIndex, elementBytes, label) {
  const accessor = Array.isArray(json.accessors) ? json.accessors[accessorIndex] : null;
  if (!accessor || typeof accessor !== "object")
    unsupportedAccessor(`${label}: accessor ${accessorIndex} tidak ada.`);
  if (accessor.sparse) unsupportedAccessor(`${label}: sparse accessor tidak didukung.`);
  if (accessor.extensions) unsupportedAccessor(`${label}: ekstensi accessor tidak didukung.`);
  const count = accessor.count;
  if (!Number.isInteger(count) || count < 0)
    unsupportedAccessor(`${label}: count accessor tidak valid.`);
  const viewIndex = accessor.bufferView;
  const view = Number.isInteger(viewIndex) ? json.bufferViews?.[viewIndex] : null;
  if (!view || typeof view !== "object")
    unsupportedAccessor(`${label}: bufferView accessor tidak ada.`);
  if (view.extensions) unsupportedAccessor(`${label}: ekstensi bufferView tidak didukung.`);
  if ((view.buffer ?? 0) !== 0)
    unsupportedAccessor(`${label}: bufferView bukan bagian buffer GLB.`);
  const viewOffset = Number.isInteger(view.byteOffset) ? view.byteOffset : 0;
  const viewLength = view.byteLength;
  if (!Number.isInteger(viewLength) || viewLength < 0)
    unsupportedAccessor(`${label}: byteLength bufferView tidak valid.`);
  const stride =
    Number.isInteger(view.byteStride) && view.byteStride > 0 ? view.byteStride : elementBytes;
  if (stride < elementBytes)
    unsupportedAccessor(`${label}: byteStride lebih kecil dari elemen.`);
  const accessorOffset = Number.isInteger(accessor.byteOffset) ? accessor.byteOffset : 0;
  const start = viewOffset + accessorOffset;
  const end = start + (count === 0 ? 0 : (count - 1) * stride + elementBytes);
  if (end > viewOffset + viewLength || end > bin.length)
    unsupportedAccessor(`${label}: accessor melewati isi buffer.`);
  return { accessor, count, start, stride };
}

function readFloatAccessor(json, bin, accessorIndex, type, components, label) {
  const { accessor, count, start, stride } = accessorLayout(
    json,
    bin,
    accessorIndex,
    4 * components,
    label,
  );
  if (TYPE_COMPONENTS[accessor.type] !== components)
    unsupportedAccessor(`${label}: tipe ${accessor.type} bukan ${type}.`);
  if (accessor.componentType !== FLOAT)
    unsupportedAccessor(`${label}: componentType ${accessor.componentType} bukan float32.`);
  if (accessor.normalized) unsupportedAccessor(`${label}: accessor ternormalisasi.`);
  const data = new Float32Array(count * components);
  const elementBytes = 4 * components;
  const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  if (stride === elementBytes) {
    const absolute = bin.byteOffset + start;
    if (absolute % 4 === 0) {
      data.set(new Float32Array(bin.buffer, absolute, count * components));
    } else {
      for (let i = 0; i < data.length; i++) data[i] = view.getFloat32(start + i * 4, true);
    }
    return data;
  }
  for (let i = 0; i < count; i++) {
    for (let component = 0; component < components; component++) {
      data[i * components + component] = view.getFloat32(
        start + i * stride + component * 4,
        true,
      );
    }
  }
  return data;
}

function readIndexAccessor(json, bin, accessorIndex, label) {
  const bytesPerIndex = { [UNSIGNED_BYTE]: 1, [UNSIGNED_SHORT]: 2, [UNSIGNED_INT]: 4 };
  const accessor = Array.isArray(json.accessors) ? json.accessors[accessorIndex] : null;
  if (!accessor || typeof accessor !== "object")
    unsupportedAccessor(`${label}: accessor indeks tidak ada.`);
  const size = bytesPerIndex[accessor.componentType];
  if (!size) unsupportedAccessor(`${label}: componentType indeks tidak didukung.`);
  const { count, start, stride } = accessorLayout(json, bin, accessorIndex, size, label);
  if (accessor.type !== "SCALAR") unsupportedAccessor(`${label}: indeks bukan SCALAR.`);
  if (stride !== size) unsupportedAccessor(`${label}: indeks memakai byteStride.`);
  const data = new Uint32Array(count);
  const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  for (let i = 0; i < count; i++) {
    const at = start + i * size;
    if (size === 1) data[i] = view.getUint8(at);
    else if (size === 2) data[i] = view.getUint16(at, true);
    else data[i] = view.getUint32(at, true);
  }
  return data;
}

function isDroppableAttribute(name) {
  if (name === "TANGENT") return true;
  if (/^COLOR_[0-7]$/.test(name)) return true;
  if (/^TEXCOORD_[1-9]\d*$/.test(name)) return true;
  return name.startsWith("_");
}

// --- geometry helpers ------------------------------------------------------

function asPositions(value) {
  if (value instanceof Float32Array) return value;
  if (ArrayBuffer.isView(value) || Array.isArray(value)) return Float32Array.from(value);
  throw new KiriError("model_invalid", { detail: "POSITION harus Float32Array." });
}

function asIndices(value) {
  if (value instanceof Uint32Array || value instanceof Uint16Array) return value;
  if (ArrayBuffer.isView(value) || Array.isArray(value)) return Uint32Array.from(value);
  throw new KiriError("model_invalid", { detail: "indeks harus Uint16Array atau Uint32Array." });
}

function weldPositions(positions, vertexCount, epsilon) {
  const inverse = 1 / epsilon;
  const rep = new Uint32Array(vertexCount);
  const qx = new Int32Array(vertexCount);
  const qy = new Int32Array(vertexCount);
  const qz = new Int32Array(vertexCount);
  let tableSize = 16;
  while (tableSize < vertexCount * 2) tableSize <<= 1;
  const table = new Int32Array(tableSize).fill(-1);
  const mask = tableSize - 1;
  const cell = (value) => (Number.isFinite(value) ? Math.round(value * inverse) : 0);
  for (let i = 0; i < vertexCount; i++) {
    const x = cell(positions[i * 3]);
    const y = cell(positions[i * 3 + 1]);
    const z = cell(positions[i * 3 + 2]);
    qx[i] = x;
    qy[i] = y;
    qz[i] = z;
    let slot = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) & mask;
    let found = -1;
    for (;;) {
      const probe = table[slot];
      if (probe === -1) {
        table[slot] = i;
        break;
      }
      if (qx[probe] === x && qy[probe] === y && qz[probe] === z) {
        found = probe;
        break;
      }
      slot = (slot + 1) & mask;
    }
    rep[i] = found === -1 ? i : rep[found];
  }
  return rep;
}

function rawBoundsFrom(min, max) {
  const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  return {
    min,
    max,
    size,
    centre: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
  };
}

function describeBounds(bounds) {
  return {
    min: numberArray(bounds.min),
    max: numberArray(bounds.max),
    size: numberArray(bounds.size),
    centre: numberArray(bounds.centre),
  };
}

// Bounds over the final index list: kept vertices from the input buffer plus the
// vertices the fill appended, in the same order the buffer will be written.
function boundsFromIndexList(positions, addedPositions, vertexBase, indexList) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const point = new Float64Array(3);
  for (let i = 0; i < indexList.length; i++) {
    const value = indexList[i];
    if (value < vertexBase) {
      point[0] = positions[value * 3];
      point[1] = positions[value * 3 + 1];
      point[2] = positions[value * 3 + 2];
    } else {
      const at = (value - vertexBase) * 3;
      point[0] = addedPositions[at];
      point[1] = addedPositions[at + 1];
      point[2] = addedPositions[at + 2];
    }
    for (let axis = 0; axis < 3; axis++) {
      if (!Number.isFinite(point[axis])) continue;
      if (point[axis] < min[axis]) min[axis] = point[axis];
      if (point[axis] > max[axis]) max[axis] = point[axis];
    }
  }
  for (let axis = 0; axis < 3; axis++) {
    if (!Number.isFinite(min[axis])) {
      min[axis] = 0;
      max[axis] = 0;
    }
  }
  return rawBoundsFrom(min, max);
}

function faceNormal(positions, a, b, c, out) {
  const ax = positions[a * 3];
  const ay = positions[a * 3 + 1];
  const az = positions[a * 3 + 2];
  const ux = positions[b * 3] - ax;
  const uy = positions[b * 3 + 1] - ay;
  const uz = positions[b * 3 + 2] - az;
  const vx = positions[c * 3] - ax;
  const vy = positions[c * 3 + 1] - ay;
  const vz = positions[c * 3 + 2] - az;
  out[0] = uy * vz - uz * vy;
  out[1] = uz * vx - ux * vz;
  out[2] = ux * vy - uy * vx;
  return Math.hypot(out[0], out[1], out[2]);
}

function polygonArea(positions, vertices) {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i] * 3;
    const b = vertices[(i + 1) % vertices.length] * 3;
    nx += (positions[a + 1] - positions[b + 1]) * (positions[a + 2] + positions[b + 2]);
    ny += (positions[a + 2] - positions[b + 2]) * (positions[a] + positions[b]);
    nz += (positions[a] - positions[b]) * (positions[a + 1] + positions[b + 1]);
  }
  return Math.hypot(nx, ny, nz) / 2;
}

function loopPerimeter(positions, vertices) {
  let total = 0;
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i] * 3;
    const b = vertices[(i + 1) % vertices.length] * 3;
    total += Math.hypot(
      positions[a] - positions[b],
      positions[a + 1] - positions[b + 1],
      positions[a + 2] - positions[b + 2],
    );
  }
  return total;
}

function loopBounds(positions, vertices) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const vertex of vertices) {
    for (let axis = 0; axis < 3; axis++) {
      const value = positions[vertex * 3 + axis];
      if (!Number.isFinite(value)) continue;
      if (value < min[axis]) min[axis] = value;
      if (value > max[axis]) max[axis] = value;
    }
  }
  for (let axis = 0; axis < 3; axis++) {
    if (!Number.isFinite(min[axis])) {
      min[axis] = 0;
      max[axis] = 0;
    }
  }
  return rawBoundsFrom(min, max);
}

function normalize3(values) {
  const length = Math.hypot(values[0], values[1], values[2]);
  if (!(length > 1e-9)) return [0, 1, 0];
  return [values[0] / length, values[1] / length, values[2] / length];
}

/** Interior angle at `a` in the triangle (a, b, c), in radians. */
function cornerAngle(positions, a, b, c) {
  const ax = positions[a * 3];
  const ay = positions[a * 3 + 1];
  const az = positions[a * 3 + 2];
  const ux = positions[b * 3] - ax;
  const uy = positions[b * 3 + 1] - ay;
  const uz = positions[b * 3 + 2] - az;
  const vx = positions[c * 3] - ax;
  const vy = positions[c * 3 + 1] - ay;
  const vz = positions[c * 3 + 2] - az;
  const lu = Math.hypot(ux, uy, uz);
  const lv = Math.hypot(vx, vy, vz);
  if (!(lu > 0) || !(lv > 0)) return 0;
  return Math.acos(clamp((ux * vx + uy * vy + uz * vz) / (lu * lv), -1, 1));
}

/**
 * Recompute smooth vertex normals on the welded mesh.
 *
 * Every face normal is weighted by the interior angle it contributes at a
 * vertex, and the surface is split into smoothing groups: two triangles that
 * share an edge stay in one group while their normals differ by less than
 * `creaseDeg`, and become a hard edge otherwise. A vertex on a hard edge is
 * emitted once per group, so a crease reads sharp.
 *
 * This is what fixes KIRI's shading: its per-patch normals disagree with the
 * surface they belong to (on the probe chair 2.8% of corners were more than
 * 45 degrees off their own triangle, worst 179), and a duplicated seam vertex
 * is averaged across the weld instead of shading as a step.
 *
 * Returns compacted `{ positions, normals, uvs, indices, hardEdges }`.
 */
function smoothCreaseNormals({ positions, indices, uvs, weldEpsilon, creaseDeg }) {
  const vertexCount = positions.length / 3;
  const triangleCount = indices.length / 3;
  const faceNormals = new Float64Array(triangleCount * 3);
  const face = [0, 0, 0];
  for (let t = 0; t < triangleCount; t++) {
    const length = faceNormal(positions, indices[t * 3], indices[t * 3 + 1], indices[t * 3 + 2], face);
    if (!(length > 0)) continue;
    faceNormals[t * 3] = face[0] / length;
    faceNormals[t * 3 + 1] = face[1] / length;
    faceNormals[t * 3 + 2] = face[2] / length;
  }

  const rep = weldPositions(positions, vertexCount, weldEpsilon);
  const edgeKey = (a, b) => (a < b ? a * vertexCount + b : b * vertexCount + a);

  const edges = new Map();
  for (let t = 0; t < triangleCount; t++) {
    for (let corner = 0; corner < 3; corner++) {
      const a = rep[indices[t * 3 + corner]];
      const b = rep[indices[t * 3 + ((corner + 1) % 3)]];
      if (a === b) continue;
      const key = edgeKey(a, b);
      const entry = edges.get(key);
      if (!entry) edges.set(key, { count: 1, f1: t, f2: -1, smooth: false });
      else if (entry.count === 1) {
        entry.count = 2;
        entry.f2 = t;
      } else entry.count += 1;
    }
  }

  const cosCrease = Math.cos(clamp(creaseDeg, 0, 180) * (Math.PI / 180));
  let hardEdges = 0;
  for (const entry of edges.values()) {
    if (entry.count === 1) continue;
    if (entry.count !== 2) {
      // Non-manifold: no honest pair to average, so keep it crisp.
      hardEdges += 1;
      continue;
    }
    const dot =
      faceNormals[entry.f1 * 3] * faceNormals[entry.f2 * 3] +
      faceNormals[entry.f1 * 3 + 1] * faceNormals[entry.f2 * 3 + 1] +
      faceNormals[entry.f1 * 3 + 2] * faceNormals[entry.f2 * 3 + 2];
    if (dot < cosCrease) hardEdges += 1;
    else entry.smooth = true;
  }

  // Vertex -> incident triangles, as a compressed sparse row.
  const counts = new Int32Array(vertexCount);
  for (let t = 0; t < triangleCount; t++) {
    for (let corner = 0; corner < 3; corner++) counts[rep[indices[t * 3 + corner]]] += 1;
  }
  const offsets = new Int32Array(vertexCount + 1);
  for (let i = 0; i < vertexCount; i++) offsets[i + 1] = offsets[i] + counts[i];
  const cursor = Int32Array.from(offsets.subarray(0, vertexCount));
  const incident = new Int32Array(offsets[vertexCount]);
  for (let t = 0; t < triangleCount; t++) {
    for (let corner = 0; corner < 3; corner++) {
      incident[cursor[rep[indices[t * 3 + corner]]]++] = t;
    }
  }
  let maxValence = 0;
  for (let i = 0; i < vertexCount; i++) {
    maxValence = Math.max(maxValence, offsets[i + 1] - offsets[i]);
  }

  const localParent = new Int32Array(Math.max(1, maxValence));
  const rootOf = new Int32Array(Math.max(1, maxValence));
  const normalSum = new Float64Array(Math.max(1, maxValence) * 3);
  const findLocal = (value) => {
    let root = value;
    while (localParent[root] !== root) root = localParent[root];
    while (localParent[value] !== root) {
      const next = localParent[value];
      localParent[value] = root;
      value = next;
    }
    return root;
  };

  const cornerGroup = new Int32Array(triangleCount * 3).fill(-1);
  const cornerNormals = new Float32Array(triangleCount * 9);

  for (let w = 0; w < vertexCount; w++) {
    const start = offsets[w];
    const size = offsets[w + 1] - start;
    if (size === 0) continue;
    for (let i = 0; i < size; i++) {
      localParent[i] = i;
      rootOf[i] = i;
    }
    const localIndexOf = (triangle) => {
      for (let i = 0; i < size; i++) if (incident[start + i] === triangle) return i;
      return -1;
    };
    for (let i = 0; i < size; i++) {
      const t = incident[start + i];
      for (let corner = 0; corner < 3; corner++) {
        if (rep[indices[t * 3 + corner]] !== w) continue;
        for (const shift of [1, 2]) {
          const other = rep[indices[t * 3 + ((corner + shift) % 3)]];
          if (other === w) continue;
          const entry = edges.get(edgeKey(w, other));
          if (!entry || !entry.smooth) continue;
          const i1 = localIndexOf(entry.f1);
          const i2 = localIndexOf(entry.f2);
          if (i1 < 0 || i2 < 0) continue;
          const rootA = findLocal(i1);
          const rootB = findLocal(i2);
          if (rootA !== rootB) localParent[rootB] = rootA;
        }
      }
    }
    for (let i = 0; i < size; i++) {
      rootOf[i] = findLocal(i);
      normalSum[i * 3] = 0;
      normalSum[i * 3 + 1] = 0;
      normalSum[i * 3 + 2] = 0;
    }
    for (let i = 0; i < size; i++) {
      const root = rootOf[i];
      const t = incident[start + i];
      let corner = -1;
      for (let k = 0; k < 3; k++) {
        if (rep[indices[t * 3 + k]] === w) {
          corner = k;
          break;
        }
      }
      if (corner < 0) continue;
      const weight = cornerAngle(
        positions,
        indices[t * 3 + corner],
        indices[t * 3 + ((corner + 1) % 3)],
        indices[t * 3 + ((corner + 2) % 3)],
      );
      normalSum[root * 3] += faceNormals[t * 3] * weight;
      normalSum[root * 3 + 1] += faceNormals[t * 3 + 1] * weight;
      normalSum[root * 3 + 2] += faceNormals[t * 3 + 2] * weight;
    }
    for (let i = 0; i < size; i++) {
      if (rootOf[i] !== i) continue;
      const length = Math.hypot(normalSum[i * 3], normalSum[i * 3 + 1], normalSum[i * 3 + 2]);
      if (length > 1e-12) {
        normalSum[i * 3] /= length;
        normalSum[i * 3 + 1] /= length;
        normalSum[i * 3 + 2] /= length;
      } else {
        normalSum[i * 3] = 0;
        normalSum[i * 3 + 1] = 1;
        normalSum[i * 3 + 2] = 0;
      }
      // The lowest triangle id of the group names it, so slots are stable.
      let group = incident[start + i];
      for (let j = 0; j < size; j++) {
        if (rootOf[j] === i && incident[start + j] < group) group = incident[start + j];
      }
      for (let j = 0; j < size; j++) {
        if (rootOf[j] !== i) continue;
        const t = incident[start + j];
        for (let k = 0; k < 3; k++) {
          if (rep[indices[t * 3 + k]] !== w) continue;
          cornerGroup[t * 3 + k] = group;
          cornerNormals[t * 9 + k * 3] = normalSum[i * 3];
          cornerNormals[t * 9 + k * 3 + 1] = normalSum[i * 3 + 1];
          cornerNormals[t * 9 + k * 3 + 2] = normalSum[i * 3 + 2];
        }
      }
    }
  }

  const slots = new Map();
  const outPositions = [];
  const outNormals = [];
  const outUvs = [];
  const outIndices = new Uint32Array(indices.length);
  for (let t = 0; t < triangleCount; t++) {
    for (let k = 0; k < 3; k++) {
      const vertex = indices[t * 3 + k];
      const group = cornerGroup[t * 3 + k] >= 0 ? cornerGroup[t * 3 + k] : 0;
      const key = vertex * triangleCount + group;
      let slot = slots.get(key);
      if (slot === undefined) {
        slot = outPositions.length / 3;
        slots.set(key, slot);
        outPositions.push(positions[vertex * 3], positions[vertex * 3 + 1], positions[vertex * 3 + 2]);
        outNormals.push(
          cornerNormals[t * 9 + k * 3],
          cornerNormals[t * 9 + k * 3 + 1],
          cornerNormals[t * 9 + k * 3 + 2],
        );
        if (uvs) outUvs.push(uvs[vertex * 2], uvs[vertex * 2 + 1]);
      }
      outIndices[t * 3 + k] = slot;
    }
  }

  return {
    positions: Float32Array.from(outPositions),
    normals: Float32Array.from(outNormals),
    uvs: uvs ? Float32Array.from(outUvs) : null,
    indices: outIndices,
    hardEdges,
  };
}

// --- see-through coverage --------------------------------------------------

/**
 * Voxelise triangle surfaces into a binary grid of cube cells.
 *
 * Each triangle is rasterised through its dominant normal axis, one cell row at
 * a time: the triangle is clipped to the row's band to get the span of cells it
 * can touch, and the triangle's plane is then evaluated at the centre of each
 * of those cells, plus the half-span its two slopes allow, to mark every depth
 * cell the surface crosses. Row spans are exact and plane evaluation needs no
 * division per corner, so a large flat panel costs a row pass per scanline
 * instead of a triangle/square test per cell.
 */
function voxeliseSurface(positions, indices, min, cell, dims) {
  const occupancy = new Uint8Array(dims[0] * dims[1] * dims[2]);
  const stride = [1, dims[0], dims[0] * dims[1]];
  const triangleCount = indices.length / 3;

  for (let t = 0; t < triangleCount; t++) {
    const i0 = indices[t * 3];
    const i1 = indices[t * 3 + 1];
    const i2 = indices[t * 3 + 2];
    const ax = positions[i0 * 3];
    const ay = positions[i0 * 3 + 1];
    const az = positions[i0 * 3 + 2];
    const bx = positions[i1 * 3];
    const by = positions[i1 * 3 + 1];
    const bz = positions[i1 * 3 + 2];
    const cx = positions[i2 * 3];
    const cy = positions[i2 * 3 + 1];
    const cz = positions[i2 * 3 + 2];
    const ex = bx - ax;
    const ey = by - ay;
    const ez = bz - az;
    const fx = cx - ax;
    const fy = cy - ay;
    const fz = cz - az;
    const nx = ey * fz - ez * fy;
    const ny = ez * fx - ex * fz;
    const nz = ex * fy - ey * fx;
    const absX = Math.abs(nx);
    const absY = Math.abs(ny);
    const absZ = Math.abs(nz);
    if (!(absX + absY + absZ > 0)) continue;

    let axis = 0;
    let normal = nx;
    let normalU = ny;
    let normalV = nz;
    if (absY >= absX && absY >= absZ) {
      axis = 1;
      normal = ny;
      normalU = nz;
      normalV = nx;
    } else if (absZ >= absX && absZ >= absY) {
      axis = 2;
      normal = nz;
      normalU = nx;
      normalV = ny;
    }
    if (!(Math.abs(normal) > 0)) continue;

    const u = (axis + 1) % 3;
    const v = (axis + 2) % 3;
    const px = [(ax - min[0]) / cell, (bx - min[0]) / cell, (cx - min[0]) / cell];
    const py = [(ay - min[1]) / cell, (by - min[1]) / cell, (cy - min[1]) / cell];
    const pz = [(az - min[2]) / cell, (bz - min[2]) / cell, (cz - min[2]) / cell];
    const coordinates = [px, py, pz];
    const along = coordinates[u];
    const across = coordinates[v];
    const depth = coordinates[axis];
    const u0 = along[0];
    const u1 = along[1];
    const u2 = along[2];
    const v0 = across[0];
    const v1 = across[1];
    const v2 = across[2];
    const d0 = depth[0];

    const gridU = dims[u];
    const gridV = dims[v];
    const gridD = dims[axis];
    const uLow = clamp(Math.floor(Math.min(u0, u1, u2)), 0, gridU - 1);
    const uHigh = clamp(Math.floor(Math.max(u0, u1, u2)), 0, gridU - 1);
    const vLow = clamp(Math.floor(Math.min(v0, v1, v2)), 0, gridV - 1);
    const vHigh = clamp(Math.floor(Math.max(v0, v1, v2)), 0, gridV - 1);
    const strideU = stride[u];
    const strideV = stride[v];
    const strideD = stride[axis];
    // The triangle's plane as a height field over the (u, v) footprint, and its
    // steepest change across one cell: with both slopes known, a cell's depth
    // range is its centre value plus or minus half that change, so the inner
    // loop needs no division per corner.
    const slopeU = -normalU / normal;
    const slopeV = -normalV / normal;
    const halfSpan = (Math.abs(slopeU) + Math.abs(slopeV)) / 2;
    const us = [u0, u1, u2];
    const vs = [v0, v1, v2];

    for (let iv = vLow; iv <= vHigh; iv++) {
      // Rows are clipped to the band [iv, iv + 1]: only the part of the
      // triangle inside the band can touch that row's cells. Touching counts,
      // so a vertex sitting exactly on a band line is kept.
      const bandLow = iv;
      const bandHigh = iv + 1;
      let low = Infinity;
      let high = -Infinity;
      for (let e = 0; e < 3; e++) {
        const pu = us[e];
        const pv = vs[e];
        if (pv >= bandLow && pv <= bandHigh) {
          if (pu < low) low = pu;
          if (pu > high) high = pu;
        }
        const qu = us[(e + 1) % 3];
        const qv = vs[(e + 1) % 3];
        for (let band = 0; band < 2; band++) {
          const line = band === 0 ? bandLow : bandHigh;
          if ((pv - line) * (qv - line) >= 0) continue;
          const cu = pu + ((line - pv) / (qv - pv)) * (qu - pu);
          if (cu < low) low = cu;
          if (cu > high) high = cu;
        }
      }
      if (!(high >= low)) continue;
      const iuLow = Math.max(uLow, Math.ceil(low) - 1);
      const iuHigh = Math.min(uHigh, Math.floor(high));
      const centreV = iv + 0.5;
      for (let iu = iuLow; iu <= iuHigh; iu++) {
        const centre = d0 + slopeU * (iu + 0.5 - u0) + slopeV * (centreV - v0);
        const kLow = Math.max(0, Math.floor(centre - halfSpan - 1e-9));
        const kHigh = Math.min(gridD - 1, Math.floor(centre + halfSpan + 1e-9));
        const base = iu * strideU + iv * strideV;
        for (let k = kLow; k <= kHigh; k++) occupancy[base + k * strideD] = 1;
      }
    }
  }
  return occupancy;
}

/**
 * The three per-axis footprints, in one pass over the grid.
 *
 * A 2D pixel is set when any cell along its whole depth is occupied. The old
 * way asked that question column by column (three full sweeps of the grid, each
 * up to `dims[axis]` cells deep). Here every occupied cell sets one bit in the
 * column it projects to, once per axis, and a column with any bit set is a
 * silhouette pixel. Same definition, one sweep instead of three.
 */
function projectAxes(occupancy, dims) {
  const plans = [0, 1, 2].map((axis) => {
    const width = dims[(axis + 1) % 3];
    const height = dims[(axis + 2) % 3];
    const words = Math.max(1, Math.ceil(dims[axis] / 32));
    return { width, height, words, bits: new Uint32Array(width * height * words) };
  });
  const [planX, planY, planZ] = plans;
  const nx = dims[0];
  const ny = dims[1];
  const nz = dims[2];
  for (let z = 0; z < nz; z++) {
    const plane = z * nx * ny;
    for (let y = 0; y < ny; y++) {
      let index = plane + y * nx;
      for (let x = 0; x < nx; x++, index++) {
        if (!occupancy[index]) continue;
        // Looking along x: columns run (u = y, v = z), depth is x.
        planX.bits[(z * ny + y) * planX.words + (x >>> 5)] |= 1 << (x & 31);
        // Looking along y: columns run (u = z, v = x), depth is y.
        planY.bits[(x * nz + z) * planY.words + (y >>> 5)] |= 1 << (y & 31);
        // Looking along z: columns run (u = x, v = y), depth is z.
        planZ.bits[(y * nx + x) * planZ.words + (z >>> 5)] |= 1 << (z & 31);
      }
    }
  }
  return plans.map((plan) => {
    const mask = new Uint8Array(plan.width * plan.height);
    for (let column = 0; column < mask.length; column++) {
      const base = column * plan.words;
      for (let word = 0; word < plan.words; word++) {
        if (plan.bits[base + word]) {
          mask[column] = 1;
          break;
        }
      }
    }
    return mask;
  });
}

/**
 * Split a 2D footprint into silhouette and holes.
 *
 * A pixel is background when it is empty and 4-connected to the grid border;
 * every pixel that is not background belongs to the silhouette. A silhouette
 * pixel with no occupancy is a hole: a column through which nothing is seen.
 * `largestHolePixels` is the biggest 4-connected hole region.
 */
function holeStats(mask, width, height) {
  const total = width * height;
  const background = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;
  const seed = (index) => {
    if (mask[index] || background[index]) return;
    background[index] = 1;
    queue[tail++] = index;
  };
  for (let x = 0; x < width; x++) {
    seed(x);
    seed((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    seed(y * width);
    seed(y * width + width - 1);
  }
  while (head < tail) {
    const index = queue[head++];
    const x = index % width;
    const y = (index - x) / width;
    if (x > 0) seed(index - 1);
    if (x + 1 < width) seed(index + 1);
    if (y > 0) seed(index - width);
    if (y + 1 < height) seed(index + width);
  }
  let backgroundPixels = 0;
  for (let i = 0; i < total; i++) if (background[i]) backgroundPixels += 1;

  const seen = new Uint8Array(total);
  let holePixels = 0;
  let largestHolePixels = 0;
  for (let start = 0; start < total; start++) {
    if (mask[start] || background[start] || seen[start]) continue;
    const push = (next) => {
      if (mask[next] || background[next] || seen[next]) return;
      seen[next] = 1;
      queue[tail++] = next;
    };
    let size = 0;
    head = 0;
    tail = 0;
    seen[start] = 1;
    queue[tail++] = start;
    while (head < tail) {
      const index = queue[head++];
      size += 1;
      const x = index % width;
      const y = (index - x) / width;
      if (x > 0) push(index - 1);
      if (x + 1 < width) push(index + 1);
      if (y > 0) push(index - width);
      if (y + 1 < height) push(index + width);
    }
    holePixels += size;
    if (size > largestHolePixels) largestHolePixels = size;
  }
  return { holePixels, silhouettePixels: total - backgroundPixels, largestHolePixels };
}

function percentText(ratio) {
  return `${round6(ratio * 100)}%`;
}

/**
 * Measure how much of the model's silhouette looks straight through it.
 *
 * The surface is voxelised into a `grid`-cell cube grid (128 cells on the
 * longest side by default), then projected along x, y and z. A projected pixel
 * that lies inside the silhouette but has no occupied cell along its whole
 * depth is a hole; `holeRatio` is the hole share of the silhouette and
 * `largestHolePixels` is the biggest 4-connected hole region.
 *
 * `boundaryEdges` and `nonManifoldEdges` are the topology diagnostics that
 * explain those numbers: a mesh can be see-through while every welded edge is
 * shared by two triangles (a closed shell pierced by handles), and then a
 * boundary-loop walker has nothing to report at all.
 *
 * Pure and deterministic: the same input and options give the same numbers.
 */
export function analyzeCoverage(input = {}, options = {}) {
  const started = Date.now();
  const source = options && typeof options === "object" ? options : {};
  const positions = asPositions(input?.positions);
  const indices = asIndices(input?.indices);
  if (positions.length % 3 !== 0)
    throw new KiriError("model_invalid", { detail: "POSITION bukan kelipatan tiga." });
  if (indices.length % 3 !== 0)
    throw new KiriError("model_invalid", { detail: "Indeks bukan kelipatan tiga." });
  const vertexCount = positions.length / 3;
  for (let i = 0; i < indices.length; i++) {
    if (indices[i] >= vertexCount)
      throw new KiriError("model_invalid", {
        detail: `Indeks ${indices[i]} melewati ${vertexCount} vertex.`,
      });
  }
  const grid = clamp(
    Math.round(Number.isFinite(source.grid) ? source.grid : COVERAGE_DEFAULTS.grid),
    8,
    512,
  );
  const weldEpsilonRatio =
    Number.isFinite(source.weldEpsilonRatio) && source.weldEpsilonRatio > 0
      ? source.weldEpsilonRatio
      : COVERAGE_DEFAULTS.weldEpsilonRatio;

  // --- bounds over referenced vertices ------------------------------------
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < indices.length; i++) {
    const base = indices[i] * 3;
    for (let axis = 0; axis < 3; axis++) {
      const value = positions[base + axis];
      if (!Number.isFinite(value)) continue;
      if (value < min[axis]) min[axis] = value;
      if (value > max[axis]) max[axis] = value;
    }
  }
  for (let axis = 0; axis < 3; axis++) {
    if (!Number.isFinite(min[axis])) {
      min[axis] = 0;
      max[axis] = 0;
    }
  }
  const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const diagonal = Math.hypot(size[0], size[1], size[2]);

  // --- topology diagnostics ------------------------------------------------
  const epsilon = Math.max(diagonal * weldEpsilonRatio, 1e-12);
  const rep = weldPositions(positions, vertexCount, epsilon);
  const edgeCounts = new Map();
  for (let t = 0; t < indices.length; t += 3) {
    for (let corner = 0; corner < 3; corner++) {
      const a = rep[indices[t + corner]];
      const b = rep[indices[t + ((corner + 1) % 3)]];
      if (a === b) continue;
      const key = a < b ? a * vertexCount + b : b * vertexCount + a;
      edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
    }
  }
  let boundaryEdges = 0;
  let nonManifoldEdges = 0;
  for (const count of edgeCounts.values()) {
    if (count === 1) boundaryEdges += 1;
    else if (count > 2) nonManifoldEdges += 1;
  }

  // --- voxel grid ----------------------------------------------------------
  const largest = Math.max(size[0], size[1], size[2]);
  const cell = largest > 0 ? largest / grid : 0;
  const dims =
    cell > 0
      ? size.map((length) => clamp(Math.ceil(length / cell - 1e-9), 1, grid))
      : [1, 1, 1];
  const occupancy =
    cell > 0 ? voxeliseSurface(positions, indices, min, cell, dims) : new Uint8Array(1);

  // --- projections ---------------------------------------------------------
  const projections = projectAxes(occupancy, dims);
  const axes = [];
  for (let axis = 0; axis < 3; axis++) {
    const width = dims[(axis + 1) % 3];
    const height = dims[(axis + 2) % 3];
    const stats = holeStats(projections[axis], width, height);
    axes.push({
      axis,
      axisName: AXIS_NAMES[axis],
      holeRatio:
        stats.silhouettePixels > 0 ? round6(stats.holePixels / stats.silhouettePixels) : 0,
      holePixels: stats.holePixels,
      silhouettePixels: stats.silhouettePixels,
      largestHolePixels: stats.largestHolePixels,
    });
  }
  const maxHoleRatio = axes.reduce((top, entry) => Math.max(top, entry.holeRatio), 0);

  return {
    axes,
    maxHoleRatio,
    grid,
    dims,
    watertight: boundaryEdges === 0 && nonManifoldEdges === 0,
    boundaryEdges,
    nonManifoldEdges,
    ms: Date.now() - started,
  };
}

/** Concatenate primitives into one { positions, indices } pair. */
function mergeGeometry(parts) {
  let vertexTotal = 0;
  let indexTotal = 0;
  for (const part of parts) {
    vertexTotal += part.positions.length / 3;
    indexTotal += part.indices.length;
  }
  const positions = new Float32Array(vertexTotal * 3);
  const indices = new Uint32Array(indexTotal);
  let vertexBase = 0;
  let indexBase = 0;
  for (const part of parts) {
    positions.set(part.positions, vertexBase * 3);
    for (let i = 0; i < part.indices.length; i++) {
      indices[indexBase + i] = part.indices[i] + vertexBase;
    }
    indexBase += part.indices.length;
    vertexBase += part.positions.length / 3;
  }
  return { positions, indices };
}

// --- analysis --------------------------------------------------------------

/**
 * Analyse one primitive and return the triangle list after surgery.
 *
 * `keptIndices` is the FINAL index buffer: values below `positions.length / 3`
 * address the input `positions`, values at or above it address `addedPositions`
 * at offset `value - positions.length / 3`. `addedUvs` parallels `addedPositions`
 * and is null when no UVs were supplied.
 *
 * `metrics.components` carries one record per connected component
 * ({ triangles, diagonal, ratio, triangleShare, dropped }), where `ratio` is the
 * component diagonal over the model diagonal. `metrics.loopsFilledByRatio`
 * splits every boundary loop into `filled`, `skipped` (over the gap budget) and
 * `blocked` (inside the budget but refused by the shape, vertex-count or normal
 * gates), so filled + skipped + blocked === metrics.boundaryLoops.
 *
 * Pure and deterministic: the same input yields the same output.
 */
export function analyzeMesh(input = {}, options = {}) {
  const started = Date.now();
  const opts = normalizeOptions(options);
  const { positions: rawPositions, indices: rawIndices, uvs: rawUvs = null } = input ?? {};
  const positions = asPositions(rawPositions);
  const indices = asIndices(rawIndices);
  if (positions.length % 3 !== 0)
    throw new KiriError("model_invalid", { detail: "POSITION bukan kelipatan tiga." });
  if (indices.length % 3 !== 0)
    throw new KiriError("model_invalid", { detail: "Indeks bukan kelipatan tiga." });

  const vertexCount = positions.length / 3;
  const triangleCount = indices.length / 3;
  for (let i = 0; i < indices.length; i++) {
    if (indices[i] >= vertexCount)
      throw new KiriError("model_invalid", {
        detail: `Indeks ${indices[i]} melewati ${vertexCount} vertex.`,
      });
  }

  let uvs = null;
  if (rawUvs) {
    const source = rawUvs instanceof Float32Array ? rawUvs : Float32Array.from(rawUvs);
    if (source.length === vertexCount * 2) uvs = source;
    else throw new KiriError("model_invalid", { detail: "TEXCOORD_0 tidak cocok jumlah vertex." });
  }

  // --- weld ---------------------------------------------------------------
  const rep = weldPositions(positions, vertexCount, opts.weldEpsilon);
  const canonical = new Int32Array(vertexCount).fill(-1);
  for (let i = 0; i < vertexCount; i++) {
    const root = rep[i];
    if (canonical[root] === -1) canonical[root] = i;
  }

  // --- union-find over welded vertices ------------------------------------
  const parent = new Int32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) parent[i] = i;
  const find = (value) => {
    let root = value;
    while (parent[root] !== root) root = parent[root];
    while (parent[value] !== root) {
      const next = parent[value];
      parent[value] = root;
      value = next;
    }
    return root;
  };
  const union = (a, b) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent[rootB] = rootA;
  };
  for (let t = 0; t < triangleCount; t++) {
    const a = rep[indices[t * 3]];
    const b = rep[indices[t * 3 + 1]];
    const c = rep[indices[t * 3 + 2]];
    union(a, b);
    union(b, c);
  }

  const groups = new Map();
  for (let t = 0; t < triangleCount; t++) {
    const root = find(rep[indices[t * 3]]);
    let group = groups.get(root);
    if (!group) {
      group = [];
      groups.set(root, group);
    }
    group.push(t);
  }

  const modelMin = [Infinity, Infinity, Infinity];
  const modelMax = [-Infinity, -Infinity, -Infinity];
  const components = [];
  for (const [root, triangles] of groups) {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const t of triangles) {
      for (let corner = 0; corner < 3; corner++) {
        const vertex = indices[t * 3 + corner] * 3;
        for (let axis = 0; axis < 3; axis++) {
          const value = positions[vertex + axis];
          if (!Number.isFinite(value)) continue;
          if (value < min[axis]) min[axis] = value;
          if (value > max[axis]) max[axis] = value;
          if (value < modelMin[axis]) modelMin[axis] = value;
          if (value > modelMax[axis]) modelMax[axis] = value;
        }
      }
    }
    for (let axis = 0; axis < 3; axis++) {
      if (!Number.isFinite(min[axis])) {
        min[axis] = 0;
        max[axis] = 0;
      }
    }
    const box = rawBoundsFrom(min, max);
    components.push({
      root,
      triangles,
      firstTriangle: triangles[0],
      diagonal: Math.hypot(box.size[0], box.size[1], box.size[2]),
      box,
    });
  }
  // Rank by triangle count, then by bounding-box diagonal.
  components.sort(
    (a, b) =>
      b.triangles.length - a.triangles.length ||
      b.diagonal - a.diagonal ||
      a.firstTriangle - b.firstTriangle,
  );

  const modelBox = rawBoundsFrom(
    modelMin.map((value) => (Number.isFinite(value) ? value : 0)),
    modelMax.map((value) => (Number.isFinite(value) ? value : 0)),
  );
  const modelDiagonal = Math.hypot(modelBox.size[0], modelBox.size[1], modelBox.size[2]);

  // --- fragment removal ---------------------------------------------------
  // A component is a fragment only when it is small in triangles *and* small
  // against the model box: a shard must beat both budgets to be dropped, so a
  // large but separate part (an arm, a shelf) survives on its diagonal alone.
  const largestTriangles = components[0]?.triangles.length ?? 0;
  const triangleLimit = Math.max(
    opts.minFragmentTriangles,
    opts.fragmentTriShare * largestTriangles,
  );
  const diagonalLimit = opts.minFragmentRatio * modelDiagonal;
  const kept = [];
  const dropped = [];
  const componentMetrics = [];
  for (const component of components) {
    const diagonalRatio = modelDiagonal > 0 ? component.diagonal / modelDiagonal : 0;
    const fragment =
      component.triangles.length < triangleLimit && component.diagonal < diagonalLimit;
    if (fragment) dropped.push(component);
    else kept.push(component);
    componentMetrics.push({
      triangles: component.triangles.length,
      diagonal: round6(component.diagonal),
      ratio: round6(diagonalRatio),
      triangleShare: round6(
        largestTriangles > 0 ? component.triangles.length / largestTriangles : 0,
      ),
      dropped: fragment,
    });
  }
  const keptTriangles = [];
  for (const component of kept) for (const t of component.triangles) keptTriangles.push(t);
  keptTriangles.sort((a, b) => a - b);

  // --- boundary edges -----------------------------------------------------
  const edgeMap = new Map();
  for (const t of keptTriangles) {
    for (let corner = 0; corner < 3; corner++) {
      const a = rep[indices[t * 3 + corner]];
      const b = rep[indices[t * 3 + ((corner + 1) % 3)]];
      if (a === b) continue;
      const key = a < b ? a * vertexCount + b : b * vertexCount + a;
      const entry = edgeMap.get(key);
      if (entry) entry.count += 1;
      else edgeMap.set(key, { count: 1, a, b, triangle: t });
    }
  }
  const boundaryEdges = [];
  for (const entry of edgeMap.values()) if (entry.count === 1) boundaryEdges.push(entry);
  boundaryEdges.sort((p, q) => p.a - q.a || p.b - q.b || p.triangle - q.triangle);

  const adjacency = new Map();
  boundaryEdges.forEach((entry, index) => {
    for (const vertex of [entry.a, entry.b]) {
      if (!adjacency.has(vertex)) adjacency.set(vertex, []);
      adjacency.get(vertex).push(index);
    }
  });
  for (const [vertex, list] of adjacency) {
    list.sort((p, q) => {
      const other = (edge) => (boundaryEdges[edge].a === vertex ? boundaryEdges[edge].b : boundaryEdges[edge].a);
      return other(p) - other(q) || p - q;
    });
  }

  const rawLoops = walkBoundaryLoops(boundaryEdges, adjacency);

  // --- fill decisions -----------------------------------------------------
  const areaEpsilon = Math.max(1e-15, modelDiagonal * modelDiagonal * 1e-10);
  const sizeLimit = opts.gapMaxRatio * modelDiagonal;
  const addedPositions = [];
  const addedUvs = [];
  const addedNormals = [];
  const fillIndices = [];
  const loops = [];
  let gapsFilled = 0;
  let gapTrianglesAdded = 0;
  // Auditable trail for the ratio gate: every loop is skipped (too big), filled,
  // or blocked (small enough but refused by the shape/normal/degeneracy gates).
  let ratioSkipped = 0;
  let ratioBlocked = 0;

  for (const raw of rawLoops) {
    const weldedVertices = raw.vertices;
    const loopVertexPositions = weldedVertices.map((value) => canonical[value]);
    const perimeter = loopPerimeter(positions, loopVertexPositions);
    const area = polygonArea(positions, loopVertexPositions);
    const box = loopBounds(positions, loopVertexPositions);
    const bboxDiagonal = Math.hypot(box.size[0], box.size[1], box.size[2]);
    const record = {
      vertices: weldedVertices.length,
      perimeter: round6(perimeter),
      area: round6(area),
      bboxDiagonal: round6(bboxDiagonal),
      filled: false,
    };
    loops.push(record);

    // A loop is a crack only when both its perimeter and its own span fit in
    // the gap budget; anything larger is a real opening and is left untouched.
    if (!(perimeter <= sizeLimit && bboxDiagonal <= sizeLimit)) {
      ratioSkipped += 1;
      continue;
    }

    const distinct = new Set(weldedVertices).size === weldedVertices.length;
    const qualifies =
      distinct &&
      weldedVertices.length >= 3 &&
      weldedVertices.length <= opts.gapMaxVertices;
    if (!qualifies) {
      ratioBlocked += 1;
      continue;
    }

    const filled = buildFill({
      positions,
      uvs,
      canonical,
      indices,
      vertices: weldedVertices,
      edges: raw.edges.map((index) => boundaryEdges[index]),
      areaEpsilon,
      maxNormalDeg: opts.fillMaxNormalDeg,
    });
    if (!filled) {
      ratioBlocked += 1;
      continue;
    }

    record.filled = true;
    gapsFilled += 1;
    gapTrianglesAdded += filled.spans.length;
    if (filled.centroid) {
      const newIndex = vertexCount + addedPositions.length / 3;
      addedPositions.push(filled.centroid[0], filled.centroid[1], filled.centroid[2]);
      if (uvs) addedUvs.push(filled.centroidUv[0], filled.centroidUv[1]);
      addedNormals.push(filled.normal[0], filled.normal[1], filled.normal[2]);
      for (const span of filled.spans) fillIndices.push(span[0], newIndex, span[1]);
    } else {
      for (const span of filled.spans) fillIndices.push(span[0], filled.third, span[1]);
    }
  }

  // --- final index list ---------------------------------------------------
  const finalIndices = new Uint32Array(keptTriangles.length * 3 + fillIndices.length);
  let cursor = 0;
  for (const t of keptTriangles) {
    finalIndices[cursor++] = indices[t * 3];
    finalIndices[cursor++] = indices[t * 3 + 1];
    finalIndices[cursor++] = indices[t * 3 + 2];
  }
  for (let i = 0; i < fillIndices.length; i++) finalIndices[cursor++] = fillIndices[i];

  const addedPositionArray = Float32Array.from(addedPositions);
  const addedNormalArray = Float32Array.from(addedNormals);
  const addedUvArray = uvs ? Float32Array.from(addedUvs) : null;
  const addedCount = addedPositionArray.length / 3;

  // --- centre and frame ---------------------------------------------------
  const boundsBeforeRaw = boundsFromIndexList(
    positions,
    addedPositionArray,
    vertexCount,
    finalIndices,
  );
  const largest = Math.max(...boundsBeforeRaw.size);
  const scale = largest > 0 ? opts.targetSize / largest : 1;
  const bounds = {
    min: [0, 0, 0],
    max: [0, 0, 0],
    size: [0, 0, 0],
    centre: [0, 0, 0],
  };
  for (let axis = 0; axis < 3; axis++) {
    bounds.min[axis] = round6((boundsBeforeRaw.min[axis] - boundsBeforeRaw.centre[axis]) * scale);
    bounds.max[axis] = round6((boundsBeforeRaw.max[axis] - boundsBeforeRaw.centre[axis]) * scale);
    bounds.size[axis] = round6(boundsBeforeRaw.size[axis] * scale);
  }

  // --- metrics ------------------------------------------------------------
  const referenced = new Uint8Array(vertexCount);
  let referencedCount = 0;
  for (let i = 0; i < finalIndices.length; i++) {
    const value = finalIndices[i];
    if (value >= vertexCount) continue;
    if (!referenced[value]) {
      referenced[value] = 1;
      referencedCount += 1;
    }
  }
  const metrics = {
    trianglesBefore: triangleCount,
    trianglesAfter: keptTriangles.length + gapTrianglesAdded,
    verticesBefore: vertexCount,
    verticesAfter: referencedCount + addedCount,
    componentsBefore: components.length,
    componentsAfter: kept.length,
    fragmentsRemoved: dropped.length,
    fragmentTrianglesRemoved: dropped.reduce((sum, item) => sum + item.triangles.length, 0),
    boundaryLoops: loops.length,
    gapsFilled,
    gapTrianglesAdded,
    loops,
    loopsFilledByRatio: {
      filled: gapsFilled,
      skipped: ratioSkipped,
      blocked: ratioBlocked,
    },
    openingsKept: loops.length - gapsFilled,
    boundsBefore: describeBounds(boundsBeforeRaw),
    bounds,
    scale: round6(scale),
    targetSize: opts.targetSize,
    centres: true,
    components: componentMetrics,
    fragments: dropped.map((item) => ({
      triangles: item.triangles.length,
      diagonal: round6(item.diagonal),
      centre: numberArray(item.box.centre),
    })),
    droppedAttributes: [],
    ms: Date.now() - started,
  };

  return {
    keptIndices: finalIndices,
    addedPositions: addedPositionArray,
    addedUvs: addedUvArray,
    addedNormals: addedNormalArray,
    metrics,
  };
}

function walkBoundaryLoops(boundaryEdges, adjacency) {
  const used = new Uint8Array(boundaryEdges.length);
  const loops = [];
  for (let start = 0; start < boundaryEdges.length; start++) {
    if (used[start]) continue;
    const startVertex = boundaryEdges[start].a;
    const vertices = [];
    const edges = [];
    let vertex = startVertex;
    let edge = start;
    let closed = false;
    for (let step = 0; step <= boundaryEdges.length; step++) {
      used[edge] = 1;
      const record = boundaryEdges[edge];
      vertices.push(vertex);
      edges.push(edge);
      const next = record.a === vertex ? record.b : record.a;
      if (next === startVertex) {
        closed = true;
        break;
      }
      vertex = next;
      let candidate = -1;
      for (const incident of adjacency.get(vertex) ?? []) {
        if (!used[incident]) {
          candidate = incident;
          break;
        }
      }
      if (candidate === -1) break;
      edge = candidate;
    }
    if (closed && vertices.length >= 3) loops.push({ vertices, edges });
  }
  return loops;
}

// A loop that qualifies by size still has to look like a crack. Each fan
// triangle bridges one boundary edge, so its normal is compared with the normal
// of the kept triangle that owns that edge: a tube's rim caps at ninety degrees
// and is refused, a missing triangle in a flat sheet agrees and is filled.
//
// A three-vertex ring already is the missing triangle, so it is closed with that
// one triangle instead of a centroid fan (which would replace one triangle with
// three slivers). Anything larger fans through the loop centroid.
function buildFill({
  positions,
  uvs,
  canonical,
  indices,
  vertices,
  edges,
  areaEpsilon,
  maxNormalDeg,
}) {
  const surfaceNormal = new Float64Array(3);
  const face = new Float64Array(3);
  const maxCos = Math.cos((maxNormalDeg * Math.PI) / 180);

  const centroid = [0, 0, 0];
  for (const welded of vertices) {
    const vertex = canonical[welded] * 3;
    centroid[0] += positions[vertex];
    centroid[1] += positions[vertex + 1];
    centroid[2] += positions[vertex + 2];
  }
  centroid[0] /= vertices.length;
  centroid[1] /= vertices.length;
  centroid[2] /= vertices.length;

  const centroidUv = [0, 0];
  if (uvs) {
    for (const welded of vertices) {
      const vertex = canonical[welded] * 2;
      centroidUv[0] += uvs[vertex];
      centroidUv[1] += uvs[vertex + 1];
    }
    centroidUv[0] /= vertices.length;
    centroidUv[1] /= vertices.length;
  }

  const third =
    vertices.length === 3
      ? canonical[vertices.find((value) => value !== edges[0].a && value !== edges[0].b)]
      : null;

  // Unit normal of the kept triangle that owns a boundary edge.
  const ownerNormal = (edge, out) => {
    const owner = edge.triangle * 3;
    const length = faceNormal(
      positions,
      indices[owner],
      indices[owner + 1],
      indices[owner + 2],
      out,
    );
    return Number.isFinite(length) && length > 0 ? length : 0;
  };

  if (third !== null) {
    // One ring, one missing triangle: check that triangle against every rim it
    // bridges, then close the ring with it.
    const a = canonical[edges[0].a];
    const b = canonical[edges[0].b];
    const length = faceNormal(positions, a, third, b, face);
    if (!Number.isFinite(length) || length / 2 <= areaEpsilon) return null;
    const normalSum = [0, 0, 0];
    for (const edge of edges) {
      const surfaceLength = ownerNormal(edge, surfaceNormal);
      if (!surfaceLength) return null;
      const cos = (face[0] * surfaceNormal[0] +
        face[1] * surfaceNormal[1] +
        face[2] * surfaceNormal[2]) / (length * surfaceLength);
      if (cos < maxCos - 1e-9) return null;
      normalSum[0] += surfaceNormal[0] / surfaceLength;
      normalSum[1] += surfaceNormal[1] / surfaceLength;
      normalSum[2] += surfaceNormal[2] / surfaceLength;
    }
    return {
      spans: [[a, b]],
      third,
      centroid: null,
      centroidUv: null,
      normal: normalize3(normalSum),
    };
  }

  const spans = [];
  const normalSum = [0, 0, 0];
  for (const edge of edges) {
    const a = canonical[edge.a];
    const b = canonical[edge.b];
    const ax = positions[a * 3];
    const ay = positions[a * 3 + 1];
    const az = positions[a * 3 + 2];
    const ux = centroid[0] - ax;
    const uy = centroid[1] - ay;
    const uz = centroid[2] - az;
    const bx = positions[b * 3] - ax;
    const by = positions[b * 3 + 1] - ay;
    const bz = positions[b * 3 + 2] - az;
    const nx = uy * bz - uz * by;
    const ny = uz * bx - ux * bz;
    const nz = ux * by - uy * bx;
    const length = Math.hypot(nx, ny, nz);
    if (!Number.isFinite(length) || length / 2 <= areaEpsilon) return null;
    const surfaceLength = ownerNormal(edge, surfaceNormal);
    if (!surfaceLength) return null;
    const cos = (nx * surfaceNormal[0] + ny * surfaceNormal[1] + nz * surfaceNormal[2]) /
      (length * surfaceLength);
    if (cos < maxCos - 1e-9) return null;
    spans.push([a, b]);
    normalSum[0] += surfaceNormal[0] / surfaceLength;
    normalSum[1] += surfaceNormal[1] / surfaceLength;
    normalSum[2] += surfaceNormal[2] / surfaceLength;
  }
  return { spans, third: null, centroid, centroidUv, normal: normalize3(normalSum) };
}

// --- GLB refinement --------------------------------------------------------

/**
 * Refine a whole GLB. Returns { buffer, metrics, reason }.
 * A malformed container throws KiriError("model_invalid"); an unsupported
 * layout returns { buffer: null, metrics: null, reason } so the raw GLB wins.
 *
 * Options default to REFINE_DEFAULTS. `normals: "keep"` copies the input
 * normals instead of recomputing them; every other knob is a number.
 */
export function refineGlb(buffer, options = {}) {
  const started = Date.now();
  const opts = normalizeOptions(options);
  const { json, bin } = parseGlbChunks(buffer);
  try {
    return refineParsed({ json, bin, opts, started, inputBytes: buffer.length });
  } catch (error) {
    if (error instanceof RefineSkip)
      return { buffer: null, metrics: null, reason: error.reason };
    throw error;
  }
}

function refineParsed({ json, bin, opts, started, inputBytes }) {
  if (inputBytes > MAX_GLB_BYTES) skip("glb_too_large", `GLB ${inputBytes} byte terlalu besar.`);
  if (json.buffers?.[0]?.uri) skip("unsupported_buffer", "buffer GLB memakai URI luar.");
  if (Array.isArray(json.animations) && json.animations.length)
    skip("unsupported_animation", "glTF berisi animasi.");
  if (Array.isArray(json.skins) && json.skins.length)
    skip("unsupported_skin", "glTF berisi skin.");
  if (Array.isArray(json.extensionsRequired)) {
    for (const name of json.extensionsRequired) {
      if (COMPRESSED_EXTENSIONS.has(name))
        skip("unsupported_extension", `Ekstensi ${name} wajib dan tidak didukung.`);
    }
  }

  const meshes = Array.isArray(json.meshes) ? json.meshes : [];
  const work = [];
  const consumedViews = new Set();
  let trianglesBefore = 0;

  meshes.forEach((mesh, meshIndex) => {
    const primitives = Array.isArray(mesh?.primitives) ? mesh.primitives : [];
    primitives.forEach((primitive, primitiveIndex) => {
      const prepared = preparePrimitive({
        json,
        bin,
        primitive,
        meshIndex,
        primitiveIndex,
        consumedViews,
      });
      trianglesBefore += prepared.indices.length / 3;
      work.push(prepared);
    });
  });
  if (work.length === 0) skip("no_triangles", "GLB tidak berisi primitive.");
  if (trianglesBefore === 0) skip("no_triangles", "GLB tidak berisi segitiga.");

  // How much of the input's silhouette already looks straight through it. This
  // is measured before any edit so coverageAfter can be compared with it.
  const coverageOptions = { grid: opts.coverageGrid };
  const coverageBefore = analyzeCoverage(
    mergeGeometry(work.map(({ positions, indices }) => ({ positions, indices }))),
    coverageOptions,
  );

  const droppedAttributes = new Set();
  const results = [];
  let trianglesAfter = 0;
  let verticesBefore = 0;
  let verticesAfter = 0;
  let componentsBefore = 0;
  let componentsAfter = 0;
  let fragmentsRemoved = 0;
  let fragmentTrianglesRemoved = 0;
  let boundaryLoops = 0;
  let gapsFilled = 0;
  let gapTrianglesAdded = 0;
  const loops = [];
  const fragments = [];
  const componentRecords = [];
  const loopsFilledByRatio = { filled: 0, skipped: 0, blocked: 0 };

  for (const prepared of work) {
    const analysis = analyzeMesh(
      { positions: prepared.positions, indices: prepared.indices, uvs: prepared.uvs },
      opts,
    );
    const metrics = analysis.metrics;
    trianglesAfter += metrics.trianglesAfter;
    verticesBefore += metrics.verticesBefore;
    componentsBefore += metrics.componentsBefore;
    componentsAfter += metrics.componentsAfter;
    fragmentsRemoved += metrics.fragmentsRemoved;
    fragmentTrianglesRemoved += metrics.fragmentTrianglesRemoved;
    boundaryLoops += metrics.boundaryLoops;
    gapsFilled += metrics.gapsFilled;
    gapTrianglesAdded += metrics.gapTrianglesAdded;
    loopsFilledByRatio.filled += metrics.loopsFilledByRatio.filled;
    loopsFilledByRatio.skipped += metrics.loopsFilledByRatio.skipped;
    loopsFilledByRatio.blocked += metrics.loopsFilledByRatio.blocked;
    for (const loop of metrics.loops) loops.push(loop);
    for (const fragment of metrics.fragments) fragments.push(fragment);
    for (const component of metrics.components) {
      componentRecords.push({
        mesh: prepared.meshIndex,
        primitive: prepared.primitiveIndex,
        ...component,
      });
    }
    if (metrics.trianglesAfter === 0)
      skip("nothing_left", `Primitive ${prepared.meshIndex}/${prepared.primitiveIndex} habis.`);

    for (const name of prepared.droppedAttributes) droppedAttributes.add(name);
    const compacted = compactPrimitive({ prepared, analysis });
    results.push(compacted);
  }

  // --- one centre and one scale for the whole file ------------------------
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const result of results) {
    for (let i = 0; i < result.positions.length; i += 3) {
      for (let axis = 0; axis < 3; axis++) {
        const value = result.positions[i + axis];
        if (!Number.isFinite(value)) continue;
        if (value < min[axis]) min[axis] = value;
        if (value > max[axis]) max[axis] = value;
      }
    }
  }
  for (let axis = 0; axis < 3; axis++) {
    if (!Number.isFinite(min[axis])) {
      min[axis] = 0;
      max[axis] = 0;
    }
  }
  const boundsBeforeRaw = rawBoundsFrom(min, max);
  const largest = Math.max(...boundsBeforeRaw.size);
  const scale = largest > 0 ? opts.targetSize / largest : 1;
  const centre = boundsBeforeRaw.centre;
  for (const result of results) {
    for (let i = 0; i < result.positions.length; i += 3) {
      result.positions[i] = (result.positions[i] - centre[0]) * scale;
      result.positions[i + 1] = (result.positions[i + 1] - centre[1]) * scale;
      result.positions[i + 2] = (result.positions[i + 2] - centre[2]) * scale;
    }
  }

  // --- normals ------------------------------------------------------------
  // KIRI ships per-patch normals, so every photogrammetry seam reads as a dark
  // blotch. Recomputing angle-weighted normals across the welded surface (with
  // a crease threshold) is the main polish lever; "keep" opts out per caller.
  let smoothedPrimitives = 0;
  let hardEdges = 0;
  for (const result of results) {
    if (opts.normals === "keep" && result.hasNormals) continue;
    const smoothed = smoothCreaseNormals({
      positions: result.positions,
      indices: result.indices,
      uvs: result.uvs,
      weldEpsilon: opts.weldEpsilon,
      creaseDeg: opts.normalCreaseDeg,
    });
    result.positions = smoothed.positions;
    result.uvs = smoothed.uvs;
    result.normals = smoothed.normals;
    result.indices = smoothed.indices;
    result.vertexCount = smoothed.positions.length / 3;
    hardEdges += smoothed.hardEdges;
    smoothedPrimitives += 1;
  }
  const normalsMetrics = {
    recomputed: smoothedPrimitives > 0,
    hardEdges,
    mode: smoothedPrimitives > 0 ? "smooth-crease" : "keep",
  };
  for (const result of results) verticesAfter += result.vertexCount;

  const boundsBefore = describeBounds(boundsBeforeRaw);
  const bounds = {
    min: [0, 0, 0],
    max: [0, 0, 0],
    size: [0, 0, 0],
    centre: [0, 0, 0],
  };
  for (let axis = 0; axis < 3; axis++) {
    bounds.min[axis] = round6((boundsBeforeRaw.min[axis] - centre[axis]) * scale);
    bounds.max[axis] = round6((boundsBeforeRaw.max[axis] - centre[axis]) * scale);
    bounds.size[axis] = round6(boundsBeforeRaw.size[axis] * scale);
  }

  // --- rebuild binary + JSON ---------------------------------------------
  const chunks = [];
  let binLength = 0;
  const appendBytes = (bytes) => {
    const padding = (4 - (binLength % 4)) % 4;
    if (padding) {
      chunks.push(Buffer.alloc(padding));
      binLength += padding;
    }
    const offset = binLength;
    chunks.push(bytes);
    binLength += bytes.length;
    return offset;
  };
  const bufferViews = [];
  const addView = (bytes, target) => {
    const byteOffset = appendBytes(bytes);
    const view = { buffer: 0, byteOffset, byteLength: bytes.length };
    if (target) view.target = target;
    bufferViews.push(view);
    return bufferViews.length - 1;
  };
  const accessors = [];
  const addAccessor = (accessor) => {
    accessors.push(accessor);
    return accessors.length - 1;
  };

  const outMeshes = meshes.map((mesh) => ({ ...mesh, primitives: [] }));
  for (const result of results) {
    const { positions, normals, uvs, indices } = result;
    const vertexCount = positions.length / 3;
    const positionView = addView(
      Buffer.from(positions.buffer, positions.byteOffset, positions.byteLength),
      34962,
    );
    const minPosition = [Infinity, Infinity, Infinity];
    const maxPosition = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < positions.length; i += 3) {
      for (let axis = 0; axis < 3; axis++) {
        const value = positions[i + axis];
        if (!Number.isFinite(value)) continue;
        if (value < minPosition[axis]) minPosition[axis] = value;
        if (value > maxPosition[axis]) maxPosition[axis] = value;
      }
    }
    const positionAccessor = addAccessor({
      bufferView: positionView,
      componentType: FLOAT,
      count: vertexCount,
      type: "VEC3",
      min: minPosition.map((value) => (Number.isFinite(value) ? value : 0)),
      max: maxPosition.map((value) => (Number.isFinite(value) ? value : 0)),
    });
    const normalView = addView(
      Buffer.from(normals.buffer, normals.byteOffset, normals.byteLength),
      34962,
    );
    const normalAccessor = addAccessor({
      bufferView: normalView,
      componentType: FLOAT,
      count: vertexCount,
      type: "VEC3",
    });
    let uvAccessor = null;
    if (uvs) {
      const uvView = addView(Buffer.from(uvs.buffer, uvs.byteOffset, uvs.byteLength), 34962);
      uvAccessor = addAccessor({
        bufferView: uvView,
        componentType: FLOAT,
        count: vertexCount,
        type: "VEC2",
      });
    }
    let maxIndex = 0;
    for (let i = 0; i < indices.length; i++) if (indices[i] > maxIndex) maxIndex = indices[i];
    const wide = maxIndex >= 65536;
    const indexArray = wide ? Uint32Array.from(indices) : Uint16Array.from(indices);
    const indexView = addView(
      Buffer.from(indexArray.buffer, indexArray.byteOffset, indexArray.byteLength),
      34963,
    );
    const indexAccessor = addAccessor({
      bufferView: indexView,
      componentType: wide ? UNSIGNED_INT : UNSIGNED_SHORT,
      count: indexArray.length,
      type: "SCALAR",
      min: [0],
      max: [maxIndex],
    });

    const attributes = { POSITION: positionAccessor, NORMAL: normalAccessor };
    if (uvAccessor !== null) attributes.TEXCOORD_0 = uvAccessor;
    const primitive = { ...result.primitive, attributes, indices: indexAccessor };
    delete primitive.targets;
    outMeshes[result.meshIndex].primitives[result.primitiveIndex] = primitive;
  }

  // Copy every non-geometry view (the JPEG) and remap it.
  const copiedViews = new Map();
  const copyView = (viewIndex) => {
    if (copiedViews.has(viewIndex)) return copiedViews.get(viewIndex);
    if (consumedViews.has(viewIndex))
      unsupportedAccessor(`bufferView ${viewIndex} dipakai geometri dan gambar.`);
    const view = json.bufferViews?.[viewIndex];
    if (!view || typeof view !== "object") unsupportedAccessor(`bufferView ${viewIndex} hilang.`);
    if ((view.buffer ?? 0) !== 0) unsupportedAccessor(`bufferView ${viewIndex} bukan buffer GLB.`);
    const viewOffset = Number.isInteger(view.byteOffset) ? view.byteOffset : 0;
    const viewLength = view.byteLength;
    if (!Number.isInteger(viewLength) || viewLength < 0)
      unsupportedAccessor(`bufferView ${viewIndex} tanpa byteLength.`);
    if (viewOffset + viewLength > bin.length)
      unsupportedAccessor(`bufferView ${viewIndex} melewati isi buffer.`);
    const bytes = bin.subarray(viewOffset, viewOffset + viewLength);
    const newIndex = addView(bytes);
    copiedViews.set(viewIndex, newIndex);
    return newIndex;
  };

  const outImages = Array.isArray(json.images)
    ? json.images.map((image) => {
        if (!image || typeof image !== "object") return image;
        if (!Number.isInteger(image.bufferView)) return image;
        return { ...image, bufferView: copyView(image.bufferView) };
      })
    : json.images;
  const originalViews = Array.isArray(json.bufferViews) ? json.bufferViews : [];
  for (let i = 0; i < originalViews.length; i++) {
    if (consumedViews.has(i)) continue;
    copyView(i);
  }

  const binBytes = Buffer.concat(chunks, binLength);
  if (binBytes.length + 1024 > MAX_GLB_BYTES)
    skip("glb_too_large", `Hasil ${binBytes.length} byte terlalu besar.`);

  const outJson = {
    ...json,
    accessors,
    bufferViews,
    buffers: [{ byteLength: binBytes.length }],
    meshes: outMeshes,
  };
  if (outImages !== undefined) outJson.images = outImages;
  const outBuffer = buildGlb({ json: outJson, bin: binBytes });
  if (outBuffer.length > MAX_GLB_BYTES)
    skip("glb_too_large", `GLB hasil ${outBuffer.length} byte terlalu besar.`);

  // --- coverage after the surgery -----------------------------------------
  const coverageAfter = analyzeCoverage(
    mergeGeometry(results.map(({ positions, indices }) => ({ positions, indices }))),
    coverageOptions,
  );
  const holeRatioBefore = round6(coverageBefore.maxHoleRatio);
  const holeRatioAfter = round6(coverageAfter.maxHoleRatio);
  const verdict =
    holeRatioAfter <= opts.holeBudget ? COVERAGE_VERDICTS.clean : COVERAGE_VERDICTS.perforated;
  const worstAxis = coverageAfter.axes.reduce(
    (worst, entry) => (entry.holeRatio > worst.holeRatio ? entry : worst),
    coverageAfter.axes[0],
  );
  const verdictRationale =
    `Ambang ${percentText(opts.holeBudget)}: pratinjau disebut "${COVERAGE_VERDICTS.clean}" ` +
    `bila tidak lebih dari ${percentText(opts.holeBudget)} siluet menembus geometri pada arah ` +
    `pandang terburuk. Terukur ${percentText(holeRatioAfter)} pada sumbu ${worstAxis.axisName} ` +
    `(${worstAxis.holePixels} dari ${worstAxis.silhouettePixels} piksel siluet, lubang terbesar ` +
    `${worstAxis.largestHolePixels} piksel).`;

  const metrics = {
    trianglesBefore,
    trianglesAfter,
    verticesBefore,
    verticesAfter,
    componentsBefore,
    componentsAfter,
    fragmentsRemoved,
    fragmentTrianglesRemoved,
    boundaryLoops,
    gapsFilled,
    gapTrianglesAdded,
    loops,
    loopsFilledByRatio,
    openingsKept: loops.filter((loop) => !loop.filled).length,
    bounds,
    boundsBefore,
    scale: round6(scale),
    targetSize: opts.targetSize,
    centres: true,
    normals: normalsMetrics,
    components: componentRecords,
    fragments,
    coverageBefore,
    coverageAfter,
    holeRatioBefore,
    holeRatioAfter,
    coverage: {
      ...coverageAfter,
      holeRatioBefore,
      holeRatioAfter,
      verdict,
      verdictRationale,
      worstAxis: worstAxis.axisName,
    },
    droppedAttributes: [...droppedAttributes].sort(),
    ms: Date.now() - started,
  };
  return { buffer: outBuffer, metrics, reason: null };
}

function preparePrimitive({ json, bin, primitive, meshIndex, primitiveIndex, consumedViews }) {
  if (!primitive || typeof primitive !== "object")
    unsupportedAccessor(`Primitive ${meshIndex}/${primitiveIndex} tidak valid.`);
  const mode = primitive.mode ?? 4;
  if (mode !== 4) skip("unsupported_mode", `Primitive ${meshIndex} bukan TRIANGLES.`);
  if (Array.isArray(primitive.targets) && primitive.targets.length)
    skip("unsupported_attribute", `Primitive ${meshIndex} punya morph target.`);
  for (const name of Object.keys(primitive.extensions ?? {})) {
    if (COMPRESSED_EXTENSIONS.has(name))
      skip("unsupported_extension", `Primitive ${meshIndex} memakai ${name}.`);
  }
  const attributes = primitive.attributes;
  if (!attributes || typeof attributes !== "object")
    skip("unsupported_attribute", `Primitive ${meshIndex} tanpa attributes.`);

  const droppedAttributes = [];
  for (const name of Object.keys(attributes)) {
    const index = attributes[name];
    const accessor = Array.isArray(json.accessors) ? json.accessors[index] : null;
    if (accessor && Number.isInteger(accessor.bufferView)) consumedViews.add(accessor.bufferView);
    if (KEPT_ATTRIBUTES.has(name)) continue;
    if (isDroppableAttribute(name)) {
      droppedAttributes.push(name);
      continue;
    }
    skip("unsupported_attribute", `Atribut ${name} tidak bisa dibuang dengan aman.`);
  }

  const positionIndex = attributes.POSITION;
  if (!Number.isInteger(positionIndex))
    skip("unsupported_attribute", "Primitive tanpa POSITION.");
  const positions = readFloatAccessor(json, bin, positionIndex, "VEC3", 3, "POSITION");
  const vertexCount = positions.length / 3;
  for (let i = 0; i < positions.length; i++) {
    if (!Number.isFinite(positions[i]))
      unsupportedAccessor("POSITION berisi nilai bukan angka.");
  }

  let normals = null;
  if (Number.isInteger(attributes.NORMAL)) {
    normals = readFloatAccessor(json, bin, attributes.NORMAL, "VEC3", 3, "NORMAL");
    if (normals.length !== positions.length)
      unsupportedAccessor("NORMAL tidak cocok jumlah vertex.");
  }
  let uvs = null;
  if (Number.isInteger(attributes.TEXCOORD_0)) {
    uvs = readFloatAccessor(json, bin, attributes.TEXCOORD_0, "VEC2", 2, "TEXCOORD_0");
    if (uvs.length !== vertexCount * 2)
      unsupportedAccessor("TEXCOORD_0 tidak cocok jumlah vertex.");
  }

  let indices;
  if (Number.isInteger(primitive.indices)) {
    const indexAccessor = Array.isArray(json.accessors) ? json.accessors[primitive.indices] : null;
    if (indexAccessor && Number.isInteger(indexAccessor.bufferView))
      consumedViews.add(indexAccessor.bufferView);
    indices = readIndexAccessor(json, bin, primitive.indices, "indices");
    if (indices.length % 3 !== 0) unsupportedAccessor("Jumlah indeks bukan kelipatan tiga.");
  } else {
    if (vertexCount % 3 !== 0)
      unsupportedAccessor("Primitive tanpa indeks bukan kelipatan tiga.");
    indices = new Uint32Array(vertexCount);
    for (let i = 0; i < vertexCount; i++) indices[i] = i;
  }
  for (let i = 0; i < indices.length; i++) {
    if (indices[i] >= vertexCount)
      unsupportedAccessor(`Indeks ${indices[i]} melewati ${vertexCount} vertex.`);
  }

  return {
    meshIndex,
    primitiveIndex,
    primitive,
    positions,
    normals,
    uvs,
    indices,
    droppedAttributes,
  };
}

function compactPrimitive({ prepared, analysis }) {
  const { positions, normals, uvs } = prepared;
  const vertexCount = positions.length / 3;
  const { keptIndices, addedPositions, addedUvs, addedNormals } = analysis;
  const addedCount = addedPositions.length / 3;

  const remap = new Int32Array(vertexCount).fill(-1);
  const referenced = [];
  for (let i = 0; i < keptIndices.length; i++) {
    const value = keptIndices[i];
    if (value >= vertexCount) continue;
    if (remap[value] === -1) {
      remap[value] = referenced.length;
      referenced.push(value);
    }
  }
  const newVertexCount = referenced.length + addedCount;
  const outPositions = new Float32Array(newVertexCount * 3);
  const outNormals = normals ? new Float32Array(newVertexCount * 3) : null;
  const outUvs = uvs ? new Float32Array(newVertexCount * 2) : null;
  for (let i = 0; i < referenced.length; i++) {
    const source = referenced[i] * 3;
    outPositions[i * 3] = positions[source];
    outPositions[i * 3 + 1] = positions[source + 1];
    outPositions[i * 3 + 2] = positions[source + 2];
    if (outNormals) {
      outNormals[i * 3] = normals[source];
      outNormals[i * 3 + 1] = normals[source + 1];
      outNormals[i * 3 + 2] = normals[source + 2];
    }
    if (outUvs) {
      outUvs[i * 2] = uvs[referenced[i] * 2];
      outUvs[i * 2 + 1] = uvs[referenced[i] * 2 + 1];
    }
  }
  for (let i = 0; i < addedCount; i++) {
    const target = referenced.length + i;
    outPositions[target * 3] = addedPositions[i * 3];
    outPositions[target * 3 + 1] = addedPositions[i * 3 + 1];
    outPositions[target * 3 + 2] = addedPositions[i * 3 + 2];
    if (outNormals) {
      outNormals[target * 3] = addedNormals[i * 3];
      outNormals[target * 3 + 1] = addedNormals[i * 3 + 1];
      outNormals[target * 3 + 2] = addedNormals[i * 3 + 2];
    }
    if (outUvs) {
      outUvs[target * 2] = addedUvs[i * 2];
      outUvs[target * 2 + 1] = addedUvs[i * 2 + 1];
    }
  }
  const outIndices = new Uint32Array(keptIndices.length);
  for (let i = 0; i < keptIndices.length; i++) {
    const value = keptIndices[i];
    outIndices[i] = value < vertexCount ? remap[value] : referenced.length + (value - vertexCount);
  }
  return {
    meshIndex: prepared.meshIndex,
    primitiveIndex: prepared.primitiveIndex,
    primitive: prepared.primitive,
    positions: outPositions,
    normals: outNormals,
    uvs: outUvs,
    indices: outIndices,
    hasNormals: outNormals !== null,
    vertexCount: newVertexCount,
  };
}
