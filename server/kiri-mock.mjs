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

    async downloadZip(serial, destination) {
      if (await shouldFail("zip"))
        throw new KiriError("zip_invalid", {
          detail: "Kegagalan simulasi saat mengunduh ZIP.",
        });
      const zip = zipStore([
        { name: "mock/point_cloud.ply", data: syntheticChairPly() },
        { name: "mock/readme.txt", data: Buffer.from("Mode simulasi LihatDulu.\n") },
      ]);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, zip);
      return { bytes: zip.length };
    },
  };
}
