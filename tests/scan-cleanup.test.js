import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CHAIR_PROFILE,
  CleanupError,
  cameraPose,
  filterPlySphere,
  parseImagesBin,
  parsePly,
  percentile,
  planSubjectCleanup,
  plyOpacity,
  plyPositions,
  quaternionToRotation,
  rayTarget,
  readPlyScalar,
  resolveProfile,
  subjectRadius,
} from "../server/scan-cleanup.mjs";
import {
  buildBrushArgs,
  buildProvenance,
  runRealPipeline,
} from "../server/scan-pipeline.mjs";
import { createJob, jobPaths } from "../server/scan-jobs.mjs";

const PLY_PROPERTIES = [
  "x",
  "y",
  "z",
  "opacity",
  "scale_0",
  "scale_1",
  "scale_2",
];

function plyBuffer(rows) {
  const header = [
    "ply",
    "format binary_little_endian 1.0",
    "comment Exported from Brush",
    `element vertex ${rows.length}`,
    ...PLY_PROPERTIES.map((name) => `property float ${name}`),
    "end_header",
    "",
  ].join("\n");
  const body = Buffer.alloc(rows.length * PLY_PROPERTIES.length * 4);
  rows.forEach((row, index) => {
    PLY_PROPERTIES.forEach((name, property) => {
      body.writeFloatLE(
        row[name] ?? 0,
        (index * PLY_PROPERTIES.length + property) * 4,
      );
    });
  });
  return Buffer.concat([Buffer.from(header, "latin1"), body]);
}

// Same payload with a CRLF header, as some exporters write.
function plyBufferCrlf(rows) {
  const lf = plyBuffer(rows);
  const LF = String.fromCharCode(10);
  const marker = "end_header" + LF;
  const headerEnd = lf.indexOf(Buffer.from(marker, "latin1")) + marker.length;
  const header = lf
    .subarray(0, headerEnd)
    .toString("latin1")
    .split(LF)
    .join(String.fromCharCode(13, 10));
  return Buffer.concat([Buffer.from(header, "latin1"), lf.subarray(headerEnd)]);
}

// alpha is linear opacity; the PLY stores its logit.
function logit(alpha) {
  return Math.log(alpha / (1 - alpha));
}

function shellRows({
  radius,
  count,
  alpha,
  angleOffset = 0,
  centre = [0, 0, 0],
}) {
  const rows = [];
  for (let index = 0; index < count; index += 1) {
    const angle = angleOffset + (index / count) * Math.PI * 2;
    rows.push({
      x: centre[0] + Math.cos(angle) * radius,
      y: centre[1] + Math.sin(angle * 3) * 0.1,
      z: centre[2] + Math.sin(angle) * radius,
      opacity: logit(alpha),
    });
  }
  return rows;
}

function rotationToQuaternion(rotation) {
  const [[m00, m01, m02], [m10, m11, m12], [m20, m21, m22]] = rotation;
  const trace = m00 + m11 + m22;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    return [s / 4, (m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s];
  }
  if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    return [(m21 - m12) / s, s / 4, (m01 + m10) / s, (m02 + m20) / s];
  }
  if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    return [(m02 - m20) / s, (m01 + m10) / s, s / 4, (m12 + m21) / s];
  }
  const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
  return [(m10 - m01) / s, (m02 + m20) / s, (m12 + m21) / s, s / 4];
}

function lookAtRotation(center, target = [0, 0, 0]) {
  const delta = [0, 1, 2].map((axis) => target[axis] - center[axis]);
  const norm = Math.hypot(...delta);
  const forward = delta.map((value) => value / norm);
  const up = Math.abs(forward[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const right = [
    up[1] * forward[2] - up[2] * forward[1],
    up[2] * forward[0] - up[0] * forward[2],
    up[0] * forward[1] - up[1] * forward[0],
  ];
  const rightNorm = Math.hypot(...right);
  const rightUnit = right.map((value) => value / rightNorm);
  const upUnit = [
    forward[1] * rightUnit[2] - forward[2] * rightUnit[1],
    forward[2] * rightUnit[0] - forward[0] * rightUnit[2],
    forward[0] * rightUnit[1] - forward[1] * rightUnit[0],
  ];
  return [rightUnit, upUnit, forward];
}

function imagesBin(centres, target = [0, 0, 0]) {
  const header = Buffer.alloc(8);
  header.writeBigUInt64LE(BigInt(centres.length));
  const parts = [header];
  centres.forEach((center, index) => {
    const rotation = lookAtRotation(center, target);
    const qvec = rotationToQuaternion(rotation);
    const tvec = [0, 1, 2].map(
      (row) => -(rotation[row][0] * center[0] + rotation[row][1] * center[1] + rotation[row][2] * center[2]),
    );
    const fixed = Buffer.alloc(4 + 32 + 24 + 4);
    fixed.writeInt32LE(index + 1, 0);
    qvec.forEach((value, position) => fixed.writeDoubleLE(value, 4 + position * 8));
    tvec.forEach((value, position) => fixed.writeDoubleLE(value, 36 + position * 8));
    fixed.writeInt32LE(1, 60);
    const name = Buffer.from(`000${index + 1}.jpg`, "utf8");
    const tail = Buffer.alloc(8);
    tail.writeBigUInt64LE(BigInt(0));
    parts.push(fixed, name, Buffer.from([0]), tail);
  });
  return Buffer.concat(parts);
}

test("quaternionToRotation and cameraPose follow the COLMAP convention", () => {
  assert.deepEqual(quaternionToRotation([1, 0, 0, 0]), [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ]);
  // 180 degrees about X, the viewer's own orientation fix.
  assert.deepEqual(quaternionToRotation([0, 1, 0, 0]), [
    [1, 0, 0],
    [0, -1, 0],
    [0, 0, -1],
  ]);
  const pose = cameraPose({ qvec: [0, 1, 0, 0], tvec: [1, 2, 3] });
  assert.deepEqual(pose.center.map((value) => Math.round(value * 1e6) / 1e6), [
    -1, 2, 3,
  ]);
  assert.deepEqual(pose.forward, [0, 0, -1]);
  const identity = cameraPose({ qvec: [1, 0, 0, 0], tvec: [-2, 5, 1] });
  assert.deepEqual(identity.center, [2, -5, -1]);
  assert.deepEqual(identity.forward, [0, 0, 1]);
});

test("parseImagesBin round-trips names, poses and empty observation lists", () => {
  const buffer = imagesBin([
    [3, 0, 0],
    [0, 3, 0],
    [0, 0, 3],
  ]);
  const images = parseImagesBin(buffer);
  assert.equal(images.length, 3);
  assert.equal(images[0].name, "0001.jpg");
  assert.equal(images[2].name, "0003.jpg");
  assert.equal(images[1].id, 2);
  assert.throws(() => parseImagesBin(Buffer.alloc(4)), CleanupError);
  assert.throws(() => parseImagesBin(buffer.subarray(0, 60)), CleanupError);
});

test("rayTarget intersects the optical axes at the subject", () => {
  const target = [1.5, -0.5, 2.25];
  const centres = [];
  for (let index = 0; index < 12; index += 1) {
    const angle = (index / 12) * Math.PI * 2;
    centres.push([
      target[0] + Math.cos(angle) * 4,
      target[1] + Math.sin(index) * 0.4,
      target[2] + Math.sin(angle) * 4,
    ]);
  }
  const solution = rayTarget(parseImagesBin(imagesBin(centres, target)));
  solution.forEach((value, index) =>
    assert.ok(
      Math.abs(value - target[index]) < 1e-6,
      `axis ${index}: ${value} vs ${target[index]}`,
    ),
  );
  assert.throws(() => rayTarget(parseImagesBin(imagesBin([[3, 0, 0]]))), CleanupError);
});

test("parsePly reads every column and rejects unsupported layouts", () => {
  const buffer = plyBuffer([
    { x: 1, y: 2, z: 3, opacity: 0, scale_0: 0.5 },
    { x: -1, y: -2, z: -3, opacity: logit(0.25) },
  ]);
  const ply = parsePly(buffer);
  assert.equal(ply.count, 2);
  assert.equal(ply.stride, PLY_PROPERTIES.length * 4);
  assert.equal(readPlyScalar(ply, 0, "x"), 1);
  assert.equal(readPlyScalar(ply, 1, "z"), -3);
  assert.equal(readPlyScalar(ply, 0, "scale_0"), 0.5);
  assert.equal(readPlyScalar(ply, 0, "missing"), null);
  assert.ok(Math.abs(plyOpacity(ply, 0) - 0.5) < 1e-6);
  assert.ok(Math.abs(plyOpacity(ply, 1) - 0.25) < 1e-6);
  const positions = plyPositions(ply);
  assert.equal(positions.length, 6);
  assert.equal(positions[3], -1);

  const ascii = Buffer.from("ply\nformat ascii 1.0\nelement vertex 1\nproperty float x\nend_header\n0\n");
  assert.throws(() => parsePly(ascii), CleanupError);
  const extra = Buffer.from(
    "ply\nformat binary_little_endian 1.0\nelement vertex 1\nproperty float x\nproperty float y\nproperty float z\nelement face 1\nproperty list uchar int vertex_indices\nend_header\n",
  );
  assert.throws(() => parsePly(extra), CleanupError);
  const truncated = plyBuffer([{ x: 0, y: 0, z: 0 }]).subarray(0, 40);
  assert.throws(() => parsePly(truncated), CleanupError);
});

test("subjectRadius clamps the opaque spread and ignores faint splats", () => {
  const buffer = plyBuffer([
    ...shellRows({ radius: 1, count: 200, alpha: 0.6 }),
    ...shellRows({ radius: 2, count: 200, alpha: 0.6 }),
    ...shellRows({ radius: 2.9, count: 200, alpha: 0.02 }),
  ]);
  const ply = parsePly(buffer);
  const result = subjectRadius(ply, [0, 0, 0]);
  // Opaque mass is at 1 and 2, so r90 = 2 and 0.9 x 2 = 1.8, just above the
  // clamp floor. The faint shell at 2.9 must not widen the measurement.
  assert.ok(Math.abs(result.spread - 2) < 0.01, String(result.spread));
  assert.ok(
    Math.abs(result.radius - 0.9 * result.spread) < 0.01,
    String(result.radius),
  );
  assert.ok(result.radius >= CHAIR_PROFILE.minRadius);
  assert.ok(result.opaqueSplats >= 400 && result.opaqueSplats < 600);

  const wide = parsePly(
    plyBuffer([
      ...shellRows({ radius: 2.9, count: 400, alpha: 0.5 }),
      ...shellRows({ radius: 3.0, count: 400, alpha: 0.5 }),
    ]),
  );
  const wideResult = subjectRadius(wide, [0, 0, 0]);
  // A wide opaque mass scales the radius up but never past the ceiling.
  assert.ok(
    wideResult.radius > 2.5 && wideResult.radius <= CHAIR_PROFILE.maxRadius,
    String(wideResult.radius),
  );
  assert.throws(
    () => subjectRadius(parsePly(plyBuffer(shellRows({ radius: 1, count: 10, alpha: 0.5 }))), [0, 0, 0]),
    CleanupError,
  );
});

test("subjectRadius measures the spread about the mass median, not the ray target", () => {
  // Regression for the 2026-11-22 rule decision. The chair mass sits above the
  // floor-level ray target, so measuring distances from the target inflates the
  // spread by the offset. Only the mass's own median gives the calibrated value.
  const rows = [
    ...shellRows({ radius: 0.8, count: 600, alpha: 0.6, centre: [0, 0.9, 0] }),
    ...shellRows({ radius: 2.2, count: 400, alpha: 0.6, centre: [0, 0.9, 0] }),
  ];
  const result = subjectRadius(parsePly(plyBuffer(rows)), [0, 0, 0]);
  assert.ok(
    Math.abs(result.massCentre[1] - 0.9) < 0.05,
    `mass centre y ${result.massCentre[1]}`,
  );

  const distanceFrom = (point) =>
    rows.map((row) =>
      Math.hypot(
        row.x - point[0],
        row.y - point[1],
        row.z - point[2],
      ),
    );
  const aboutMass = percentile(distanceFrom(result.massCentre), 0.9);
  const aboutTarget = percentile(distanceFrom([0, 0, 0]), 0.9);
  // The two rules must be far enough apart for this to be a real assertion.
  assert.ok(aboutTarget - aboutMass > 0.1, `${aboutTarget} vs ${aboutMass}`);
  assert.ok(Math.abs(result.spread - aboutMass) < 0.02, String(result.spread));
  assert.equal(
    result.radius,
    Math.round(
      Math.min(
        CHAIR_PROFILE.maxRadius,
        Math.max(CHAIR_PROFILE.minRadius, CHAIR_PROFILE.radiusFactor * aboutMass),
      ) * 1000,
    ) / 1000,
  );
  // 0.9 x 2.2 = 1.98, so this case is not rescued by either clamp.
  assert.ok(
    result.radius > CHAIR_PROFILE.minRadius &&
      result.radius < CHAIR_PROFILE.maxRadius,
    String(result.radius),
  );
  assert.ok(
    Math.abs(result.radius - 0.9 * aboutMass) < 0.01,
    `${result.radius} vs ${0.9 * aboutMass}`,
  );
});

test("planSubjectCleanup centres the sphere on the ray target", () => {
  // The centre stays on the camera-axis target even though the radius is
  // measured about the mass median; both facts are recorded in the stats.
  const rows = [
    ...shellRows({ radius: 0.8, count: 600, alpha: 0.6, centre: [0, 0.9, 0] }),
    ...shellRows({ radius: 2.2, count: 400, alpha: 0.6, centre: [0, 0.9, 0] }),
  ];
  const plan = planSubjectCleanup(plyBuffer(rows), [0, 0.9, 0]);
  const closeTo = (actual, expected) =>
    actual.length === expected.length &&
    actual.every((value, axis) => Math.abs(value - expected[axis]) < 0.05);
  // The sphere is centred on the ray target; the median is reported alongside.
  assert.ok(closeTo(plan.stats.centre, [0, 0.9, 0]), plan.stats.centre.join());
  assert.ok(closeTo(plan.stats.massCentre, [0, 0.9, 0]), plan.stats.massCentre.join());
  const kept = parsePly(plan.buffer);
  for (let vertex = 0; vertex < kept.count; vertex += 1) {
    const distance = Math.hypot(
      readPlyScalar(kept, vertex, "x") - plan.stats.centre[0],
      readPlyScalar(kept, vertex, "y") - plan.stats.centre[1],
      readPlyScalar(kept, vertex, "z") - plan.stats.centre[2],
    );
    assert.ok(distance <= plan.stats.radius + 1e-6, String(distance));
  }
});

test("parsePly accepts a CRLF header and still finds the vertex data", () => {
  const rows = [
    { x: 1, y: 2, z: 3, opacity: 0.5 },
    { x: 4, y: 5, z: 6, opacity: -0.5 },
  ];
  const lf = parsePly(plyBuffer(rows));
  const crlf = parsePly(plyBufferCrlf(rows));
  assert.equal(crlf.count, 2);
  assert.equal(crlf.stride, lf.stride);
  assert.deepEqual(plyPositions(crlf), plyPositions(lf));
  assert.equal(readPlyScalar(crlf, 1, "x"), 4);
});

test("quaternionToRotation rejects a degenerate camera rotation", () => {
  assert.throws(() => quaternionToRotation([0, 0, 0, 0]), CleanupError);
  assert.throws(() => quaternionToRotation([NaN, 0, 0, 1]), CleanupError);
  // A unit quaternion still works.
  assert.deepEqual(quaternionToRotation([1, 0, 0, 0]), [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ]);
});

test("rayTarget rejects a target thrown far outside the capture by near-parallel axes", () => {
  const centres = [];
  for (let index = 0; index < 12; index += 1)
    centres.push([Math.cos(index) * 3, 0, Math.sin(index) * 3]);
  const model = imagesBin(centres);
  // All cameras look at the origin here, so the target is well conditioned.
  assert.ok(Math.hypot(...rayTarget(parseImagesBin(model))) < 0.05);
  // Nearly parallel axes resolve to a point far beyond any capture volume.
  const flat = parseImagesBin(imagesBin(centres, [1000, 0, 0]));
  assert.throws(() => rayTarget(flat), CleanupError);
});

test("subjectRadius ignores non-finite vertices instead of returning NaN", () => {
  const rows = [
    ...shellRows({ radius: 0.8, count: 600, alpha: 0.6, centre: [0, 0.9, 0] }),
    ...shellRows({ radius: 2.2, count: 400, alpha: 0.6, centre: [0, 0.9, 0] }),
    { x: Number.NaN, y: 0, z: 0, opacity: 2 },
    { x: 0, y: Number.POSITIVE_INFINITY, z: 0, opacity: 2 },
  ];
  const result = subjectRadius(parsePly(plyBuffer(rows)), [0, 0, 0]);
  assert.ok(Number.isFinite(result.radius), String(result.radius));
  assert.ok(Number.isFinite(result.spread), String(result.spread));
  assert.equal(result.opaqueSplats, 1000);
  const filtered = filterPlySphere(parsePly(plyBuffer(rows)), [0, 0.9, 0], 10);
  // The two damaged rows are dropped, the healthy ones survive.
  assert.equal(filtered.kept, 1000);
});

test("filterPlySphere keeps rows intact and rewrites the vertex count", () => {
  const rows = [
    { x: 0, y: 0, z: 0, opacity: 0, scale_1: 0.25 },
    { x: 1, y: 0, z: 0, opacity: 0 },
    { x: 5, y: 0, z: 0, opacity: 0, scale_2: 0.75 },
  ];
  const ply = parsePly(plyBuffer(rows));
  const filtered = filterPlySphere(ply, [0, 0, 0], 1.5);
  assert.equal(filtered.kept, 2);
  const kept = parsePly(filtered.buffer);
  assert.equal(kept.count, 2);
  assert.match(kept.header, /element vertex 2/);
  // Byte preservation: every column survives unchanged for kept rows.
  assert.equal(readPlyScalar(kept, 0, "scale_1"), 0.25);
  assert.equal(readPlyScalar(kept, 1, "x"), 1);
});

test("planSubjectCleanup reports the sphere and keeps the subject", () => {
  const buffer = plyBuffer([
    ...shellRows({ radius: 0.5, count: 300, alpha: 0.6 }),
    ...shellRows({ radius: 1.2, count: 300, alpha: 0.6 }),
    ...shellRows({ radius: 4, count: 300, alpha: 0.6 }),
  ]);
  const plan = planSubjectCleanup(buffer, [0, 0, 0]);
  assert.equal(plan.stats.splatsBefore, 900);
  assert.equal(plan.stats.radius, Math.round(CHAIR_PROFILE.minRadius * 1000) / 1000);
  assert.equal(plan.stats.splatsAfter, 600);
  assert.equal(plan.stats.keptRatio, 0.6667);
  assert.match(plan.stats.rule, /r90_opaque/);
  const cleaned = parsePly(plan.buffer);
  assert.equal(cleaned.count, 600);
  assert.throws(
    () =>
      planSubjectCleanup(
        plyBuffer([
          ...shellRows({ radius: 0.5, count: 50, alpha: 0.6 }),
          ...shellRows({ radius: 4, count: 9000, alpha: 0.6 }),
        ]),
        [0, 0, 0],
      ),
    (error) => error.code === "cleanup_failed",
  );
});

test("percentile interpolates like a distribution quantile", () => {
  assert.equal(percentile([], 0.5), Number.NaN);
  assert.equal(percentile([4, 1, 3, 2], 0), 1);
  assert.equal(percentile([4, 1, 3, 2], 1), 4);
  assert.equal(percentile([0, 10], 0.5), 5);
  assert.equal(percentile([0, 10], 0.9), 9);
});

test("resolveProfile opts in only for chair", () => {
  assert.equal(resolveProfile("chair"), "chair");
  assert.equal(resolveProfile(" CHAIR "), "chair");
  assert.equal(resolveProfile("default"), "default");
  assert.equal(resolveProfile(undefined), "default");
  assert.equal(resolveProfile("chairish"), "default");
});

test("buildProvenance adds the profile only for opt-in runs", () => {
  const base = {
    media: { durationS: 12.3 },
    device: "Android",
    frames: { extracted: 90, registered: 78 },
    timings: { extractMs: 1, alignMs: 2, trainMs: 3, convertMs: 4, totalMs: 10 },
    artifact: { format: "spz", bytes: 100, splatCount: 4096 },
    tools: {},
  };
  assert.deepEqual(Object.keys(buildProvenance(base)).sort(), [
    "artifact",
    "frames",
    "source",
    "timings",
    "tools",
  ]);
  const profiled = buildProvenance({
    ...base,
    profile: { name: "chair", applied: true, radius: 2 },
  });
  assert.deepEqual(profiled.profile, { name: "chair", applied: true, radius: 2 });
});

test("runRealPipeline applies the chair profile and records it", async () => {
  const root = await mkdtemp(join(tmpdir(), "scan-cleanup-"));
  const meta = {
    title: "Kursi",
    widthCm: 58,
    depthCm: 63,
    heightCm: 84,
    conditionNote: "",
    device: "Android",
    clientId: "",
  };
  const job = await createJob(root, meta);
  const paths = jobPaths(root, job.id);
  await writeFile(join(paths.dir, "clip.webm"), "clip");
  const rows = [
    ...shellRows({ radius: 0.6, count: 400, alpha: 0.6 }),
    ...shellRows({ radius: 1.1, count: 400, alpha: 0.6 }),
    ...shellRows({ radius: 3.5, count: 400, alpha: 0.6 }),
  ];
  const brushPly = plyBuffer(rows);
  const centres = [];
  for (let index = 0; index < 10; index += 1) {
    const angle = (index / 10) * Math.PI * 2;
    centres.push([Math.cos(angle) * 4, 0, Math.sin(angle) * 4]);
  }
  const model = imagesBin(centres);
  const calls = [];
  const stub = async (name, args) => {
    calls.push([name, args]);
    if (name === "ffprobe")
      return {
        ms: 1,
        stdout: JSON.stringify({
          format: { duration: "12.3", size: "12000000" },
          streams: [{ codec_type: "video", width: 1280, height: 720 }],
        }),
      };
    if (name === "ffmpeg" && args[0] === "-version") return { ms: 1, stdout: "ffmpeg 8" };
    if (name === "ffmpeg") {
      await mkdir(paths.frames, { recursive: true });
      for (let index = 1; index <= 80; index += 1)
        await writeFile(join(paths.frames, `${String(index).padStart(4, "0")}.jpg`), "frame");
      return { ms: 5, stdout: "" };
    }
    if (name === "colmap" && args[0] === "--version") return { ms: 1, stdout: "COLMAP 4.2.1" };
    if (name === "colmap" && args[0] === "model_analyzer")
      return { ms: 1, stdout: "Registered images: 80" };
    if (name === "colmap" && args[0] === "mapper") {
      await mkdir(join(paths.work, "sparse", "0"), { recursive: true });
      await writeFile(join(paths.work, "sparse", "0", "images.bin"), model);
      return { ms: 5, stdout: "" };
    }
    if (name === "colmap") return { ms: 2, stdout: "" };
    if (name === "brush" && args[0] === "--version") return { ms: 1, stdout: "brush-cli 0.3.0" };
    if (name === "brush") {
      await mkdir(paths.work, { recursive: true });
      await writeFile(join(paths.work, "scan.ply"), brushPly);
      return { ms: 30, stdout: "" };
    }
    if (name === "splatTransform" && args[0] === "--version")
      return { ms: 1, stdout: "splat-transform v3.12.0" };
    if (name === "splatTransform") {
      const input = args[0];
      const payload = input.endsWith("scan-subject.ply")
        ? await import("node:fs/promises").then((module) => module.readFile(input))
        : brushPly;
      const kept = parsePly(payload).count;
      await writeFile(args.at(-1), Buffer.alloc(64));
      return { ms: 2, stdout: `{"numGaussians":${kept}}` };
    }
    return { ms: 1, stdout: "" };
  };
  const stages = [];
  const result = await runRealPipeline(job, {
    root,
    updateStage: async (stage) => stages.push(stage),
    runTool: stub,
    diskFree: async () => 10 * 1024 ** 3,
    profile: "chair",
  });
  const conversion = calls.find(([name]) => name === "splatTransform");
  assert.ok(conversion[1][0].endsWith("scan-subject.ply"), conversion[1][0]);
  assert.equal(result.provenance.profile.name, "chair");
  assert.equal(result.provenance.profile.applied, true);
  assert.equal(result.provenance.profile.splatsBefore, 1200);
  assert.ok(result.provenance.profile.splatsAfter < 1200);
  assert.ok(Math.abs(result.provenance.profile.centre[0]) < 1e-6);
  assert.equal(result.provenance.timings.cleanupMs >= 0, true);
  // The profile carries the training budget its radius rule was validated on;
  // the 3000-step default export is too thin once the room is filtered out.
  assert.equal(result.provenance.profile.trainSteps, 6000);
  const brushCall = calls.find(([name, args]) => name === "brush" && args[0] !== "--version");
  const steps = brushCall[1][brushCall[1].indexOf("--total-steps") + 1];
  assert.equal(steps, "6000");
  assert.deepEqual(stages, [
    "validating",
    "extracting",
    "aligning",
    "reconstructing",
    "finalizing",
  ]);
});

test("runRealPipeline keeps the default path untouched", async () => {
  const root = await mkdtemp(join(tmpdir(), "scan-cleanup-default-"));
  const job = await createJob(root, {
    title: "Kursi",
    widthCm: 58,
    depthCm: 63,
    heightCm: 84,
    conditionNote: "",
    device: "Android",
    clientId: "",
  });
  const paths = jobPaths(root, job.id);
  await writeFile(join(paths.dir, "clip.webm"), "clip");
  const calls = [];
  const stub = async (name, args) => {
    calls.push([name, args]);
    if (name === "ffprobe")
      return {
        ms: 1,
        stdout: JSON.stringify({
          format: { duration: "12.3", size: "12000000" },
          streams: [{ codec_type: "video", width: 1280, height: 720 }],
        }),
      };
    if (name === "ffmpeg" && args[0] === "-version") return { ms: 1, stdout: "ffmpeg 8" };
    if (name === "ffmpeg") {
      await mkdir(paths.frames, { recursive: true });
      for (let index = 1; index <= 80; index += 1)
        await writeFile(join(paths.frames, `${String(index).padStart(4, "0")}.jpg`), "frame");
      return { ms: 5, stdout: "" };
    }
    if (name === "colmap" && args[0] === "--version") return { ms: 1, stdout: "COLMAP 4.2.1" };
    if (name === "colmap" && args[0] === "model_analyzer")
      return { ms: 1, stdout: "Registered images: 80" };
    if (name === "colmap" && args[0] === "mapper") {
      await mkdir(join(paths.work, "sparse", "0"), { recursive: true });
      await writeFile(join(paths.work, "sparse", "0", "images.bin"), "not a model");
      return { ms: 5, stdout: "" };
    }
    if (name === "colmap") return { ms: 2, stdout: "" };
    if (name === "brush" && args[0] === "--version") return { ms: 1, stdout: "brush-cli 0.3.0" };
    if (name === "brush") {
      await mkdir(paths.work, { recursive: true });
      await writeFile(join(paths.work, "scan.ply"), "ply\n");
      return { ms: 30, stdout: "" };
    }
    if (name === "splatTransform" && args[0] === "--version")
      return { ms: 1, stdout: "splat-transform v3.12.0" };
    if (name === "splatTransform") {
      await writeFile(args.at(-1), Buffer.alloc(64));
      return { ms: 2, stdout: '{"numGaussians":4096}' };
    }
    return { ms: 1, stdout: "" };
  };
  const result = await runRealPipeline(job, {
    root,
    updateStage: async () => {},
    runTool: stub,
    diskFree: async () => 10 * 1024 ** 3,
    profile: "default",
  });
  const conversion = calls.find(([name]) => name === "splatTransform");
  assert.ok(conversion[1][0].endsWith("scan.ply"), conversion[1][0]);
  // The default path keeps the 3000-step budget: a profile coupling must not
  // leak into it.
  const brushCall = calls.find(([name, args]) => name === "brush" && args[0] !== "--version");
  assert.equal(brushCall[1][brushCall[1].indexOf("--total-steps") + 1], "3000");
  assert.equal(result.provenance.profile, undefined);
  assert.equal(result.provenance.timings.cleanupMs, undefined);
  assert.deepEqual(Object.keys(result.provenance).sort(), [
    "artifact",
    "frames",
    "source",
    "timings",
    "tools",
  ]);
});

test("runRealPipeline keeps the default 3000-step training budget", async () => {
  // Covered end to end in scan-pipeline.test.js; this pins the profile coupling.
  assert.equal(CHAIR_PROFILE.trainSteps, 6000);
  const args = buildBrushArgs({ datasetDir: "D:\d", outputPly: "D:\o\scan.ply" });
  assert.equal(args[args.indexOf("--total-steps") + 1], "3000");
  const chairArgs = buildBrushArgs({
    datasetDir: "D:\d",
    outputPly: "D:\o\scan.ply",
    steps: CHAIR_PROFILE.trainSteps,
  });
  assert.equal(chairArgs[chairArgs.indexOf("--total-steps") + 1], "6000");
  assert.equal(chairArgs[chairArgs.indexOf("--export-every") + 1], "6000");
});

test("a failing cleanup falls back to the untouched export", async () => {
  const root = await mkdtemp(join(tmpdir(), "scan-cleanup-fallback-"));
  const job = await createJob(root, {
    title: "Kursi",
    widthCm: 58,
    depthCm: 63,
    heightCm: 84,
    conditionNote: "",
    device: "Android",
    clientId: "",
  });
  const paths = jobPaths(root, job.id);
  await writeFile(join(paths.dir, "clip.webm"), "clip");
  const calls = [];
  const stub = async (name, args) => {
    calls.push([name, args]);
    if (name === "ffprobe")
      return {
        ms: 1,
        stdout: JSON.stringify({
          format: { duration: "12.3", size: "12000000" },
          streams: [{ codec_type: "video", width: 1280, height: 720 }],
        }),
      };
    if (name === "ffmpeg" && args[0] === "-version") return { ms: 1, stdout: "ffmpeg 8" };
    if (name === "ffmpeg") {
      await mkdir(paths.frames, { recursive: true });
      for (let index = 1; index <= 80; index += 1)
        await writeFile(join(paths.frames, `${String(index).padStart(4, "0")}.jpg`), "frame");
      return { ms: 5, stdout: "" };
    }
    if (name === "colmap" && args[0] === "--version") return { ms: 1, stdout: "COLMAP 4.2.1" };
    if (name === "colmap" && args[0] === "model_analyzer")
      return { ms: 1, stdout: "Registered images: 80" };
    if (name === "colmap" && args[0] === "mapper") {
      await mkdir(join(paths.work, "sparse", "0"), { recursive: true });
      await writeFile(join(paths.work, "sparse", "0", "images.bin"), "not a model");
      return { ms: 5, stdout: "" };
    }
    if (name === "colmap") return { ms: 2, stdout: "" };
    if (name === "brush" && args[0] === "--version") return { ms: 1, stdout: "brush-cli 0.3.0" };
    if (name === "brush") {
      await mkdir(paths.work, { recursive: true });
      await writeFile(join(paths.work, "scan.ply"), "ply\n");
      return { ms: 30, stdout: "" };
    }
    if (name === "splatTransform" && args[0] === "--version")
      return { ms: 1, stdout: "splat-transform v3.12.0" };
    if (name === "splatTransform") {
      await writeFile(args.at(-1), Buffer.alloc(64));
      return { ms: 2, stdout: '{"numGaussians":4096}' };
    }
    return { ms: 1, stdout: "" };
  };
  const result = await runRealPipeline(job, {
    root,
    updateStage: async () => {},
    runTool: stub,
    diskFree: async () => 10 * 1024 ** 3,
    profile: "chair",
  });
  const conversion = calls.find(([name]) => name === "splatTransform");
  assert.ok(conversion[1][0].endsWith("scan.ply"), conversion[1][0]);
  assert.equal(result.provenance.profile.applied, false);
  assert.match(result.provenance.profile.reason, /images\.bin|model/i);
  // No usable subject point means no sphere, so the longer profile budget must
  // not be paid for either.
  const brushCall = calls.find(([name, args]) => name === "brush" && args[0] !== "--version");
  assert.equal(brushCall[1][brushCall[1].indexOf("--total-steps") + 1], "3000");
});
