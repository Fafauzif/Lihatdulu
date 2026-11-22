import test from "node:test";
import assert from "node:assert/strict";
import { readPlyHeader, stripBackdrop } from "../server/kiri-cleanup.mjs";

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
