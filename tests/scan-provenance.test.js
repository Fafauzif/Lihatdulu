import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_LIMITS,
  buildProvenance,
  findBrushOutput,
  parseFfprobe,
  parseRegisteredImages,
  parseSplatCount,
  runRealPipeline,
} from "../server/scan-pipeline.mjs";
import { createJob, jobPaths } from "../server/scan-jobs.mjs";

const meta = {
  title: "Kursi",
  widthCm: 58,
  depthCm: 63,
  heightCm: 84,
  conditionNote: "",
  device: "Android",
  clientId: "",
};

const ffprobeJson = JSON.stringify({
  format: { duration: "12.3", size: "12000000" },
  streams: [{ codec_type: "video", width: 1280, height: 720 }],
});

const analyzerLine =
  "Cameras: 1\nImages: 90\nRegistered images: 78\nPoints: 51234";

async function makeRoot() {
  return mkdtemp(join(tmpdir(), "scan-pipe-"));
}

async function makeStub(root, job, { frames = 90, registered = 78, bytes = 100 } = {}) {
  const calls = [];
  const paths = jobPaths(root, job.id);
  let decimated = false;
  const stub = async (name, args) => {
    calls.push([name, args]);
    if (name === "ffprobe") return { ms: 1, stdout: ffprobeJson };
    if (name === "ffmpeg" && args[0] === "-version")
      return { ms: 1, stdout: "ffmpeg version 8.1.2" };
    if (name === "ffmpeg") {
      await mkdir(paths.frames, { recursive: true });
      for (let index = 1; index <= frames; index++)
        await writeFile(
          join(paths.frames, `${String(index).padStart(4, "0")}.jpg`),
          "frame",
        );
      return { ms: 12, stdout: "" };
    }
    if (name === "colmap" && args[0] === "--version")
      return { ms: 1, stdout: "COLMAP 4.2.1" };
    if (name === "colmap" && args[0] === "model_analyzer")
      return {
        ms: 1,
        stdout: `Cameras: 1\nImages: ${frames}\nRegistered images: ${registered}`,
      };
    if (name === "colmap" && args[0] === "mapper") {
      await mkdir(join(paths.work, "sparse", "0"), { recursive: true });
      await writeFile(join(paths.work, "sparse", "0", "images.bin"), "x");
      return { ms: 20, stdout: "" };
    }
    if (name === "colmap") return { ms: 5, stdout: "" };
    if (name === "brush" && args[0] === "--version")
      return { ms: 1, stdout: "brush-cli 0.3.0" };
    if (name === "brush") {
      await mkdir(paths.work, { recursive: true });
      await writeFile(join(paths.work, "scan.ply"), "ply\n");
      return { ms: 30, stdout: "" };
    }
    if (name === "splatTransform" && args[0] === "--version")
      return { ms: 1, stdout: "splat-transform v3.12.0" };
    if (name === "splatTransform" && args.includes("--decimate")) {
      decimated = true;
      await writeFile(args.at(-1), Buffer.alloc(10));
      return { ms: 2, stdout: "" };
    }
    if (name === "splatTransform") {
      await writeFile(args.at(-1), Buffer.alloc(decimated ? 20 : bytes));
      return { ms: 3, stdout: '{"numGaussians":4096}' };
    }
    return { ms: 1, stdout: "" };
  };
  return { stub, calls };
}

async function jobWithClip(root) {
  const job = await createJob(root, meta);
  await writeFile(join(jobPaths(root, job.id).dir, "clip.webm"), "clip");
  return job;
}

const context = (root, stub, limits = {}) => ({
  root,
  updateStage: async () => {},
  runTool: stub,
  diskFree: async () => DEFAULT_LIMITS.minFreeBytes,
  limits,
});

test("parseFfprobe reads duration, size and the video stream", () => {
  assert.deepEqual(parseFfprobe(ffprobeJson), {
    durationS: 12.3,
    width: 1280,
    height: 720,
    bytes: 12000000,
  });
  assert.throws(() => parseFfprobe("{}"), /tidak bisa dibaca/);
});

test("parseRegisteredImages and parseSplatCount read recorded output", () => {
  assert.equal(parseRegisteredImages(analyzerLine), 78);
  assert.equal(parseSplatCount('{"numGaussians": 4096}'), 4096);
  assert.throws(() => parseSplatCount("{}"), /jumlah splat/);
});

test("findBrushOutput finds the exported ply", async () => {
  const root = await makeRoot();
  await writeFile(join(root, "scan.ply"), "ply\n");
  assert.equal(await findBrushOutput(root), join(root, "scan.ply"));
});

test("runRealPipeline reports stages and builds provenance", async () => {
  const root = await makeRoot();
  const job = await jobWithClip(root);
  const stages = [];
  const { stub } = await makeStub(root, job);
  const result = await runRealPipeline(job, {
    ...context(root, stub),
    updateStage: async (stage) => stages.push(stage),
  });
  assert.deepEqual(stages, [
    "validating",
    "extracting",
    "aligning",
    "reconstructing",
    "finalizing",
  ]);
  assert.equal(result.media.durationS, 12.3);
  assert.equal(result.provenance.frames.extracted, 90);
  assert.equal(result.provenance.frames.registered, 78);
  assert.equal(result.provenance.artifact.splatCount, 4096);
  assert.equal(result.artifact.file, "scan.spz");
  assert.equal(result.artifact.stills.length, 3);
});

test("short footage and poor registration fail with useful codes", async () => {
  const shortRoot = await makeRoot();
  const shortJob = await jobWithClip(shortRoot);
  const short = await makeStub(shortRoot, shortJob, { frames: 40 });
  await assert.rejects(
    () =>
      runRealPipeline(shortJob, context(shortRoot, short.stub)),
    (error) => error.code === "footage_short",
  );

  const poorRoot = await makeRoot();
  const poorJob = await jobWithClip(poorRoot);
  const poor = await makeStub(poorRoot, poorJob, { registered: 5 });
  await assert.rejects(
    () => runRealPipeline(poorJob, context(poorRoot, poor.stub)),
    (error) => error.code === "alignment_failed",
  );
});

test("an artifact over the cap is decimated once and converted again", async () => {
  const root = await makeRoot();
  const job = await jobWithClip(root);
  const { stub, calls } = await makeStub(root, job, { bytes: 100 });
  const result = await runRealPipeline(
    job,
    context(root, stub, { maxArtifactBytes: 50 }),
  );
  const conversions = calls.filter(([name]) => name === "splatTransform");
  assert.equal(
    conversions.filter(([, args]) => args.includes("--decimate")).length,
    1,
  );
  assert.ok(result.artifact.bytes <= 50);
});

test("buildProvenance keeps the DTO shape", () => {
  const provenance = buildProvenance({
    media: { durationS: 12.3 },
    device: "Android",
    frames: { extracted: 90, registered: 78 },
    timings: {
      extractMs: 12,
      alignMs: 30,
      trainMs: 40,
      convertMs: 5,
      totalMs: 87,
    },
    artifact: { format: "spz", bytes: 100, splatCount: 4096 },
    tools: { ffmpeg: "8", colmap: "4.2.1", brush: "0.3.0" },
  });
  assert.deepEqual(Object.keys(provenance).sort(), [
    "artifact",
    "frames",
    "source",
    "timings",
    "tools",
  ]);
  assert.equal(provenance.frames.ratio, 0.8667);
  assert.equal(provenance.source.clipSeconds, 12.3);
});
