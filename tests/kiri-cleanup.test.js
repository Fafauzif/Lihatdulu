import test from "node:test";
import assert from "node:assert/strict";
import { cropToSubject, orbitCenter, readCameras, readPlyHeader, stripBackdrop } from "../server/kiri-cleanup.mjs";

const PROPS = [
  "x", "y", "z",
  "f_dc_0", "f_dc_1", "f_dc_2",
  "opacity",
  "scale_0", "scale_1", "scale_2",
  "rot_0", "rot_1", "rot_2", "rot_3",
];

const logit = (alpha) => Math.log(alpha / (1 - alpha));

// Minimal Gaussian PLY: the layout KIRI exports, one float per property.
function buildPly(rows) {
  const header = [
    "ply",
    "format binary_little_endian 1.0",
    `element vertex ${rows.length}`,
    ...PROPS.map((name) => `property float ${name}`),
    "end_header",
    "",
  ].join("\n");
  const body = Buffer.alloc(rows.length * PROPS.length * 4);
  rows.forEach((row, index) => {
    const base = index * PROPS.length * 4;
    const values = {
      x: row.x ?? 0,
      y: row.y ?? 0,
      z: row.z ?? 0,
      opacity: row.opacity ?? logit(0.3),
      ...row.values,
    };
    PROPS.forEach((name, prop) => {
      body.writeFloatLE(values[name] ?? 0, base + prop * 4);
    });
  });
  return Buffer.concat([Buffer.from(header, "latin1"), body]);
}

function nouveauModel() {
  const rows = [];
  for (let i = 0; i < 600; i += 1) {
    const angle = (i / 600) * Math.PI * 2;
    rows.push({
      x: Math.cos(angle) * (1 + (i % 7) / 10),
      y: Math.sin(angle) * 0.8,
      z: Math.sin(angle * 2) * 1.2,
      opacity: logit(0.4 + (i % 5) / 20),
    });
  }
  return rows;
}

function chunkyDome(count = 400, radius = 50, opacity = 0.99) {
  const rows = [];
  for (let i = 0; i < count; i += 1) {
    const a = (i / count) * Math.PI * 2;
    const b = Math.acos(1 - (2 * (i + 0.5)) / count);
    rows.push({
      x: radius * Math.sin(b) * Math.cos(a),
      y: radius * Math.cos(b),
      z: radius * Math.sin(b) * Math.sin(a),
      opacity: logit(opacity),
      values: { scale_0: Math.log(0.94), scale_1: Math.log(0.94), scale_2: Math.log(0.94), rot_0: 1 },
    });
  }
  return rows;
}

test("the synthetic KIRI backdrop is removed and the header count follows", () => {
  const rows = [...nouveauModel(), ...chunkyDome()];
  const original = buildPly(rows);
  const result = stripBackdrop(original);

  assert.equal(result.reason, "kiri-backdrop");
  assert.equal(result.removed, 400);
  const head = readPlyHeader(result.buffer);
  assert.equal(head.count, 600);
  // Only the removed rows disappear; the header shrinks by the digit it lost.
  const headerSmallerBy = String(rows.length).length - String(600).length;
  assert.equal(
    result.buffer.length,
    original.length - 400 * PROPS.length * 4 - headerSmallerBy,
  );
  assert.equal(result.buffer.length, head.bodyStart + 600 * PROPS.length * 4);
  // The kept rows are byte-identical to the input rows.
  assert.deepEqual(
    result.buffer.subarray(head.bodyStart, head.bodyStart + 14 * 4),
    original.subarray(readPlyHeader(original).bodyStart, readPlyHeader(original).bodyStart + 14 * 4),
  );
});

test("a normal scan without a backdrop is returned untouched", () => {
  const original = buildPly(nouveauModel());
  const result = stripBackdrop(original);
  assert.equal(result.removed, 0);
  assert.equal(result.reason, null);
  assert.equal(result.buffer, original);
});

test("a small or near-in shell is not treated as a backdrop", () => {
  // Real content can sit at one radius, but it is never the whole far field.
  const near = buildPly([
    ...nouveauModel(),
    ...chunkyDome(100, 5),
  ]);
  assert.equal(stripBackdrop(near).removed, 0);

  // Below the minimum count the evidence is too weak to delete anything.
  const few = buildPly([
    ...manySmallRows(600),
    ...chunkyDome(100),
  ]);
  assert.equal(stripBackdrop(few).removed, 0);
});

function manySmallRows(count) {
  return Array.from({ length: count }, (_, i) => ({
    x: Math.sin(i) * 2,
    y: Math.cos(i) * 2,
    z: Math.sin(i * 0.7) * 2,
    opacity: logit(0.3 + (i % 9) / 30),
  }));
}

test("an unexpected PLY layout is passed through unchanged", () => {
  const ascii = Buffer.from(
    "ply\nformat ascii 1.0\nelement vertex 1\nproperty float x\nproperty float y\nproperty float z\nproperty float f_dc_0\nproperty float f_dc_1\nproperty float f_dc_2\nproperty float opacity\nproperty float scale_0\nproperty float scale_1\nproperty float scale_2\nproperty float rot_0\nproperty float rot_1\nproperty float rot_2\nproperty float rot_3\nend_header\n0 0 0 0 0 0 0 0 0 0 1 0 0 0\n",
  );
  const result = stripBackdrop(ascii);
  assert.equal(result.removed, 0);
  assert.equal(result.buffer, ascii);
  assert.equal(readPlyHeader(ascii), null);
});

// --- cameras and subject crop ---------------------------------------------

// A camera ring around the origin, looking inwards, as KIRI writes it: the
// rotation is a full 3x3 matrix and the third column is the optical axis.
function cameraRing(count = 12, radius = 4, height = 0.4) {
  const cameras = [];
  for (let index = 0; index < count; index += 1) {
    const angle = (index / count) * Math.PI * 2;
    const position = [Math.cos(angle) * radius, height, Math.sin(angle) * radius];
    const forward = [
      -position[0] / radius,
      0,
      -position[2] / radius,
    ];
    const right = [forward[2], 0, -forward[0]];
    const up = [0, 1, 0];
    // Columns: right, up, forward.
    const rotation = [
      [right[0], up[0], forward[0]],
      [right[1], up[1], forward[1]],
      [right[2], up[2], forward[2]],
    ];
    cameras.push({ position, rotation });
  }
  return cameras;
}

test("readCameras accepts KIRI's shape and rejects junk", () => {
  const cameras = readCameras(JSON.stringify(cameraRing(6)));
  assert.equal(cameras.length, 6);
  assert.deepEqual(cameras[0].position.length, 3);
  assert.equal(readCameras("not json"), null);
  assert.equal(readCameras(JSON.stringify([{ position: [1, 2, 3] }])), null);
  assert.equal(readCameras(JSON.stringify({ cameras: cameraRing(4) })).length, 4);
});

test("orbitCenter finds the middle of a camera ring", () => {
  const centre = orbitCenter(readCameras(JSON.stringify(cameraRing(16, 4.2, 0.3))));
  assert.ok(centre, "centre expected");
  const distance = Math.hypot(centre[0], centre[1], centre[2]);
  assert.ok(distance < 0.35, `expected the ring centre, got ${distance.toFixed(2)} m`);
});

test("orbitCenter survives flipped rotations", () => {
  const flipped = cameraRing(12).map((camera) => ({
    ...camera,
    rotation: camera.rotation.map((row) => row.map((value) => -value)),
  }));
  const centre = orbitCenter(readCameras(JSON.stringify(flipped)));
  assert.ok(centre);
  // The rays stay horizontal, so only the horizontal position is pinned; the
  // height lands on the camera ring's own height.
  assert.ok(Math.hypot(centre[0], centre[2]) < 0.35);
  assert.ok(Math.abs(centre[1] - 0.4) < 0.15);
});

test("a subject crop keeps the middle of the scan and drops the room", () => {
  const rows = [];
  for (let i = 0; i < 500; i += 1) {
    const angle = (i / 500) * Math.PI * 2;
    rows.push({ x: Math.cos(angle) * 0.6, y: (i % 10) / 8, z: Math.sin(angle) * 0.6 });
  }
  for (let i = 0; i < 500; i += 1) {
    const angle = (i / 500) * Math.PI * 2;
    rows.push({ x: Math.cos(angle) * 12, y: (i % 10) / 5, z: Math.sin(angle) * 9 });
  }
  const buffer = buildPly(rows);
  const cropped = cropToSubject(buffer, { center: [0, 0.5, 0], radius: 1.6 });
  assert.equal(cropped.reason, "subject-crop");
  assert.equal(cropped.removed, 500);
  const head = readPlyHeader(cropped.buffer);
  assert.equal(head.count, 500);
});

test("a crop that would empty the scan is refused", () => {
  const buffer = buildPly(nouveauModel());
  const cropped = cropToSubject(buffer, { center: [50, 50, 50], radius: 1 });
  assert.equal(cropped.removed, 0);
  assert.equal(cropped.buffer, buffer);
});

test("a crop with no usable centre is refused", () => {
  const buffer = buildPly(nouveauModel());
  assert.equal(cropToSubject(buffer, { radius: 1 }).removed, 0);
  assert.equal(cropToSubject(buffer, { center: [0, 0, 0], radius: 0 }).removed, 0);
});
