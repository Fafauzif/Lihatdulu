import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { KiriError } from "./kiri-errors.mjs";
import { crc32 } from "./zip.mjs";

// Explicitly labelled simulation. Same interface as the live adapter, but the
// status advances on a clock, the ZIP is generated locally from a synthetic
// splat cloud and no network request leaves the machine. KIRI_MOCK=1 is the
// only way to select it, and every job it creates is marked provider "mock".

const PROVIDER = "mock";

function zipStore(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const data = Buffer.from(entry.data);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, directory, end]);
}

// A deterministic stand-in for a real chair scan: seat, backrest and four
// legs sampled as gaussians, so the mock exercises the real PLY validation,
// the real splat-transform conversion and the real viewer.
export function syntheticChairPly() {
  const points = [];
  let seed = 0x9e3779b9;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  const add = (x, y, z, warmth) => {
    points.push([x, y, z, warmth]);
  };
  for (let index = 0; index < 9000; index += 1) {
    const x = (random() - 0.5) * 0.92;
    const z = (random() - 0.5) * 0.92;
    add(x, 0.46 + (random() - 0.5) * 0.02, z, 1);
  }
  for (let index = 0; index < 7000; index += 1) {
    const x = (random() - 0.5) * 0.92;
    const y = 0.5 + random() * 0.62;
    add(x, y, -0.46 + (random() - 0.5) * 0.02, 0.85);
  }
  for (const [sx, sz] of [
    [-0.4, -0.4],
    [0.4, -0.4],
    [-0.4, 0.4],
    [0.4, 0.4],
  ])
    for (let index = 0; index < 1400; index += 1) {
      const y = random() * 0.46;
      add(
        sx + (random() - 0.5) * 0.04,
        y,
        sz + (random() - 0.5) * 0.04,
        0.7,
      );
    }

  const properties = [
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
  ];
  const header = [
    "ply",
    "format binary_little_endian 1.0",
    `element vertex ${points.length}`,
    ...properties.map((name) => `property float ${name}`),
    "end_header",
    "",
  ].join("\n");
  const body = Buffer.alloc(points.length * properties.length * 4);
  let cursor = 0;
  for (const [x, y, z, warmth] of points) {
    const red = (0.62 * warmth - 0.5) / 0.28209479177387814;
    const green = (0.44 * warmth - 0.5) / 0.28209479177387814;
    const blue = (0.3 * warmth - 0.5) / 0.28209479177387814;
    for (const value of [
      x,
      y,
      z,
      red,
      green,
      blue,
      2.6,
      -4.1,
      -4.1,
      -4.1,
      1,
      0,
      0,
      0,
    ]) {
      body.writeFloatLE(value, cursor);
      cursor += 4;
    }
  }
  return Buffer.concat([Buffer.from(header, "ascii"), body]);
}

// A minimal but valid GLB: two boxes standing in for a chair seat and back.
// The mesh profile has to be exercisable without credits and without KIRI, and
// the browser check needs real geometry to orbit.
export function syntheticChairGlb() {
  const positions = [];
  const normals = [];
  const indices = [];
  const faces = [
    [[1, 0, 0], [[1, 0, -1], [1, 0, 1], [1, 1, 1], [1, 1, -1]]],
    [[-1, 0, 0], [[-1, 0, 1], [-1, 0, -1], [-1, 1, -1], [-1, 1, 1]]],
    [[0, 1, 0], [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]]],
    [[0, -1, 0], [[-1, 0, -1], [1, 0, -1], [1, 0, 1], [-1, 0, 1]]],
    [[0, 0, 1], [[-1, 0, 1], [1, 0, 1], [1, 1, 1], [-1, 1, 1]]],
    [[0, 0, -1], [[1, 0, -1], [-1, 0, -1], [-1, 1, -1], [1, 1, -1]]],
  ];
  const box = (cx, cy, cz, sx, sy, sz) => {
    const base = positions.length / 3;
    for (const [normal, corners] of faces) {
      for (const corner of corners) {
        positions.push(
          cx + (corner[0] * sx) / 2,
          cy + (corner[1] * sy) / 2,
          cz + (corner[2] * sz) / 2,
        );
        normals.push(...normal);
      }
      const offset = positions.length / 3 - 4;
      indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
    }
    return base;
  };
  box(0, 0.45, 0, 0.9, 0.08, 0.9);
  box(0, 0.78, -0.41, 0.9, 0.62, 0.08);
  for (const [x, z] of [
    [-0.36, -0.36],
    [0.36, -0.36],
    [-0.36, 0.36],
    [0.36, 0.36],
  ])
    box(x, 0.2, z, 0.06, 0.4, 0.06);

  const position = Buffer.alloc(positions.length * 4);
  positions.forEach((value, index) => position.writeFloatLE(value, index * 4));
  const normal = Buffer.alloc(normals.length * 4);
  normals.forEach((value, index) => normal.writeFloatLE(value, index * 4));
  const index = Buffer.alloc(indices.length * 2);
  indices.forEach((value, at) => index.writeUInt16LE(value, at * 2));

  const binary = Buffer.concat([position, normal, index]);
  const json = {
    asset: { version: "2.0", generator: "LihatDulu mock" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2 }] }],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: positions.length / 3,
        type: "VEC3",
        min: [-1, 0, -1],
        max: [1, 1, 1],
      },
      { bufferView: 1, componentType: 5126, count: normals.length / 3, type: "VEC3" },
      { bufferView: 2, componentType: 5123, count: indices.length, type: "SCALAR" },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: position.length },
      { buffer: 0, byteOffset: position.length, byteLength: normal.length },
      {
        buffer: 0,
        byteOffset: position.length + normal.length,
        byteLength: index.length,
      },
    ],
    buffers: [{ byteLength: binary.length }],
  };
  const jsonChunk = Buffer.from(JSON.stringify(json), "utf8");
  const jsonPadded = Buffer.alloc(Math.ceil(jsonChunk.length / 4) * 4, 0x20);
  jsonChunk.copy(jsonPadded);
  const binaryPadded = Buffer.alloc(Math.ceil(binary.length / 4) * 4, 0);
  binary.copy(binaryPadded);
  const total = 12 + 8 + jsonPadded.length + 8 + binaryPadded.length;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(total, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonPadded.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  const binaryHeader = Buffer.alloc(8);
  binaryHeader.writeUInt32LE(binaryPadded.length, 0);
  binaryHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([
    header,
    jsonHeader,
    jsonPadded,
    binaryHeader,
    binaryPadded,
  ]);
}

async function readState(jobDir) {
  try {
    return JSON.parse(await readFile(`${jobDir}/mock.json`, "utf8"));
  } catch {
    return null;
  }
}

async function writeState(jobDir, state) {
  await mkdir(dirname(`${jobDir}/mock.json`), { recursive: true });
  await writeFile(`${jobDir}/mock.json`, JSON.stringify(state), "utf8");
}

export function createMockClient({
  jobsRoot,
  latencyMs = 3000,
  failMode = "",
  failOnce = false,
  now = Date.now,
} = {}) {
  let usedOnce = false;

  async function shouldFail(stage) {
    if (failMode !== stage) return false;
    if (!failOnce) return true;
    if (usedOnce) return false;
    try {
      await readFile(`${jobsRoot}/.mock-failure-used`, "utf8");
      return false;
    } catch {
      usedOnce = true;
      await mkdir(jobsRoot, { recursive: true });
      await writeFile(`${jobsRoot}/.mock-failure-used`, stage, "utf8");
      return true;
    }
  }

  return {
    provider: PROVIDER,

    // The mock never spends a credit, but it still answers the balance probe so
    // the submit guard and the /api/kiri/balance route can be exercised.
    async getBalance() {
      return { balance: 200 };
    },

    async submitVideo({ filename, jobDir }) {
      if (await shouldFail("submit"))
        throw new KiriError("kiri_unavailable", {
          detail: "Kegagalan simulasi saat mengunggah.",
        });
      const serial = `mock-${Buffer.from(filename).toString("hex").slice(0, 12)}`;
      await writeState(jobDir, {
        serial,
        createdAt: new Date(now()).toISOString(),
        failMode,
      });
      return { serial, calculateType: 3 };
    },

    // Mesh profile stand-in: the same stills, recorded as a mesh job so the
    // download hands back a GLB instead of a splat cloud.
    // Photo Scan answers with a mesh too, so the mock reuses the synthetic chair
    // GLB and only differs in the recorded mode and calculateType (1 = Photo).
    async submitPhotoImages({ files = [], jobDir, modelQuality, textureQuality } = {}) {
      if (await shouldFail("submit"))
        throw new KiriError("kiri_unavailable", {
          detail: "Kegagalan simulasi saat mengunggah.",
        });
      const serial = `mock-photo-${String(files.length).padStart(4, "0")}`;
      await writeState(jobDir, {
        serial,
        mode: "photo",
        modelQuality,
        textureQuality,
        createdAt: new Date(now()).toISOString(),
        failMode,
      });
      return { serial, calculateType: 1 };
    },

    async submitFeaturelessImages({ files = [], jobDir } = {}) {
      if (await shouldFail("submit"))
        throw new KiriError("kiri_unavailable", {
          detail: "Kegagalan simulasi saat mengunggah.",
        });
      const serial = `mock-mesh-${String(files.length).padStart(4, "0")}`;
      await writeState(jobDir, {
        serial,
        mode: "mesh",
        createdAt: new Date(now()).toISOString(),
        failMode,
      });
      return { serial, calculateType: 2 };
    },

    async getStatus(serial, { jobDir } = {}) {
      const state = (await readState(jobDir)) ?? {
        serial,
        createdAt: new Date(now()).toISOString(),
      };
      const elapsed = now() - new Date(state.createdAt).getTime();
      if (state.failMode === "process" && elapsed > latencyMs * 0.3)
        return { status: 1, state: "failed" };
      if (elapsed < latencyMs * 0.25) return { status: 3, state: "queuing" };
      if (elapsed < latencyMs) return { status: 0, state: "processing" };
      return { status: 2, state: "successful" };
    },

    async downloadZip(serial, destination, { jobDir } = {}) {
      if (await shouldFail("zip"))
        throw new KiriError("zip_invalid", {
          detail: "Kegagalan simulasi saat mengunduh ZIP.",
        });
      const state = jobDir ? await readState(jobDir) : null;
      // Both mesh routes stand in for a KIRI mesh export: one GLB plus the
      // camera set, exactly the shape the live ZIP has. Photo Scan and the
      // featureless pipeline differ upstream, not in the artifact they return.
      const meshJob = state?.mode === "mesh" || state?.mode === "photo";
      const zip = zipStore(
        meshJob
          ? [
              { name: "3DModel.glb", data: syntheticChairGlb() },
              {
                name: "cameras.json",
                data: Buffer.from(JSON.stringify({ cameras: [] }), "utf8"),
              },
            ]
          : [
              { name: "mock/point_cloud.ply", data: syntheticChairPly() },
              { name: "mock/readme.txt", data: Buffer.from("Mode simulasi LihatDulu.\n") },
            ],
      );
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, zip);
      return { bytes: zip.length };
    },
  };
}
