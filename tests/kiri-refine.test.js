import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { KiriError } from "../server/kiri-errors.mjs";
import { validateGlb } from "../server/kiri-artifact.mjs";
import {
  COVERAGE_DEFAULTS,
  COVERAGE_VERDICTS,
  REFINE_DEFAULTS,
  analyzeCoverage,
  analyzeMesh,
  buildGlb,
  parseGlbChunks,
  refineGlb,
} from "../server/kiri-refine.mjs";

// ---------------------------------------------------------------------------
// A minimal, independent GLB writer/reader. The fixtures never call buildGlb,
// so a bug in the module's writer cannot hide behind its own reader.

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;
const FLOAT = 5126;
const UINT8 = 5121;
const UINT16 = 5123;

const TYPE_WIDTH = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const pad4 = (value) => (value + 3) & ~3;

function packGlb(json, bin) {
  const text = Buffer.from(JSON.stringify(json), "utf8");
  const jsonLength = pad4(text.length);
  const binLength = pad4(bin.length);
  const out = Buffer.alloc(12 + 8 + jsonLength + 8 + binLength);
  out.writeUInt32LE(GLB_MAGIC, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(out.length, 8);
  out.writeUInt32LE(jsonLength, 12);
  out.writeUInt32LE(CHUNK_JSON, 16);
  text.copy(out, 20);
  out.fill(0x20, 20 + text.length, 20 + jsonLength);
  const binAt = 20 + jsonLength;
  out.writeUInt32LE(binLength, binAt);
  out.writeUInt32LE(CHUNK_BIN, binAt + 4);
  bin.copy(out, binAt + 8);
  return out;
}

function packJsonOnly(json) {
  const text = Buffer.from(JSON.stringify(json), "utf8");
  const length = pad4(text.length);
  const out = Buffer.alloc(20 + length);
  out.writeUInt32LE(GLB_MAGIC, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(out.length, 8);
  out.writeUInt32LE(length, 12);
  out.writeUInt32LE(CHUNK_JSON, 16);
  text.copy(out, 20);
  out.fill(0x20, 20 + text.length);
  return out;
}

function unpackGlb(buffer) {
  assert.equal(buffer.readUInt32LE(0), GLB_MAGIC, "magic");
  assert.equal(buffer.readUInt32LE(8), buffer.length, "declared length");
  let offset = 12;
  let json = null;
  let bin = null;
  while (offset < buffer.length) {
    const length = buffer.readUInt32LE(offset);
    const type = buffer.readUInt32LE(offset + 4);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === CHUNK_JSON) json = JSON.parse(data.toString("utf8"));
    else if (type === CHUNK_BIN) bin = data;
    offset += 8 + length;
  }
  return { json, bin };
}

function buildFixture({
  meshes,
  imageBytes = null,
  mimeType = "image/jpeg",
  rotation = null,
  withMaterial = false,
}) {
  const chunks = [];
  const views = [];
  const accessors = [];
  let offset = 0;

  const addView = (typed, target) => {
    const padding = (4 - (offset % 4)) % 4;
    if (padding) {
      chunks.push(Buffer.alloc(padding));
      offset += padding;
    }
    const bytes = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
    chunks.push(Buffer.from(bytes));
    const view = { buffer: 0, byteOffset: offset, byteLength: typed.byteLength };
    if (target) view.target = target;
    views.push(view);
    offset += typed.byteLength;
    return views.length - 1;
  };
  const addAccessor = (accessor) => {
    accessors.push(accessor);
    return accessors.length - 1;
  };

  const meshJson = meshes.map((primitives) => ({
    primitives: primitives.map((primitive) => {
      const attributes = {};
      for (const [name, attribute] of Object.entries(primitive.attributes)) {
        const width = TYPE_WIDTH[attribute.type];
        if (!width) throw new Error(`fixture: tipe ${attribute.type} tidak dikenal`);
        let array;
        if (attribute.componentType === FLOAT) array = Float32Array.from(attribute.data);
        else if (attribute.componentType === UINT16) array = Uint16Array.from(attribute.data);
        else if (attribute.componentType === UINT8) array = Uint8Array.from(attribute.data);
        else throw new Error("fixture: componentType tidak didukung");
        const view = addView(array, 34962);
        const accessor = {
          bufferView: view,
          componentType: attribute.componentType,
          count: array.length / width,
          type: attribute.type,
        };
        if (attribute.componentType === FLOAT) {
          const min = new Array(width).fill(Infinity);
          const max = new Array(width).fill(-Infinity);
          for (let i = 0; i < array.length; i += width) {
            for (let component = 0; component < width; component++) {
              const value = array[i + component];
              if (value < min[component]) min[component] = value;
              if (value > max[component]) max[component] = value;
            }
          }
          accessor.min = min;
          accessor.max = max;
        }
        attributes[name] = addAccessor(accessor);
      }
      const out = { attributes };
      if (primitive.indices) {
        const componentType = primitive.indices.componentType ?? UINT16;
        const array = componentType === UINT16
          ? Uint16Array.from(primitive.indices.data)
          : Uint32Array.from(primitive.indices.data);
        const view = addView(array, 34963);
        let max = 0;
        for (const value of array) if (value > max) max = value;
        out.indices = addAccessor({
          bufferView: view,
          componentType,
          count: array.length,
          type: "SCALAR",
          min: [0],
          max: [max],
        });
      }
      if (primitive.material !== undefined) out.material = primitive.material;
      if (primitive.mode !== undefined) out.mode = primitive.mode;
      if (primitive.extensions) out.extensions = primitive.extensions;
      return out;
    }),
  }));

  const imageView = imageBytes ? addView(Buffer.from(imageBytes)) : null;
  const bin = Buffer.concat(chunks);
  const json = {
    asset: { version: "2.0", generator: "lihatdulu test fixture" },
    scene: 0,
    scenes: [{ nodes: meshes.map((_, index) => index) }],
    nodes: meshes.map((_, index) => ({
      mesh: index,
      ...(index === 0 && rotation ? { rotation } : {}),
    })),
    meshes: meshJson,
    accessors,
    bufferViews: views,
    buffers: [{ byteLength: bin.length }],
  };
  if (withMaterial) {
    json.materials = [
      {
        name: "surface",
        doubleSided: true,
        pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0 },
      },
    ];
    json.textures = [{ sampler: 0, source: 0 }];
    json.images = [{ bufferView: imageView, mimeType, name: "texture" }];
    json.samplers = [{ magFilter: 9729, minFilter: 9987 }];
  }
  return packGlb(json, bin);
}

// --- fixture geometry ------------------------------------------------------

function primitiveOf(geometry, extra = {}) {
  const attributes = {
    POSITION: { data: geometry.positions, type: "VEC3", componentType: FLOAT },
  };
  if (geometry.normals) {
    attributes.NORMAL = { data: geometry.normals, type: "VEC3", componentType: FLOAT };
  }
  if (geometry.uvs) {
    attributes.TEXCOORD_0 = { data: geometry.uvs, type: "VEC2", componentType: FLOAT };
  }
  Object.assign(attributes, extra.attributes ?? {});
  const primitive = { attributes };
  if (geometry.indices) {
    primitive.indices = {
      data: geometry.indices,
      componentType: extra.indexComponentType ?? UINT16,
    };
  }
  if (extra.material !== undefined) primitive.material = extra.material;
  if (extra.mode !== undefined) primitive.mode = extra.mode;
  if (extra.extensions !== undefined) primitive.extensions = extra.extensions;
  return primitive;
}

function planeGeometry() {
  return {
    positions: [-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1],
    normals: [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0],
    uvs: [0, 0, 1, 0, 1, 1, 0, 1],
    indices: [0, 2, 1, 0, 3, 2],
  };
}

function boxGeometry({ min = [-1, -1, -1], max = [1, 1, 1] } = {}) {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  const positions = [
    x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0,
    x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1,
  ];
  const centre = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
  const normals = [];
  for (let i = 0; i < positions.length; i += 3) {
    const dx = positions[i] - centre[0];
    const dy = positions[i + 1] - centre[1];
    const dz = positions[i + 2] - centre[2];
    const length = Math.hypot(dx, dy, dz) || 1;
    normals.push(dx / length, dy / length, dz / length);
  }
  const indices = [
    0, 2, 1, 0, 3, 2,
    1, 2, 6, 1, 6, 5,
    0, 4, 7, 0, 7, 3,
    3, 7, 6, 3, 6, 2,
    0, 1, 5, 0, 5, 4,
    4, 5, 6, 4, 6, 7,
  ];
  return { positions, normals, indices };
}

// Same cube, but every face owns its four corners: welding must still see one
// connected body.
function unweldedBoxGeometry(options) {
  const base = boxGeometry(options);
  const faces = [];
  for (let triangle = 0; triangle < base.indices.length; triangle += 3) {
    faces.push(base.indices.slice(triangle, triangle + 3));
  }
  const positions = [];
  const normals = [];
  const indices = [];
  for (const face of faces) {
    for (const vertex of face) {
      positions.push(
        base.positions[vertex * 3],
        base.positions[vertex * 3 + 1],
        base.positions[vertex * 3 + 2],
      );
      normals.push(
        base.normals[vertex * 3],
        base.normals[vertex * 3 + 1],
        base.normals[vertex * 3 + 2],
      );
      indices.push(positions.length / 3 - 1);
    }
  }
  return { positions, normals, indices };
}

function tetraGeometry({ origin = [0, 0, 0], size = 0.1 } = {}) {
  const [ox, oy, oz] = origin;
  const s = size;
  const positions = [
    ox, oy, oz,
    ox + s, oy, oz,
    ox, oy + s, oz,
    ox, oy, oz + s,
  ];
  const centre = [ox + s / 4, oy + s / 4, oz + s / 4];
  const normals = [];
  for (let i = 0; i < positions.length; i += 3) {
    const dx = positions[i] - centre[0];
    const dy = positions[i + 1] - centre[1];
    const dz = positions[i + 2] - centre[2];
    const length = Math.hypot(dx, dy, dz) || 1;
    normals.push(dx / length, dy / length, dz / length);
  }
  return { positions, normals, indices: [0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3] };
}

function gridGeometry({ cells = 3, size = 3, skip = null } = {}) {
  const step = size / cells;
  const positions = [];
  const normals = [];
  const uvs = [];
  const vertexIndex = (x, z) => z * (cells + 1) + x;
  for (let z = 0; z <= cells; z++) {
    for (let x = 0; x <= cells; x++) {
      positions.push(x * step, 0, z * step);
      normals.push(0, 1, 0);
      uvs.push(x / cells, z / cells);
    }
  }
  const indices = [];
  for (let z = 0; z < cells; z++) {
    for (let x = 0; x < cells; x++) {
      const i00 = vertexIndex(x, z);
      const i10 = vertexIndex(x + 1, z);
      const i01 = vertexIndex(x, z + 1);
      const i11 = vertexIndex(x + 1, z + 1);
      const tris = [[i00, i01, i11], [i00, i11, i10]];
      for (let index = 0; index < tris.length; index++) {
        if (skip && skip.x === x && skip.z === z) {
          if (skip.both || skip.index === index) continue;
        }
        indices.push(...tris[index]);
      }
    }
  }
  return { positions, normals, uvs, indices };
}

// A flat square ring: a genuine hole in a sheet, the way a handle hole reads.
function ringGeometry() {
  const outer = [[0, 0], [4, 0], [4, 4], [0, 4]];
  const inner = [[1.5, 1.5], [2.5, 1.5], [2.5, 2.5], [1.5, 2.5]];
  const positions = [];
  const normals = [];
  const uvs = [];
  for (let i = 0; i < 4; i++) {
    positions.push(outer[i][0], 0, outer[i][1]);
    normals.push(0, 1, 0);
    uvs.push(outer[i][0] / 4, outer[i][1] / 4);
  }
  for (let i = 0; i < 4; i++) {
    positions.push(inner[i][0], 0, inner[i][1]);
    normals.push(0, 1, 0);
    uvs.push(inner[i][0] / 4, inner[i][1] / 4);
  }
  const indices = [];
  for (let i = 0; i < 4; i++) {
    const o = i;
    const nextO = (i + 1) % 4;
    const inner0 = 4 + i;
    const inner1 = 4 + nextO;
    indices.push(o, inner0, inner1, o, inner1, nextO);
  }
  return { positions, normals, uvs, indices };
}

// An open-ended square tube: both rims are real openings that a naive fan would
// cap at ninety degrees to the wall.
function tubeGeometry() {
  const positions = [
    0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1,
    0, 2, 0, 1, 2, 0, 1, 2, 1, 0, 2, 1,
  ];
  const normals = [];
  for (let i = 0; i < positions.length; i += 3) {
    const dx = positions[i] - 0.5;
    const dz = positions[i + 2] - 0.5;
    const length = Math.hypot(dx, dz) || 1;
    normals.push(dx / length, 0, dz / length);
  }
  const indices = [
    1, 0, 4, 1, 4, 5,
    3, 2, 6, 3, 6, 7,
    0, 3, 7, 0, 7, 4,
    2, 1, 5, 2, 5, 6,
  ];
  return { positions, normals, indices };
}

// A floor and a wall meeting at ninety degrees along the edge A-B. The four
// triangles share one crease edge, so a crease-aware normal pass must split A
// and B in two and leave C, D, E and F with one normal each: eight vertices.
function creaseGeometry() {
  const positions = [
    0, 0, 0, // A
    1, 0, 0, // B
    0, 0, 1, // C
    1, 0, 1, // D
    0, 1, 0, // E
    1, 1, 0, // F
  ];
  // Deliberately wrong input normals: recomputation must ignore them.
  const normals = new Array(positions.length).fill(0);
  for (let i = 0; i < positions.length / 3; i++) normals[i * 3] = 1;
  const uvs = [0, 0, 1, 0, 0, 1, 1, 1, 0, 0, 1, 0];
  const indices = [0, 2, 3, 0, 3, 1, 0, 1, 5, 0, 5, 4];
  return { positions, normals, uvs, indices };
}

// The same flat square as planeGeometry, but every triangle owns its three
// corners: the two copies of the shared diagonal are coincident duplicates, the
// way a photogrammetry patch seam or a UV seam looks. The input normals even
// point in opposite directions, so only a welded recomputation can agree.
function seamPlaneGeometry() {
  return {
    positions: [
      -1, 0, -1, 1, 0, 1, 1, 0, -1,
      -1, 0, -1, -1, 0, 1, 1, 0, 1,
    ],
    normals: [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0],
    uvs: [0, 0, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1],
    indices: [0, 1, 2, 3, 4, 5],
  };
}

function mergeGeometries(...geometries) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  let base = 0;
  const everyHasUvs = geometries.every((geometry) => geometry.uvs);
  for (const geometry of geometries) {
    positions.push(...geometry.positions);
    normals.push(...geometry.normals);
    if (everyHasUvs) uvs.push(...geometry.uvs);
    for (const index of geometry.indices) indices.push(index + base);
    base += geometry.positions.length / 3;
  }
  return { positions, normals, ...(everyHasUvs ? { uvs } : {}), indices };
}

// --- output readers --------------------------------------------------------

function readFloatAccessor(json, bin, accessorIndex) {
  const accessor = json.accessors[accessorIndex];
  const view = json.bufferViews[accessor.bufferView];
  const width = TYPE_WIDTH[accessor.type];
  const base = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  assert.equal(accessor.componentType, FLOAT);
  const values = new Array(accessor.count * width);
  for (let i = 0; i < values.length; i++) values[i] = bin.readFloatLE(base + i * 4);
  return { values, count: accessor.count, width };
}

function readIndices(json, bin, accessorIndex) {
  const accessor = json.accessors[accessorIndex];
  const view = json.bufferViews[accessor.bufferView];
  const base = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const size = accessor.componentType === UINT16 ? 2 : 4;
  const values = [];
  for (let i = 0; i < accessor.count; i++) {
    values.push(size === 2 ? bin.readUInt16LE(base + i * 2) : bin.readUInt32LE(base + i * 4));
  }
  return values;
}

function boundsOf(values) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < values.length; i += 3) {
    for (let axis = 0; axis < 3; axis++) {
      if (values[i + axis] < min[axis]) min[axis] = values[i + axis];
      if (values[i + axis] > max[axis]) max[axis] = values[i + axis];
    }
  }
  return {
    min,
    max,
    size: max.map((value, axis) => value - min[axis]),
    centre: max.map((value, axis) => (value + min[axis]) / 2),
  };
}

function refinedBounds(glb, meshIndex = 0, primitiveIndex = 0) {
  const { json, bin } = parseGlbChunks(glb);
  const primitive = json.meshes[meshIndex].primitives[primitiveIndex];
  return boundsOf(readFloatAccessor(json, bin, primitive.attributes.POSITION).values);
}

function triangleArea(glb) {
  const { json, bin } = parseGlbChunks(glb);
  let total = 0;
  for (const mesh of json.meshes) {
    for (const primitive of mesh.primitives) {
      const { values } = readFloatAccessor(json, bin, primitive.attributes.POSITION);
      const indices = readIndices(json, bin, primitive.indices);
      for (let i = 0; i < indices.length; i += 3) {
        const a = indices[i] * 3;
        const b = indices[i + 1] * 3;
        const c = indices[i + 2] * 3;
        const ux = values[b] - values[a];
        const uy = values[b + 1] - values[a + 1];
        const uz = values[b + 2] - values[a + 2];
        const vx = values[c] - values[a];
        const vy = values[c + 1] - values[a + 1];
        const vz = values[c + 2] - values[a + 2];
        total += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
      }
    }
  }
  return total;
}

// ---------------------------------------------------------------------------
// Container + pure API

test("REFINE_DEFAULTS is frozen and carries the documented knobs", () => {
  assert.ok(Object.isFrozen(REFINE_DEFAULTS));
  assert.deepEqual({ ...REFINE_DEFAULTS }, {
    minFragmentTriangles: 8,
    fragmentTriShare: 0.03,
    minFragmentRatio: 0.15,
    gapMaxRatio: 0.02,
    gapMaxVertices: 48,
    fillMaxNormalDeg: 70,
    weldEpsilon: 1e-5,
    targetSize: 1,
    normalCreaseDeg: 40,
    normals: "smooth",
  });
});

test("buildGlb pads JSON with 0x20 and BIN with 0x00 and parseGlbChunks reads it back", () => {
  const json = { asset: { version: "2.0" } };
  const text = JSON.stringify(json);
  const glb = buildGlb({ json, bin: Buffer.from([1, 2, 3]) });
  assert.equal(glb.readUInt32LE(0), GLB_MAGIC);
  assert.equal(glb.readUInt32LE(4), 2);
  assert.equal(glb.readUInt32LE(8), glb.length);
  const jsonLength = glb.readUInt32LE(12);
  assert.equal(jsonLength, pad4(text.length));
  assert.equal(glb.readUInt32LE(16), CHUNK_JSON);
  for (let i = 20 + text.length; i < 20 + jsonLength; i++) assert.equal(glb[i], 0x20);
  const binAt = 20 + jsonLength;
  const binLength = glb.readUInt32LE(binAt);
  assert.equal(binLength, 4);
  assert.equal(glb.readUInt32LE(binAt + 4), CHUNK_BIN);
  for (let i = binAt + 8 + 3; i < binAt + 8 + binLength; i++) assert.equal(glb[i], 0x00);
  const parsed = parseGlbChunks(glb);
  assert.deepEqual(parsed.json, json);
  assert.deepEqual([...parsed.bin.subarray(0, 3)], [1, 2, 3]);
});

test("analyzeMesh is deterministic and reports the pre/post frame", () => {
  const fixture = gridGeometry({ cells: 3, size: 3 });
  const input = {
    positions: Float32Array.from(fixture.positions),
    indices: Uint32Array.from(fixture.indices),
  };
  const first = analyzeMesh(input, {});
  const second = analyzeMesh(input, {});
  assert.deepEqual([...first.keptIndices], [...second.keptIndices]);
  assert.deepEqual([...first.addedPositions], [...second.addedPositions]);
  assert.equal(first.metrics.trianglesBefore, 18);
  assert.equal(first.metrics.trianglesAfter, 18);
  assert.equal(first.metrics.scale, 0.333333);
  assert.deepEqual(first.metrics.boundsBefore.size, [3, 0, 3]);
  assert.deepEqual(first.metrics.bounds.size, [1, 0, 1]);
  assert.deepEqual(first.metrics.bounds.centre, [0, 0, 0]);
  assert.equal(first.metrics.loops.length, 1); // a flat sheet has one outer rim
  assert.equal(first.metrics.openingsKept, 1);
  assert.deepEqual(first.metrics.loopsFilledByRatio, { filled: 0, skipped: 1, blocked: 0 });
  assert.deepEqual(first.metrics.components, [
    { triangles: 18, diagonal: 4.242641, ratio: 1, triangleShare: 1, dropped: false },
  ]);
  assert.equal(first.addedUvs, null);
  assert.equal(first.addedNormals.length, 0);
});

// ---------------------------------------------------------------------------
// a) two-triangle plane

test("a two-triangle plane keeps both triangles and is centred, scaled to 1", () => {
  const fixture = buildFixture({ meshes: [[primitiveOf(planeGeometry())]] });
  const result = refineGlb(fixture);
  assert.equal(result.reason, null);
  assert.ok(Buffer.isBuffer(result.buffer));
  const metrics = result.metrics;
  assert.equal(metrics.trianglesBefore, 2);
  assert.equal(metrics.trianglesAfter, 2);
  assert.equal(metrics.verticesBefore, 4);
  assert.equal(metrics.verticesAfter, 4);
  assert.equal(metrics.fragmentsRemoved, 0);
  assert.equal(metrics.gapsFilled, 0);
  assert.equal(metrics.scale, 0.5);
  assert.deepEqual(metrics.boundsBefore.size, [2, 0, 2]);
  assert.deepEqual(metrics.bounds.size, [1, 0, 1]);
  assert.equal(metrics.targetSize, 1);
  assert.equal(metrics.centres, true);
  assert.deepEqual(metrics.droppedAttributes, []);
  // A flat sheet is one smoothing group: no crease, one normal direction.
  assert.deepEqual(metrics.normals, { recomputed: true, hardEdges: 0, mode: "smooth-crease" });
  assert.deepEqual(metrics.components, [
    { mesh: 0, primitive: 0, triangles: 2, diagonal: 2.828427, ratio: 1, triangleShare: 1, dropped: false },
  ]);

  const { json, bin } = parseGlbChunks(result.buffer);
  const primitive = json.meshes[0].primitives[0];
  assert.deepEqual(Object.keys(primitive.attributes).sort(), ["NORMAL", "POSITION", "TEXCOORD_0"]);
  const positions = readFloatAccessor(json, bin, primitive.attributes.POSITION).values;
  const box = boundsOf(positions);
  for (let axis = 0; axis < 3; axis++) {
    assert.ok(Math.abs(box.centre[axis]) < 1e-6, `centre ${axis}`);
    assert.ok(Math.abs(box.size[axis] - metrics.bounds.size[axis]) < 1e-6, `size ${axis}`);
  }
  assert.ok(Math.abs(Math.max(...box.size) - 1) < 1e-6);
  for (const view of json.bufferViews) assert.equal(view.byteOffset % 4, 0);
  const normals = readFloatAccessor(json, bin, primitive.attributes.NORMAL).values;
  for (let i = 0; i < normals.length; i += 3) {
    assert.ok(Math.abs(normals[i]) < 1e-6);
    assert.ok(Math.abs(normals[i + 1] - 1) < 1e-6);
    assert.ok(Math.abs(normals[i + 2]) < 1e-6);
  }
});

// ---------------------------------------------------------------------------
// b) + h) shard removal and a stable second pass

test("a floating four-triangle shard five units away is removed", () => {
  const body = boxGeometry();
  const shard = tetraGeometry({ origin: [5, 0, 0], size: 0.1 });
  const fixture = buildFixture({ meshes: [[primitiveOf(mergeGeometries(body, shard))]] });
  const result = refineGlb(fixture);
  assert.equal(result.reason, null);
  const metrics = result.metrics;
  assert.equal(metrics.componentsBefore, 2);
  assert.equal(metrics.componentsAfter, 1);
  assert.equal(metrics.fragmentsRemoved, 1);
  assert.equal(metrics.fragmentTrianglesRemoved, 4);
  assert.equal(metrics.trianglesBefore, 16);
  assert.equal(metrics.trianglesAfter, 12);
  assert.equal(metrics.verticesBefore, 12);
  // A box has three faces meeting at every corner at ninety degrees, so the
  // crease pass splits each of the eight corners into three: 8 -> 24.
  assert.equal(metrics.verticesAfter, 24);
  assert.equal(metrics.fragments.length, 1);
  assert.equal(metrics.fragments[0].triangles, 4);
  assert.ok(Math.abs(metrics.fragments[0].diagonal - Math.sqrt(3) * 0.1) < 1e-6);
  assert.deepEqual(metrics.fragments[0].centre, [5.05, 0.05, 0.05]);
  assert.equal(metrics.components.length, 2);
  assert.deepEqual(
    metrics.components.map((entry) => [entry.triangles, entry.dropped]),
    [[12, false], [4, true]],
  );
  // Ratios are per primitive: the body diagonal against the primitive box.
  assert.ok(Math.abs(metrics.components[0].ratio - 0.515197) < 1e-5);
  assert.ok(Math.abs(metrics.components[1].ratio - 0.025759) < 1e-5);
  assert.deepEqual(metrics.normals, { recomputed: true, hardEdges: 12, mode: "smooth-crease" });
  // The shard was five units out, so the surviving box is the unit cube.
  const box = refinedBounds(result.buffer);
  for (let axis = 0; axis < 3; axis++) {
    assert.ok(Math.abs(box.size[axis] - 1) < 1e-6);
    assert.ok(Math.abs(box.centre[axis]) < 1e-6);
  }
});

test("refining the refined body again is stable", () => {
  const fixture = buildFixture({
    meshes: [[primitiveOf(mergeGeometries(boxGeometry(), tetraGeometry({ origin: [5, 0, 0], size: 0.1 })))]],
  });
  const first = refineGlb(fixture);
  const second = refineGlb(first.buffer);
  assert.equal(second.reason, null);
  assert.equal(second.metrics.fragmentsRemoved, 0);
  assert.equal(second.metrics.trianglesBefore, first.metrics.trianglesAfter);
  assert.equal(second.metrics.trianglesAfter, first.metrics.trianglesAfter);
  assert.equal(second.metrics.verticesAfter, first.metrics.verticesAfter);
  assert.equal(second.metrics.gapsFilled, 0);
  assert.ok(Math.abs(second.metrics.scale - 1) < 1e-6);
  // The crease pass must not keep splitting on every pass.
  assert.equal(first.metrics.normals.hardEdges, 12);
  assert.equal(second.metrics.normals.hardEdges, 12);
  assert.equal(second.metrics.normals.recomputed, true);
});

// ---------------------------------------------------------------------------
// c) a small connected detail survives

test("a small knob welded to the body survives where its floating twin is dropped", () => {
  const body = boxGeometry({ min: [0, 0, 0], max: [10, 0.2, 10] });
  const attached = buildFixture({
    meshes: [[primitiveOf(mergeGeometries(body, tetraGeometry({ origin: [0, 0, 0], size: 0.1 })))]],
  });
  const kept = refineGlb(attached);
  assert.equal(kept.reason, null);
  assert.equal(kept.metrics.componentsBefore, 1, "the knob's corner welds to the body's corner");
  assert.equal(kept.metrics.fragmentsRemoved, 0);
  assert.equal(kept.metrics.trianglesAfter, 16);

  const floating = buildFixture({
    meshes: [[primitiveOf(mergeGeometries(body, tetraGeometry({ origin: [5, 5, 5], size: 0.1 })))]],
  });
  const dropped = refineGlb(floating);
  assert.equal(dropped.reason, null);
  assert.equal(dropped.metrics.componentsBefore, 2);
  assert.equal(dropped.metrics.fragmentsRemoved, 1);
  assert.equal(dropped.metrics.fragmentTrianglesRemoved, 4);
  assert.equal(dropped.metrics.trianglesAfter, 12);
});

// The rule the Photo Scan chair needs: a shard with ~2% of the triangles and a
// diagonal near 11% of the model is a fragment, while a separate part of the
// same triangle count whose diagonal is ~30% is a real part and stays.
test("a two-percent shard at 11% diagonal is dropped but a 30% separate part survives", () => {
  const body = gridGeometry({ cells: 10, size: 10 }); // 200 triangles, 0..10
  const shard = tetraGeometry({ origin: [13.5, 0.5, 5], size: 1.5 });
  const part = tetraGeometry({ origin: [5, 0.5, 13.5], size: 4.5 });
  const fixture = buildFixture({
    meshes: [[primitiveOf(mergeGeometries(body, shard, part))]],
  });
  const result = refineGlb(fixture);
  assert.equal(result.reason, null);
  const metrics = result.metrics;

  assert.equal(metrics.trianglesBefore, 208);
  assert.equal(metrics.trianglesAfter, 204);
  assert.equal(metrics.componentsBefore, 3);
  assert.equal(metrics.componentsAfter, 2);
  assert.equal(metrics.fragmentsRemoved, 1);
  assert.equal(metrics.fragmentTrianglesRemoved, 4);
  assert.deepEqual(
    metrics.components.map((entry) => [entry.triangles, entry.dropped]),
    [[200, false], [4, false], [4, true]],
  );
  // Both small components are 2% of the body's triangles...
  assert.equal(metrics.components[1].triangleShare, 0.02);
  assert.equal(metrics.components[2].triangleShare, 0.02);
  // ...and only the diagonal tells them apart.
  assert.ok(Math.abs(metrics.components[2].ratio - 0.1084) < 1e-3, "shard ~11%");
  assert.ok(Math.abs(metrics.components[1].ratio - 0.3254) < 1e-3, "part ~30%");
  assert.ok(metrics.components[2].diagonal < 0.15 * 23.958);
  assert.ok(metrics.components[1].diagonal > 0.15 * 23.958);

  // The kept part is still there: two components survive in the output.
  const { json, bin } = parseGlbChunks(result.buffer);
  const positions = readFloatAccessor(json, bin, json.meshes[0].primitives[0].attributes.POSITION);
  assert.equal(positions.count, 121 + 12); // the 11x11 sheet plus the creased part
  const box = refinedBounds(result.buffer);
  // The shard sat at x = 15, so the output frame is set by the part at z = 18.
  assert.ok(Math.abs(Math.max(...box.size) - 1) < 1e-6);
});

test("welding merges duplicated positions for connectivity but keeps every referenced vertex", () => {
  const fixture = buildFixture({ meshes: [[primitiveOf(unweldedBoxGeometry())]] });
  const result = refineGlb(fixture);
  assert.equal(result.reason, null);
  assert.equal(result.metrics.verticesBefore, 36);
  assert.equal(result.metrics.componentsBefore, 1);
  assert.equal(result.metrics.fragmentsRemoved, 0);
  assert.equal(result.metrics.trianglesAfter, 12);
  assert.equal(result.metrics.verticesAfter, 36);
});

// ---------------------------------------------------------------------------
// d) a triangular crack is filled

test("a one-triangle crack in a 3x3 grid is filled and the triangle count is restored", () => {
  const fixture = buildFixture({
    meshes: [[primitiveOf(gridGeometry({ cells: 3, size: 3, skip: { x: 1, z: 1, index: 0 } }))]],
  });
  const result = refineGlb(fixture, { gapMaxRatio: 0.9 });
  assert.equal(result.reason, null);
  const metrics = result.metrics;
  assert.equal(metrics.trianglesBefore, 17);
  assert.equal(metrics.trianglesAfter, 18);
  assert.equal(metrics.gapsFilled, 1);
  assert.equal(metrics.gapTrianglesAdded, 1);
  assert.equal(metrics.boundaryLoops, 2);
  assert.equal(metrics.openingsKept, 1);
  const filled = metrics.loops.filter((loop) => loop.filled);
  assert.equal(filled.length, 1);
  assert.equal(filled[0].vertices, 3);
  assert.ok(Math.abs(filled[0].perimeter - (2 + Math.SQRT2)) < 1e-6);
  assert.ok(Math.abs(filled[0].area - 0.5) < 1e-6);
  assert.ok(Math.abs(filled[0].bboxDiagonal - Math.SQRT2) < 1e-6);
  assert.deepEqual(metrics.loopsFilledByRatio, { filled: 1, skipped: 1, blocked: 0 });
  // Nine unit cells of area: the full sheet is back.
  assert.ok(Math.abs(triangleArea(result.buffer) - 1) < 1e-6);
  assert.equal(metrics.verticesAfter, 16); // the missing triangle added no vertex
});

test("a collinear crack is never closed with a zero-area triangle", () => {
  // The 3x3 grid with one triangle removed, but its third vertex slid onto the
  // line through the other two: the loop is small enough to fill and the fan
  // would be degenerate, so the loop must stay open.
  const grid = gridGeometry({ cells: 3, size: 3, skip: { x: 1, z: 1, index: 0 } });
  const moved = grid.positions.slice();
  // Vertex 10 used to be (2, 0, 2); (1, 0, 1.8) is on the segment 5 -> 9.
  moved[10 * 3] = 1;
  moved[10 * 3 + 2] = 1.8;
  const fixture = buildFixture({
    meshes: [[primitiveOf({ positions: moved, normals: grid.normals, indices: grid.indices })]],
  });
  const result = refineGlb(fixture, { gapMaxRatio: 0.9 });
  assert.equal(result.reason, null);
  assert.equal(result.metrics.gapsFilled, 0);
  assert.equal(result.metrics.trianglesAfter, 17);
  const loop = result.metrics.loops.find((entry) => entry.vertices === 3);
  assert.ok(loop, "the crack is still reported");
  assert.equal(loop.filled, false);
  assert.ok(loop.area < 1e-9);
  // Small enough for the widened budget, refused by the fan itself.
  assert.deepEqual(result.metrics.loopsFilledByRatio, { filled: 0, skipped: 1, blocked: 1 });
});

test("with the default 2% budget that same crack is treated as an opening", () => {
  // The crack is 3.414 around a sheet whose diagonal is 4.243: 80% of the model,
  // far above the micro-crack budget, so it stays open and is only reported.
  const fixture = buildFixture({
    meshes: [[primitiveOf(gridGeometry({ cells: 3, size: 3, skip: { x: 1, z: 1, index: 0 } }))]],
  });
  const result = refineGlb(fixture);
  assert.equal(result.reason, null);
  assert.equal(result.metrics.gapsFilled, 0);
  assert.equal(result.metrics.gapTrianglesAdded, 0);
  assert.equal(result.metrics.trianglesAfter, 17);
  assert.ok(result.metrics.loops.every((loop) => loop.filled === false));
  assert.deepEqual(result.metrics.loopsFilledByRatio, { filled: 0, skipped: 2, blocked: 0 });
});

test("the span guard can never reject a loop the perimeter budget accepts", () => {
  // A closed loop has to reach both ends of its bounding box and come back, so
  // perimeter >= 2 * bboxDiagonal always holds. The span guard is therefore a
  // documented safeguard rather than a second filter: no fixture can trip it
  // alone. Assert the invariant on a hole, a rim and a crack.
  const cases = [
    [primitiveOf(ringGeometry()), {}],
    [primitiveOf(tubeGeometry()), { gapMaxRatio: 2 }],
    [primitiveOf(gridGeometry({ cells: 3, size: 3, skip: { x: 1, z: 1, index: 0 } })), {}],
  ];
  for (const [primitive, options] of cases) {
    const result = refineGlb(buildFixture({ meshes: [[primitive]] }), options);
    assert.equal(result.reason, null);
    assert.ok(result.metrics.loops.length > 0);
    for (const loop of result.metrics.loops) {
      assert.ok(
        loop.bboxDiagonal <= loop.perimeter / 2 + 1e-6,
        `span ${loop.bboxDiagonal} <= perimeter/2 ${loop.perimeter / 2}`,
      );
    }
  }
});

test("a four-vertex crack fans through one new vertex with averaged UVs", () => {
  const fixture = buildFixture({
    meshes: [[primitiveOf(gridGeometry({ cells: 3, size: 3, skip: { x: 1, z: 1, both: true } }))]],
  });
  const result = refineGlb(fixture, { gapMaxRatio: 1 });
  assert.equal(result.reason, null);
  const metrics = result.metrics;
  assert.equal(metrics.trianglesBefore, 16);
  assert.equal(metrics.trianglesAfter, 20);
  assert.equal(metrics.gapsFilled, 1);
  assert.equal(metrics.gapTrianglesAdded, 4);
  assert.equal(metrics.verticesAfter, 17);

  const { json, bin } = parseGlbChunks(result.buffer);
  const primitive = json.meshes[0].primitives[0];
  const positions = readFloatAccessor(json, bin, primitive.attributes.POSITION).values;
  const uvs = readFloatAccessor(json, bin, primitive.attributes.TEXCOORD_0).values;
  // The added vertex is appended last and sits at the centre of the hole.
  const last = positions.length / 3 - 1;
  assert.ok(Math.abs(positions[last * 3]) < 1e-6);
  assert.ok(Math.abs(positions[last * 3 + 1]) < 1e-6);
  assert.ok(Math.abs(positions[last * 3 + 2]) < 1e-6);
  assert.ok(Math.abs(uvs[last * 2] - 0.5) < 1e-6);
  assert.ok(Math.abs(uvs[last * 2 + 1] - 0.5) < 1e-6);
});

// ---------------------------------------------------------------------------
// e) genuine openings survive

test("a ring's handle hole is reported as an opening and never capped", () => {
  const fixture = buildFixture({ meshes: [[primitiveOf(ringGeometry())]] });
  const result = refineGlb(fixture);
  assert.equal(result.reason, null);
  const metrics = result.metrics;
  assert.equal(metrics.trianglesAfter, 8);
  assert.equal(metrics.gapsFilled, 0);
  assert.ok(metrics.openingsKept >= 1);
  const hole = metrics.loops.find((loop) => loop.vertices === 4 && loop.perimeter < 5);
  assert.ok(hole, "the inner rim is reported");
  assert.equal(hole.filled, false);
  assert.ok(Math.abs(hole.perimeter - 4) < 1e-6);
  assert.ok(Math.abs(hole.area - 1) < 1e-6);
  assert.equal(metrics.loops.length, 2, "outer rim plus handle hole");
  assert.deepEqual(metrics.loopsFilledByRatio, { filled: 0, skipped: 2, blocked: 0 });
  assert.equal(metrics.normals.hardEdges, 0, "a flat ring is one smoothing group");
  // The sheet is 4x4 with a 1x1 hole; scaled by 1/4 the area is 15/16, not 1.
  assert.ok(Math.abs(triangleArea(result.buffer) - 15 / 16) < 1e-6);
});

test("an open tube rim survives even when the size budget would allow a cap", () => {
  const fixture = buildFixture({ meshes: [[primitiveOf(tubeGeometry())]] });
  const result = refineGlb(fixture, { gapMaxRatio: 2 });
  assert.equal(result.reason, null);
  const metrics = result.metrics;
  assert.equal(metrics.trianglesAfter, 8);
  assert.equal(metrics.gapsFilled, 0);
  assert.ok(metrics.openingsKept >= 2);
  assert.equal(metrics.boundaryLoops, 2);
  for (const loop of metrics.loops) {
    assert.equal(loop.vertices, 4);
    assert.equal(loop.filled, false);
    // The rim is small enough for the widened budget: the normals, not the
    // size, are what kept it open.
    assert.ok(loop.perimeter <= 2 * 2.449 + 1e-3);
  }
  assert.deepEqual(metrics.loopsFilledByRatio, { filled: 0, skipped: 0, blocked: 2 });
});

// ---------------------------------------------------------------------------
// f) texture preserved

test("the JPEG survives byte for byte and material/nodes keep their shape", () => {
  const imageBytes = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46,
    0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
  ]);
  const rotation = [0.7071068, 0, 0, 0.7071068];
  const fixture = buildFixture({
    meshes: [[primitiveOf(planeGeometry())]],
    imageBytes,
    rotation,
    withMaterial: true,
  });
  const result = refineGlb(fixture);
  assert.equal(result.reason, null);
  const source = unpackGlb(fixture);
  const output = parseGlbChunks(result.buffer);

  assert.equal(output.json.images.length, 1);
  const imageView = output.json.bufferViews[output.json.images[0].bufferView];
  const copied = output.bin.subarray(
    imageView.byteOffset ?? 0,
    (imageView.byteOffset ?? 0) + imageView.byteLength,
  );
  assert.equal(copied.length, imageBytes.length);
  assert.deepEqual([...copied], [...imageBytes]);
  const sourceImageView = source.json.bufferViews[source.json.images[0].bufferView];
  const original = source.bin.subarray(
    sourceImageView.byteOffset ?? 0,
    (sourceImageView.byteOffset ?? 0) + sourceImageView.byteLength,
  );
  assert.deepEqual([...copied], [...original]);

  const material = output.json.materials[0];
  assert.equal(material.doubleSided, true);
  const texture = output.json.textures[material.pbrMetallicRoughness.baseColorTexture.index];
  assert.ok(texture, "baseColorTexture resolves");
  const image = output.json.images[texture.source];
  assert.equal(image.mimeType, "image/jpeg");
  assert.ok(Number.isInteger(image.bufferView));
  assert.deepEqual(output.json.nodes[0].rotation, rotation);
  assert.equal(output.json.scenes[0].nodes[0], 0);

  const artifact = validateGlb(result.buffer);
  assert.equal(artifact.triangles, 2);
  assert.equal(artifact.textures, 1);
  // Four geometry views (position, normal, uv, indices) plus the image.
  assert.equal(output.json.bufferViews.length, 5);
});

// ---------------------------------------------------------------------------
// g) refusals and malformed input

test("an unsupported attribute returns a reason instead of throwing", () => {
  const primitive = primitiveOf(planeGeometry(), {
    attributes: {
      JOINTS_0: { data: [0, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0], type: "VEC4", componentType: UINT8 },
      WEIGHTS_0: {
        data: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
        type: "VEC4",
        componentType: FLOAT,
      },
    },
  });
  const result = refineGlb(buildFixture({ meshes: [[primitive]] }));
  assert.deepEqual(result, { buffer: null, metrics: null, reason: "unsupported_attribute" });
});

test("droppable attributes are dropped and listed", () => {
  const primitive = primitiveOf(planeGeometry(), {
    attributes: {
      COLOR_0: { data: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], type: "VEC3", componentType: FLOAT },
      TEXCOORD_1: { data: [0, 0, 1, 0, 1, 1, 0, 1], type: "VEC2", componentType: FLOAT },
    },
  });
  const result = refineGlb(buildFixture({ meshes: [[primitive]] }));
  assert.equal(result.reason, null);
  assert.deepEqual(result.metrics.droppedAttributes, ["COLOR_0", "TEXCOORD_1"]);
  const { json } = parseGlbChunks(result.buffer);
  const attributes = json.meshes[0].primitives[0].attributes;
  assert.equal(attributes.COLOR_0, undefined);
  assert.equal(attributes.TEXCOORD_1, undefined);
  assert.deepEqual(Object.keys(attributes).sort(), ["NORMAL", "POSITION", "TEXCOORD_0"]);
});

test("an unsupported accessor layout returns unsupported_accessor", () => {
  const fixture = buildFixture({ meshes: [[primitiveOf(planeGeometry())]] });
  const { json, bin } = unpackGlb(fixture);
  assert.equal(json.accessors[0].componentType, FLOAT);
  json.accessors[0].componentType = UINT16; // POSITION is no longer float32
  const widened = refineGlb(packGlb(json, bin));
  assert.equal(widened.buffer, null);
  assert.equal(widened.reason, "unsupported_accessor");

  const sparse = unpackGlb(fixture);
  sparse.json.accessors[0].sparse = { count: 1, indices: {}, values: {} };
  const sparseResult = refineGlb(packGlb(sparse.json, sparse.bin));
  assert.equal(sparseResult.reason, "unsupported_accessor");
});

test("an empty GLB reports no_triangles and a fully dropped mesh reports nothing_left", () => {
  const empty = buildFixture({ meshes: [[]] });
  assert.equal(refineGlb(empty).reason, "no_triangles");

  const pair = mergeGeometries(
    tetraGeometry({ origin: [0, 0, 0], size: 0.1 }),
    tetraGeometry({ origin: [100, 0, 0], size: 0.1 }),
  );
  const result = refineGlb(buildFixture({ meshes: [[primitiveOf(pair)]] }));
  assert.deepEqual(result, { buffer: null, metrics: null, reason: "nothing_left" });
});

test("a malformed GLB throws KiriError model_invalid", () => {
  const fixture = buildFixture({ meshes: [[primitiveOf(planeGeometry())]] });
  const isInvalid = (error) => {
    assert.ok(error instanceof KiriError, "KiriError");
    assert.equal(error.code, "model_invalid");
    return true;
  };
  assert.throws(() => refineGlb(Buffer.alloc(0)), isInvalid);
  assert.throws(() => refineGlb(Buffer.alloc(24)), isInvalid);
  const badMagic = Buffer.from(fixture);
  badMagic.writeUInt32LE(0, 0);
  assert.throws(() => refineGlb(badMagic), isInvalid);
  assert.throws(() => refineGlb(fixture.subarray(0, fixture.length - 64)), isInvalid);
  assert.throws(() => refineGlb(fixture.subarray(0, 40)), isInvalid);
  const { json } = unpackGlb(fixture);
  assert.throws(() => refineGlb(packJsonOnly(json)), isInvalid);
  assert.throws(() => parseGlbChunks(Buffer.alloc(0)), isInvalid);
});

// ---------------------------------------------------------------------------
// i) multiple primitives / meshes

test("multiple primitives and meshes round-trip independently", () => {
  const fixture = buildFixture({
    meshes: [
      [primitiveOf(boxGeometry()), primitiveOf(planeGeometry())],
      [primitiveOf(tetraGeometry({ origin: [0, 2, 0], size: 0.5 }))],
    ],
  });
  const result = refineGlb(fixture);
  assert.equal(result.reason, null);
  assert.equal(result.metrics.trianglesBefore, 18);
  assert.equal(result.metrics.trianglesAfter, 18);
  assert.equal(validateGlb(result.buffer).triangles, 18);

  const { json, bin } = parseGlbChunks(result.buffer);
  assert.equal(json.meshes.length, 2);
  assert.equal(json.meshes[0].primitives.length, 2);
  assert.equal(json.meshes[1].primitives.length, 1);
  const counts = [];
  for (const mesh of json.meshes) {
    for (const primitive of mesh.primitives) {
      const positions = readFloatAccessor(json, bin, primitive.attributes.POSITION);
      const indices = readIndices(json, bin, primitive.indices);
      assert.equal(indices.length % 3, 0);
      for (const index of indices) assert.ok(index < positions.count);
      assert.ok(Number.isInteger(primitive.attributes.NORMAL));
      counts.push(positions.count);
    }
  }
  // Box: three creased faces per corner, 8 -> 24. Flat plane: 4. Tetra: every
  // dihedral is 70.5 degrees, so all four corners split three ways, 4 -> 12.
  assert.deepEqual(counts, [24, 4, 12]);
  assert.deepEqual(
    result.metrics.normals,
    { recomputed: true, hardEdges: 12 + 0 + 6, mode: "smooth-crease" },
  );
});

test("missing normals are recomputed and missing UVs stay missing", () => {
  const plane = planeGeometry();
  const primitive = primitiveOf({ positions: plane.positions, indices: plane.indices });
  const result = refineGlb(buildFixture({ meshes: [[primitive]] }));
  assert.equal(result.reason, null);
  assert.deepEqual(result.metrics.normals, { recomputed: true, hardEdges: 0, mode: "smooth-crease" });
  const { json, bin } = parseGlbChunks(result.buffer);
  const out = json.meshes[0].primitives[0];
  assert.deepEqual(Object.keys(out.attributes).sort(), ["NORMAL", "POSITION"]);
  const normals = readFloatAccessor(json, bin, out.attributes.NORMAL).values;
  for (let i = 0; i < normals.length; i += 3) {
    assert.ok(Math.abs(normals[i]) < 1e-6);
    assert.ok(Math.abs(normals[i + 1] - 1) < 1e-6);
    assert.ok(Math.abs(normals[i + 2]) < 1e-6);
  }
});

// ---------------------------------------------------------------------------
// normals: angle-weighted smoothing with a crease threshold

test("a flat plane keeps one normal direction even when the input disagrees", () => {
  // seamPlaneGeometry ships opposite normals on the two halves; the pass must
  // weld the shared diagonal, average across it and emit one direction.
  const fixture = buildFixture({ meshes: [[primitiveOf(seamPlaneGeometry())]] });
  const result = refineGlb(fixture);
  assert.equal(result.reason, null);
  assert.equal(result.metrics.verticesBefore, 6);
  assert.equal(result.metrics.verticesAfter, 6);
  assert.deepEqual(result.metrics.normals, { recomputed: true, hardEdges: 0, mode: "smooth-crease" });
  const { json, bin } = parseGlbChunks(result.buffer);
  const normals = readFloatAccessor(
    json,
    bin,
    json.meshes[0].primitives[0].attributes.NORMAL,
  ).values;
  for (let i = 0; i < normals.length; i += 3) {
    assert.ok(Math.abs(normals[i]) < 1e-6, `x at ${i / 3}`);
    assert.ok(Math.abs(normals[i + 2]) < 1e-6, `z at ${i / 3}`);
    assert.ok(Math.abs(Math.abs(normals[i + 1]) - 1) < 1e-6, `y at ${i / 3}`);
  }
});

test("a ninety-degree crease keeps two distinct normal groups", () => {
  const fixture = buildFixture({ meshes: [[primitiveOf(creaseGeometry())]] });
  const result = refineGlb(fixture);
  assert.equal(result.reason, null);
  assert.equal(result.metrics.trianglesAfter, 4);
  // A and B sit on the crease and split in two; C, D, E, F keep one slot each.
  assert.equal(result.metrics.verticesAfter, 8);
  assert.deepEqual(result.metrics.normals, { recomputed: true, hardEdges: 1, mode: "smooth-crease" });

  const { json, bin } = parseGlbChunks(result.buffer);
  const normals = readFloatAccessor(
    json,
    bin,
    json.meshes[0].primitives[0].attributes.NORMAL,
  ).values;
  const directions = [];
  for (let i = 0; i < normals.length; i += 3) {
    const rounded = [0, 1, 2].map((axis) => Math.round(normals[i + axis] * 1e6) / 1e6);
    assert.ok(Math.abs(Math.hypot(...rounded) - 1) < 1e-6, "unit normal");
    directions.push(rounded.join(","));
  }
  assert.deepEqual([...new Set(directions)].sort(), ["0,0,1", "0,1,0"]);
  assert.equal(directions.filter((key) => key === "0,1,0").length, 4);
  assert.equal(directions.filter((key) => key === "0,0,1").length, 4);
});

test("options.normals 'keep' copies the input normals untouched", () => {
  const plane = planeGeometry();
  const normals = new Array(plane.normals.length).fill(0);
  for (let i = 2; i < normals.length; i += 3) normals[i] = 1; // deliberately +z
  const fixture = buildFixture({ meshes: [[primitiveOf({ ...plane, normals })]] });
  const result = refineGlb(fixture, { normals: "keep" });
  assert.equal(result.reason, null);
  assert.equal(result.metrics.verticesAfter, 4);
  assert.deepEqual(result.metrics.normals, { recomputed: false, hardEdges: 0, mode: "keep" });
  const { json, bin } = parseGlbChunks(result.buffer);
  const out = readFloatAccessor(
    json,
    bin,
    json.meshes[0].primitives[0].attributes.NORMAL,
  ).values;
  for (let i = 0; i < out.length; i += 3) {
    assert.ok(Math.abs(out[i]) < 1e-6);
    assert.ok(Math.abs(out[i + 1]) < 1e-6);
    assert.ok(Math.abs(out[i + 2] - 1) < 1e-6);
  }
});

test("normalCreaseDeg moves the crease: a 30-degree angle is smooth at 40 and hard at 10", () => {
  const fixture = buildFixture({ meshes: [[primitiveOf(creaseGeometry())]] });
  const wide = refineGlb(fixture, { normalCreaseDeg: 180 });
  assert.equal(wide.reason, null);
  assert.deepEqual(wide.metrics.normals, { recomputed: true, hardEdges: 0, mode: "smooth-crease" });
  // Everything smooth: A and B collapse to one slot each, so 8 -> 6.
  assert.equal(wide.metrics.verticesAfter, 6);

  const tight = refineGlb(fixture, { normalCreaseDeg: 10 });
  assert.equal(tight.metrics.normals.hardEdges, 1);
  assert.equal(tight.metrics.verticesAfter, 8);
});

test("indices switch to uint32 above 65535 vertices", () => {
  // 257 x 257 vertices = 66049, one connected sheet.
  const fixture = buildFixture({
    meshes: [[primitiveOf(gridGeometry({ cells: 256, size: 256 }), { indexComponentType: 5125 })]],
  });
  const result = refineGlb(fixture);
  assert.equal(result.reason, null);
  assert.equal(result.metrics.verticesAfter, 257 * 257);
  const { json, bin } = parseGlbChunks(result.buffer);
  const primitive = json.meshes[0].primitives[0];
  const indexAccessor = json.accessors[primitive.indices];
  assert.equal(indexAccessor.componentType, 5125);
  assert.ok(indexAccessor.max[0] >= 65536);
  const indices = readIndices(json, bin, primitive.indices);
  assert.equal(indices.length, 2 * 256 * 256 * 3);
});
// ---------------------------------------------------------------------------
// coverage: how much of the silhouette looks straight through

// The same cube with its +z face missing: a bowl, not a see-through box.
function openBoxGeometry() {
  const base = boxGeometry();
  return {
    positions: base.positions,
    normals: base.normals,
    indices: base.indices.slice(0, base.indices.length - 6),
  };
}

// A flat sheet with a rectangular window punched right through it.
function holedSheetGeometry({
  cells = 6,
  size = 6,
  hole = { x: 2, z: 2, width: 2, depth: 2 },
} = {}) {
  const step = size / cells;
  const positions = [];
  const normals = [];
  const vertexIndex = (x, z) => z * (cells + 1) + x;
  for (let z = 0; z <= cells; z++) {
    for (let x = 0; x <= cells; x++) {
      positions.push(x * step, 0, z * step);
      normals.push(0, 1, 0);
    }
  }
  const indices = [];
  for (let z = 0; z < cells; z++) {
    for (let x = 0; x < cells; x++) {
      const inHole =
        x >= hole.x && x < hole.x + hole.width && z >= hole.z && z < hole.z + hole.depth;
      if (inHole) continue;
      const i00 = vertexIndex(x, z);
      const i10 = vertexIndex(x + 1, z);
      const i01 = vertexIndex(x, z + 1);
      const i11 = vertexIndex(x + 1, z + 1);
      indices.push(i00, i01, i11, i00, i11, i10);
    }
  }
  return { positions, normals, indices };
}

// A square frame of four welded bars with a real 2x2 window in the middle:
// the torus-like ring from the brief, built from boxes so every face is known.
function squareFrameGeometry() {
  return mergeGeometries(
    boxGeometry({ min: [0, 0, 0], max: [4, 1, 1] }),
    boxGeometry({ min: [0, 0, 3], max: [4, 1, 4] }),
    boxGeometry({ min: [0, 0, 1], max: [1, 1, 3] }),
    boxGeometry({ min: [3, 0, 1], max: [4, 1, 3] }),
  );
}

function geometryArrays(geometry) {
  return {
    positions: Float32Array.from(geometry.positions),
    indices: Uint32Array.from(geometry.indices),
  };
}

// Read one primitive of a GLB back as { positions, indices }.
function geometryOfGlb(buffer, meshIndex = 0, primitiveIndex = 0) {
  const { json, bin } = parseGlbChunks(buffer);
  const primitive = json.meshes[meshIndex].primitives[primitiveIndex];
  return {
    positions: Float32Array.from(
      readFloatAccessor(json, bin, primitive.attributes.POSITION).values,
    ),
    indices: Uint32Array.from(readIndices(json, bin, primitive.indices)),
  };
}

test("COVERAGE_DEFAULTS and COVERAGE_VERDICTS are frozen and documented", () => {
  assert.ok(Object.isFrozen(COVERAGE_DEFAULTS));
  assert.deepEqual({ ...COVERAGE_DEFAULTS }, {
    grid: 128,
    weldEpsilonRatio: 1e-6,
    holeBudget: 0.02,
  });
  assert.ok(Object.isFrozen(COVERAGE_VERDICTS));
  assert.deepEqual({ ...COVERAGE_VERDICTS }, { clean: "bersih", perforated: "berlubang" });
});

test("a closed box is watertight and looks through nothing", () => {
  const coverage = analyzeCoverage(geometryArrays(boxGeometry()));
  assert.equal(coverage.maxHoleRatio, 0);
  assert.deepEqual(coverage.axes.map((entry) => entry.axis), [0, 1, 2]);
  assert.deepEqual(coverage.axes.map((entry) => entry.axisName), ["x", "y", "z"]);
  assert.deepEqual(coverage.axes.map((entry) => entry.holeRatio), [0, 0, 0]);
  assert.deepEqual(coverage.axes.map((entry) => entry.holePixels), [0, 0, 0]);
  assert.deepEqual(coverage.axes.map((entry) => entry.largestHolePixels), [0, 0, 0]);
  // The cube's footprint covers every projected pixel of its own silhouette.
  assert.deepEqual(
    coverage.axes.map((entry) => entry.silhouettePixels),
    [128 * 128, 128 * 128, 128 * 128],
  );
  assert.equal(coverage.boundaryEdges, 0);
  assert.equal(coverage.nonManifoldEdges, 0);
  assert.equal(coverage.watertight, true);
  assert.equal(coverage.grid, 128);
  assert.deepEqual(coverage.dims, [128, 128, 128]);
  assert.ok(Number.isFinite(coverage.ms));
});

test("coverage reports see-through columns, not missing faces", () => {
  // A box with its +z face removed is a bowl: a ray that enters the opening
  // lands on the far wall, so nothing is see-through there. The measured ratio
  // is 0 on all three axes (asserted, not wished), while the topology
  // diagnostics do report the open rim.
  const open = analyzeCoverage(geometryArrays(openBoxGeometry()));
  assert.equal(open.boundaryEdges, 4);
  assert.equal(open.nonManifoldEdges, 0);
  assert.equal(open.watertight, false);
  assert.deepEqual(open.axes.map((entry) => entry.holeRatio), [0, 0, 0]);
  assert.equal(open.maxHoleRatio, 0);

  // Punch that kind of hole through a sheet and the axis looking through it is
  // reported: a 2x2 window in a 6x6 sheet is 4/36 = 11.1% of the silhouette,
  // and the other two axes stay blocked by the sheet itself.
  const sheet = analyzeCoverage(geometryArrays(holedSheetGeometry()));
  const [x, y, z] = sheet.axes.map((entry) => entry.holeRatio);
  assert.equal(x, 0);
  assert.equal(z, 0);
  assert.ok(Math.abs(y - 4 / 36) < 0.02, `y ${y}`);
  assert.equal(sheet.axes[1].largestHolePixels, sheet.axes[1].holePixels);
  assert.equal(sheet.maxHoleRatio, sheet.axes[1].holeRatio);
  // Outer rim (4 x 6 edges) plus the hole's rim (4 x 2 edges).
  assert.equal(sheet.boundaryEdges, 4 * 6 + 4 * 2);
  assert.equal(sheet.watertight, false);
});

test("a thin frame's real opening is measured as see-through area, not wished away", () => {
  // A voxel projection cannot tell a legitimate opening (this frame's window)
  // from a reconstruction defect: both are columns through which nothing is
  // seen. So this asserts the measured number - a 2x2 window in a 4x4 frame is
  // 25% - instead of pretending it is zero. What keeps a real opening open is
  // the fill policy (gapMaxRatio and the normal gate), never this metric.
  const coverage = analyzeCoverage(geometryArrays(squareFrameGeometry()));
  const [x, y, z] = coverage.axes.map((entry) => entry.holeRatio);
  // Looking along x or z runs into the frame's own side bars; only y sees through.
  assert.equal(x, 0);
  assert.equal(z, 0);
  assert.ok(Math.abs(y - 0.25) < 0.03, `y ${y}`);
  assert.equal(coverage.maxHoleRatio, coverage.axes[1].holeRatio);
  assert.ok(coverage.axes[1].largestHolePixels > 0);
  // The window is one hole, not a scatter of specks.
  assert.equal(coverage.axes[1].largestHolePixels, coverage.axes[1].holePixels);
});

test("coverage is deterministic for the same geometry", () => {
  const geometry = geometryArrays(holedSheetGeometry());
  const strip = ({ ms, ...rest }) => rest;
  const first = analyzeCoverage(geometry);
  const second = analyzeCoverage(geometry);
  assert.deepEqual(strip(first), strip(second));
  // An explicit smaller grid is deterministic too, and never more pessimistic
  // than the finer one: a thin hole can close up at low resolution.
  const coarse = analyzeCoverage(geometry, { grid: 32 });
  assert.deepEqual(strip(coarse), strip(analyzeCoverage(geometry, { grid: 32 })));
  assert.equal(coarse.grid, 32);
  assert.ok(coarse.maxHoleRatio <= first.maxHoleRatio + 1e-9);
  // Out-of-range grids are clamped, never a crash.
  assert.equal(analyzeCoverage(geometry, { grid: 2 }).grid, 8);
  assert.equal(analyzeCoverage(geometry, { grid: 10_000 }).grid, 512);
});

test("the live chair reports the see-through holes its renders show", (t) => {
  const path = "var/refine/live/chair-refined.glb";
  if (!existsSync(path)) {
    t.skip("var/refine/live/chair-refined.glb is absent (var/ is git-ignored)");
    return;
  }
  const coverage = analyzeCoverage(geometryOfGlb(readFileSync(path)));
  assert.notEqual(coverage.maxHoleRatio, 0);
  assert.ok(coverage.maxHoleRatio > 0.02, `holeRatio ${coverage.maxHoleRatio}`);
  // The rims are not one-face edges: the shell is closed, which is exactly why
  // analyzeMesh reported boundaryLoops 0 while the render showed four holes.
  assert.equal(coverage.boundaryEdges, 0);
  assert.equal(coverage.nonManifoldEdges, 0);
  assert.equal(coverage.watertight, true);
  const worst = coverage.axes.reduce((top, entry) =>
    entry.holeRatio > top.holeRatio ? entry : top,
  );
  assert.equal(coverage.maxHoleRatio, worst.holeRatio);
  assert.ok(worst.largestHolePixels > 100, `largest ${worst.largestHolePixels}`);
  assert.ok(coverage.ms < 400, `coverage took ${coverage.ms} ms`);
});

test("refineGlb records coverageBefore/coverageAfter and a stable verdict", () => {
  const box = refineGlb(buildFixture({ meshes: [[primitiveOf(boxGeometry())]] }));
  assert.equal(box.reason, null);
  const metrics = box.metrics;
  assert.equal(metrics.holeRatioBefore, 0);
  assert.equal(metrics.holeRatioAfter, 0);
  assert.equal(metrics.coverage.verdict, COVERAGE_VERDICTS.clean);
  assert.equal(metrics.coverage.verdict, "bersih");
  assert.match(metrics.coverage.verdictRationale, /2%/);
  assert.deepEqual(metrics.coverage.axes, metrics.coverageAfter.axes);
  assert.equal(metrics.coverage.holeRatioBefore, 0);
  assert.equal(metrics.coverage.watertight, true);
  assert.equal(metrics.coverageBefore.watertight, true);
  assert.equal(metrics.coverage.grid, 128);
  // Refining neither closes nor invents anything for a watertight mesh.
  assert.equal(metrics.coverageBefore.maxHoleRatio, metrics.coverageAfter.maxHoleRatio);
  // Every key from before this feature is still there.
  for (const key of [
    "trianglesBefore", "trianglesAfter", "verticesBefore", "verticesAfter",
    "componentsBefore", "componentsAfter", "fragmentsRemoved",
    "fragmentTrianglesRemoved", "boundaryLoops", "gapsFilled", "gapTrianglesAdded",
    "loops", "loopsFilledByRatio", "openingsKept", "bounds", "boundsBefore",
    "scale", "targetSize", "centres", "normals", "components", "fragments",
    "droppedAttributes", "ms",
  ]) {
    assert.ok(key in metrics, `missing metrics.${key}`);
  }

  // A punched sheet keeps its hole: coverage says "berlubang", and the fill
  // policy adds no membrane across it.
  const sheet = refineGlb(buildFixture({ meshes: [[primitiveOf(holedSheetGeometry())]] }));
  assert.equal(sheet.reason, null);
  assert.equal(sheet.metrics.coverage.verdict, COVERAGE_VERDICTS.perforated);
  assert.equal(sheet.metrics.coverage.verdict, "berlubang");
  // The DTO reads coverage.holeRatioAfter, not only the top-level copy: when
  // this was missing the page silently dropped its see-through sentence.
  assert.equal(sheet.metrics.coverage.holeRatioAfter, sheet.metrics.holeRatioAfter);
  assert.ok(sheet.metrics.coverage.holeRatioBefore >= sheet.metrics.holeRatioBefore - 1e-9);
  assert.equal(typeof sheet.metrics.coverage.worstAxis, "string");
  assert.ok(sheet.metrics.holeRatioBefore > 0.02);
  assert.ok(sheet.metrics.holeRatioAfter > 0.02);
  assert.equal(sheet.metrics.gapsFilled, 0);
  assert.equal(sheet.metrics.trianglesAfter, sheet.metrics.trianglesBefore);
});

test("coverage survives a second refine unchanged", () => {
  const fixture = buildFixture({ meshes: [[primitiveOf(holedSheetGeometry())]] });
  const first = refineGlb(fixture);
  const second = refineGlb(first.buffer);
  assert.equal(second.reason, null);
  assert.equal(second.metrics.holeRatioBefore, first.metrics.holeRatioAfter);
  assert.equal(second.metrics.holeRatioAfter, first.metrics.holeRatioAfter);
  assert.equal(second.metrics.coverage.verdict, first.metrics.coverage.verdict);
  assert.deepEqual(second.metrics.coverageAfter.axes, first.metrics.coverageAfter.axes);
});
