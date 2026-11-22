import test from "node:test";
import assert from "node:assert/strict";
import {
  DISTANCE_SCALE_MAX,
  DISTANCE_SCALE_MIN,
  ELEVATION_MAX_DEG,
  ELEVATION_MIN_DEG,
  boxCenter,
  boxSize,
  formatPose,
  isUsableBounds,
  normalizePose,
  percentileBounds,
  placementPosition,
  poseDirection,
  robustFocusBounds,
  rotateVector,
} from "../src/scan-viewer-math.js";

// The viewer keeps the upright convention from the audited baseline:
// half turn around X so COLMAP's Y-down capture data renders Y-up.
const UPRIGHT = { x: 1, y: 0, z: 0, w: 0 };

function nearly(actual, expected, tolerance = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

test("180 degree X rotation keeps the upright convention", () => {
  const rotated = rotateVector(UPRIGHT, { x: 2, y: 3, z: -4 });
  nearly(rotated.x, 2);
  nearly(rotated.y, -3);
  nearly(rotated.z, 4);
});

test("placement puts a non-zero subject center on the world origin", () => {
  const center = { x: 0.55, y: 1.25, z: -0.8 };
  const position = placementPosition(center, UPRIGHT);
  const rotated = rotateVector(UPRIGHT, center);
  // world_center = position + R * center must be exactly zero.
  nearly(position.x + rotated.x, 0);
  nearly(position.y + rotated.y, 0);
  nearly(position.z + rotated.z, 0);
  // Regression guard: the audited defect used position = -center, which put
  // the world center at R*c - c instead of zero.
  const auditWorld = {
    x: -center.x + rotated.x,
    y: -center.y + rotated.y,
    z: -center.z + rotated.z,
  };
  assert.ok(Math.hypot(auditWorld.x, auditWorld.y, auditWorld.z) > 0.5);
  // The transform is also correct for an identity rotation.
  const identity = placementPosition(center, { x: 0, y: 0, z: 0, w: 1 });
  nearly(identity.x, -center.x);
  nearly(identity.y, -center.y);
  nearly(identity.z, -center.z);
});

test("placement rotates the local center, not just the world offset", () => {
  // With a non-identity center a pure negation leaves a residual world offset;
  // the correct position must account for the rotation on both axes.
  const center = { x: 0, y: 2, z: 0 };
  const position = placementPosition(center, UPRIGHT);
  nearly(position.x, 0);
  nearly(position.y, 2);
  nearly(position.z, 0);
  const world = rotateVector(UPRIGHT, center);
  nearly(world.y + position.y, 0);
});

test("percentile bounds trim room and floater outliers", () => {
  const samples = [];
  for (let index = 0; index < 1000; index += 1) {
    samples.push({
      x: Math.sin(index) * 0.5,
      y: Math.cos(index * 0.7) * 0.4,
      z: (index % 10) * 0.05,
    });
  }
  // A handful of far-away room / streak splats on the +X/+Y/-Z sides.
  for (let index = 0; index < 5; index += 1) {
    samples.push({ x: 400 + index, y: 250, z: -300 });
  }
  const rawMaxX = Math.max(...samples.map((sample) => sample.x));
  assert.ok(rawMaxX > 400);
  const bounds = percentileBounds(samples, 1, 99);
  assert.ok(bounds.max.x < 50, `trimmed max.x=${bounds.max.x}`);
  assert.ok(bounds.min.x >= -0.5 - 1e-9);
  assert.ok(bounds.max.y < 50, `trimmed max.y=${bounds.max.y}`);
  assert.ok(bounds.min.z > -50, `trimmed min.z=${bounds.min.z}`);
  assert.ok(bounds.max.z < 50, `trimmed max.z=${bounds.max.z}`);
  const size = boxSize(bounds);
  assert.ok(size.x < 5 && size.y < 5 && size.z < 5);
  assert.equal(isUsableBounds(bounds), true);
  // Percentile bounds are independent per axis and ordered.
  for (const axis of ["x", "y", "z"]) {
    assert.ok(bounds.min[axis] <= bounds.max[axis]);
  }
});

test("percentile bounds reject impossible input and drop non-finite samples", () => {
  assert.throws(() => percentileBounds([]), TypeError);
  assert.throws(() => percentileBounds(null), TypeError);
  assert.throws(() => percentileBounds([{ x: 1 }]), TypeError);
  assert.throws(() => percentileBounds([{ x: 0, y: 0, z: 0 }], 99, 1), RangeError);
  assert.throws(() => percentileBounds([{ x: 0, y: 0, z: 0 }], -1, 99), RangeError);
  const bounds = percentileBounds(
    [
      { x: NaN, y: 0, z: 0 },
      { x: 1, y: 2, z: 3 },
      { x: 2, y: 2, z: 3 },
    ],
    0,
    100,
  );
  assert.equal(bounds.sampleCount, 2);
  assert.equal(bounds.min.x, 1);
  assert.equal(bounds.max.x, 2);
});

test("degenerate focus samples fall back to the raw full box", () => {
  const fullBox = { min: { x: -3, y: -1, z: -2 }, max: { x: 3, y: 5, z: 2 } };
  const single = robustFocusBounds([], fullBox);
  assert.deepEqual(single, fullBox);
  const repeated = robustFocusBounds(
    [
      { x: 1, y: 1, z: 1 },
      { x: 1, y: 1, z: 1 },
      { x: 1, y: 1, z: 1 },
    ],
    fullBox,
  );
  assert.deepEqual(repeated, fullBox);
  assert.throws(() => robustFocusBounds([], null), TypeError);
  const healthy = robustFocusBounds(
    [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 2, z: 3 },
      { x: -1, y: -2, z: -3 },
    ],
    fullBox,
  );
  assert.ok(Math.abs(healthy.max.x) < 3);
  const center = boxCenter({ min: { x: -2, y: 0, z: 4 }, max: { x: 2, y: 6, z: 10 } });
  assert.deepEqual(center, { x: 0, y: 3, z: 7 });
});

test("pose normalisation wraps azimuth and clamps elevation and dolly", () => {
  assert.equal(normalizePose({ azimuthDeg: 370 }).azimuthDeg, 10);
  assert.equal(normalizePose({ azimuthDeg: -10 }).azimuthDeg, 350);
  assert.equal(normalizePose({ azimuthDeg: 360 }).azimuthDeg, 0);
  assert.equal(normalizePose({ elevationDeg: 999 }).elevationDeg, ELEVATION_MAX_DEG);
  assert.equal(normalizePose({ elevationDeg: -999 }).elevationDeg, ELEVATION_MIN_DEG);
  assert.equal(ELEVATION_MIN_DEG, -75);
  assert.equal(ELEVATION_MAX_DEG, 75);
  assert.equal(normalizePose({ distanceScale: 0.01 }).distanceScale, DISTANCE_SCALE_MIN);
  assert.equal(normalizePose({ distanceScale: 99 }).distanceScale, DISTANCE_SCALE_MAX);
  assert.equal(DISTANCE_SCALE_MIN, 0.55);
  assert.equal(DISTANCE_SCALE_MAX, 2.6);
  // Fields omitted by a partial update fall back to the base pose.
  const base = { azimuthDeg: 90, elevationDeg: 30, distanceScale: 1.4 };
  assert.deepEqual(normalizePose({}, base), base);
  assert.deepEqual(normalizePose({ azimuthDeg: 45 }, base), {
    azimuthDeg: 45,
    elevationDeg: 30,
    distanceScale: 1.4,
  });
  assert.deepEqual(normalizePose({}, { azimuthDeg: NaN }), {
    azimuthDeg: 0,
    elevationDeg: 0,
    distanceScale: 1,
  });
});

test("pose direction and formatting are deterministic", () => {
  assert.deepEqual(poseDirection({ azimuthDeg: 0, elevationDeg: 0 }), {
    x: 0,
    y: 0,
    z: 1,
  });
  const top = poseDirection({ azimuthDeg: 0, elevationDeg: 90 });
  nearly(top.x, 0, 1e-12);
  nearly(top.y, 1, 1e-12);
  nearly(top.z, 0, 1e-12);
  const side = poseDirection({ azimuthDeg: 90, elevationDeg: 0 });
  nearly(side.x, 1, 1e-12);
  nearly(side.z, 0, 1e-12);
  assert.deepEqual(
    formatPose({ azimuthDeg: 45.123456, elevationDeg: -0.0004, distanceScale: 1 }),
    { azimuthDeg: 45.123, elevationDeg: -0, distanceScale: 1 },
  );
});

test("pure viewer helpers are exported for the renderer and QA harness", () => {
  const helpers = {
    rotateVector,
    placementPosition,
    percentileBounds,
    robustFocusBounds,
    normalizePose,
    formatPose,
    poseDirection,
    boxCenter,
    boxSize,
    isUsableBounds,
  };
  for (const [name, value] of Object.entries(helpers)) {
    assert.equal(typeof value, "function", `${name} must be exported`);
  }
});
