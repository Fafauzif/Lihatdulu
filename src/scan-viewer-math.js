// Pure math helpers for the scan viewer.
//
// This module deliberately imports no DOM, CSS or Three.js code so that
// node:test can exercise the placement / robust-fit / pose contracts directly
// against the same functions the renderer uses.
//
// Conventions:
// - A splat mesh is rotated by UPRIGHT_QUATERNION (180 degrees around X) and
//   then translated so the robust subject center lands on the world origin.
// - Pose elevation is measured in degrees above the subject's horizon:
//   0 = camera level with the subject center, +90 = straight above.
//   Internally this is the polar angle (90 - elevation), clamped to 15..165
//   degrees, which keeps the camera off both poles.

/** Polar angle limits in degrees measured from +Y (90 - elevation). */
export const POLAR_MIN_DEG = 15;
export const POLAR_MAX_DEG = 165;
/** Camera elevation limits in degrees above the subject horizon. */
export const ELEVATION_MIN_DEG = 90 - POLAR_MAX_DEG; // -75
export const ELEVATION_MAX_DEG = 90 - POLAR_MIN_DEG; // 75
/** Dolly limits relative to the fitted distance. */
export const DISTANCE_SCALE_MIN = 0.55;
export const DISTANCE_SCALE_MAX = 2.6;

const DEG_TO_RAD = Math.PI / 180;

function finiteOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function wrap360(value) {
  const wrapped = value % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function axisKey(axis) {
  return axis === 0 ? "x" : axis === 1 ? "y" : "z";
}

function readComponent(sample, axis) {
  if (Array.isArray(sample)) return sample[axis];
  if (sample && typeof sample === "object") return sample[axisKey(axis)];
  return undefined;
}

function isFiniteSample(sample) {
  return (
    Number.isFinite(readComponent(sample, 0)) &&
    Number.isFinite(readComponent(sample, 1)) &&
    Number.isFinite(readComponent(sample, 2))
  );
}

/**
 * Rotate a vector by a (possibly unnormalised) quaternion.
 * Returns a plain `{ x, y, z }` object; does not mutate the input.
 */
export function rotateVector(quaternion, vector) {
  const qx = finiteOr(quaternion?.x, 0);
  const qy = finiteOr(quaternion?.y, 0);
  const qz = finiteOr(quaternion?.z, 0);
  const qw = finiteOr(quaternion?.w, 0);
  const length = Math.hypot(qx, qy, qz, qw);
  if (!Number.isFinite(length) || length < 1e-12) {
    throw new TypeError("rotateVector membutuhkan quaternion bukan nol");
  }
  const nx = qx / length;
  const ny = qy / length;
  const nz = qz / length;
  const nw = qw / length;
  const vx = finiteOr(vector?.x, 0);
  const vy = finiteOr(vector?.y, 0);
  const vz = finiteOr(vector?.z, 0);
  // t = 2 * (q_vec x v); v' = v + qw * t + q_vec x t
  const tx = 2 * (ny * vz - nz * vy);
  const ty = 2 * (nz * vx - nx * vz);
  const tz = 2 * (nx * vy - ny * vx);
  return {
    x: vx + nw * tx + (ny * tz - nz * ty),
    y: vy + nw * ty + (nz * tx - nx * tz),
    z: vz + nw * tz + (nx * ty - ny * tx),
  };
}

/**
 * Position that puts a rotated local center on the world origin.
 *
 * world_center = position + R(quaternion) * center = 0
 *             => position = -R(quaternion) * center
 *
 * The previous viewer used position = -center, which left the model at
 * (R - I) * center instead of 0 for any non-zero subject center.
 */
export function placementPosition(center, quaternion) {
  const rotated = rotateVector(quaternion, center);
  return { x: -rotated.x, y: -rotated.y, z: -rotated.z };
}

function boundsFromSamples(samples) {
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const sample of samples) {
    for (let axis = 0; axis < 3; axis += 1) {
      const key = axis === 0 ? "x" : axis === 1 ? "y" : "z";
      const value = readComponent(sample, axis);
      if (value < min[key]) min[key] = value;
      if (value > max[key]) max[key] = value;
    }
  }
  return { min, max };
}

/**
 * Per-axis percentile bounds for the splat centers.
 *
 * Uses nearest-rank percentiles (independent per axis). Outliers such as the
 * room, floor streaks or isolated floaters therefore do not own the framing.
 * Accepts `{x,y,z}` objects or `[x,y,z]` arrays; non-finite samples are
 * dropped. Throws TypeError for an empty / fully invalid input and RangeError
 * for impossible percentile arguments.
 */
export function percentileBounds(samples, lowPct = 1, highPct = 99) {
  if (!Array.isArray(samples)) {
    throw new TypeError("percentileBounds membutuhkan array sampel");
  }
  if (
    !Number.isFinite(lowPct) ||
    !Number.isFinite(highPct) ||
    lowPct < 0 ||
    highPct > 100 ||
    lowPct >= highPct
  ) {
    throw new RangeError(
      `percentileBounds menerima 0 <= lowPct < highPct <= 100 (${lowPct}, ${highPct})`,
    );
  }
  const finite = samples.filter(isFiniteSample);
  if (finite.length === 0) {
    throw new TypeError("percentileBounds tidak menemukan sampel berhingga");
  }
  const count = finite.length;
  const lowIndex = clamp(Math.ceil((lowPct / 100) * count) - 1, 0, count - 1);
  const highIndex = clamp(Math.ceil((highPct / 100) * count) - 1, 0, count - 1);
  const min = {};
  const max = {};
  for (let axis = 0; axis < 3; axis += 1) {
    const key = axis === 0 ? "x" : axis === 1 ? "y" : "z";
    const values = finite
      .map((sample) => readComponent(sample, axis))
      .sort((left, right) => left - right);
    min[key] = values[lowIndex];
    max[key] = values[highIndex];
  }
  return { min, max, sampleCount: count, lowPct, highPct };
}

/** True when a bounds object has three finite min/max pairs. */
export function isUsableBounds(bounds) {
  const axes = ["x", "y", "z"];
  return axes.every(
    (axis) =>
      Number.isFinite(bounds?.min?.[axis]) &&
      Number.isFinite(bounds?.max?.[axis]) &&
      bounds.min[axis] <= bounds.max[axis],
  );
}

/** Axis-aligned size of a bounds object (never negative). */
export function boxSize(bounds) {
  return {
    x: Math.abs((bounds?.max?.x ?? 0) - (bounds?.min?.x ?? 0)),
    y: Math.abs((bounds?.max?.y ?? 0) - (bounds?.min?.y ?? 0)),
    z: Math.abs((bounds?.max?.z ?? 0) - (bounds?.min?.z ?? 0)),
  };
}

/** Center of a bounds object. */
export function boxCenter(bounds) {
  return {
    x: ((bounds?.min?.x ?? 0) + (bounds?.max?.x ?? 0)) / 2,
    y: ((bounds?.min?.y ?? 0) + (bounds?.max?.y ?? 0)) / 2,
    z: ((bounds?.min?.z ?? 0) + (bounds?.max?.z ?? 0)) / 2,
  };
}

/**
 * Robust subject bounds: percentile bounds when usable, otherwise the raw
 * full box (degenerate / too-few-samples fallback).
 */
export function robustFocusBounds(
  samples,
  fallbackBounds,
  lowPct = 1,
  highPct = 99,
) {
  let robust = null;
  try {
    robust = percentileBounds(samples, lowPct, highPct);
  } catch {
    robust = null;
  }
  // A single repeated point or a flat capture produces a zero-volume focus
  // box; treat that as degenerate and frame with the raw full box instead.
  if (robust) {
    const size = boxSize(robust);
    const diagonal = Math.hypot(size.x, size.y, size.z);
    if (isUsableBounds(robust) && diagonal > 1e-9) return robust;
  }
  if (isUsableBounds(fallbackBounds)) return fallbackBounds;
  throw new TypeError("robustFocusBounds membutuhkan kotak cadangan yang sah");
}

/**
 * Normalise a viewer pose: wrap azimuth, clamp elevation and dolly scale.
 * Non-finite or missing fields fall back to the supplied base pose.
 */
export function normalizePose(input = {}, base = {}) {
  const fallbackAzimuth = finiteOr(base?.azimuthDeg, 0);
  const fallbackElevation = finiteOr(base?.elevationDeg, 0);
  const fallbackDistance = finiteOr(base?.distanceScale, 1);
  return {
    azimuthDeg: wrap360(finiteOr(input?.azimuthDeg, fallbackAzimuth)),
    elevationDeg: clamp(
      finiteOr(input?.elevationDeg, fallbackElevation),
      ELEVATION_MIN_DEG,
      ELEVATION_MAX_DEG,
    ),
    distanceScale: clamp(
      finiteOr(input?.distanceScale, fallbackDistance),
      DISTANCE_SCALE_MIN,
      DISTANCE_SCALE_MAX,
    ),
  };
}

/** Rounded pose for JSON / dataset payloads. */
export function formatPose(pose) {
  const round = (value) => Math.round(value * 1000) / 1000;
  return {
    azimuthDeg: round(pose.azimuthDeg),
    elevationDeg: round(pose.elevationDeg),
    distanceScale: round(pose.distanceScale),
  };
}

/**
 * Unit direction from the subject center towards the camera for a pose.
 * azimuth 0 looks from +Z, positive azimuth rotates towards +X.
 */
export function poseDirection(pose) {
  const elevation = finiteOr(pose?.elevationDeg, 0) * DEG_TO_RAD;
  const azimuth = finiteOr(pose?.azimuthDeg, 0) * DEG_TO_RAD;
  const horizontal = Math.cos(elevation);
  return {
    x: horizontal * Math.sin(azimuth),
    y: Math.sin(elevation),
    z: horizontal * Math.cos(azimuth),
  };
}
