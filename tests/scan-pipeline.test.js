import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import {
  BRUSH_ARGS_TEMPLATE,
  FRAME_FILTER,
  buildAnalyzeArgs,
  buildBrushArgs,
  buildConvertArgs,
  buildDecimateArgs,
  buildExtractArgs,
  buildFeatureArgs,
  buildFfprobeArgs,
  buildMapperArgs,
  buildMatchArgs,
  extractionFps,
  frameFilter,
} from "../server/scan-pipeline.mjs";

test("buildExtractArgs uses the recorded filter and numbered output", () => {
  assert.equal(FRAME_FILTER, "fps=3,scale=1280:-2");
  assert.deepEqual(
    buildExtractArgs({ clip: "C:\\a\\clip.mp4", framesDir: "C:\\a\\frames" }),
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      "C:\\a\\clip.mp4",
      "-vf",
      FRAME_FILTER,
      "-q:v",
      "2",
      join("C:\\a\\frames", "%04d.jpg"),
    ],
  );
});

test("buildFfprobeArgs asks for JSON format and streams", () => {
  assert.deepEqual(buildFfprobeArgs({ clip: "C:\\a\\clip.mp4" }), [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    "C:\\a\\clip.mp4",
  ]);
});

test("COLMAP builders match the recorded 4.2.1 flags", () => {
  assert.deepEqual(buildFeatureArgs({ database: "D:\\db", images: "D:\\img" }), [
    "feature_extractor",
    "--database_path",
    "D:\\db",
    "--image_path",
    "D:\\img",
    "--ImageReader.single_camera",
    "1",
    "--ImageReader.camera_model",
    "OPENCV",
  ]);
  assert.deepEqual(buildMatchArgs({ database: "D:\\db" }), [
    "sequential_matcher",
    "--database_path",
    "D:\\db",
    "--SequentialMatching.overlap",
    "10",
    "--SequentialMatching.loop_detection",
    "0",
  ]);
  assert.deepEqual(
    buildMapperArgs({ database: "D:\\db", images: "D:\\img", sparse: "D:\\sp" }),
    [
      "mapper",
      "--database_path",
      "D:\\db",
      "--image_path",
      "D:\\img",
      "--output_path",
      "D:\\sp",
    ],
  );
  assert.deepEqual(buildAnalyzeArgs({ model: "D:\\sp\\0" }), [
    "model_analyzer",
    "--path",
    "D:\\sp\\0",
  ]);
});

test("BRUSH_ARGS_TEMPLATE substitutes dataset and export target", () => {
  const args = buildBrushArgs({
    datasetDir: "D:\\dataset",
    outputPly: "D:\\out\\scan.ply",
  });
  assert.ok(BRUSH_ARGS_TEMPLATE.includes("{dataset}"));
  assert.ok(BRUSH_ARGS_TEMPLATE.includes("{exportPath}"));
  assert.ok(BRUSH_ARGS_TEMPLATE.includes("{exportName}"));
  assert.ok(args.includes("D:\\dataset"));
  assert.ok(args.includes("D:\\out"));
  assert.ok(args.includes("scan.ply"));
  assert.ok(!args.some((arg) => arg.includes("{")));
  assert.ok(args.includes("--total-steps"));
  assert.ok(args.includes("--max-splats"));
  assert.ok(args.includes("--export-every"));
});

test("conversion and decimation builders keep the CLI order", () => {
  assert.deepEqual(
    buildConvertArgs({ inputPly: "D:\\scan.ply", outputSpz: "D:\\scan.spz" }),
    ["D:\\scan.ply", "--filter-nan", "D:\\scan.spz"],
  );
  assert.deepEqual(
    buildConvertArgs({
      inputPly: "D:\\scan.ply",
      outputSpz: "D:\\scan.spz",
      info: true,
    }),
    ["D:\\scan.ply", "--filter-nan", "--info", "json", "D:\\scan.spz"],
  );
  assert.deepEqual(
    buildDecimateArgs({ inputPly: "D:\\scan.ply", outputPly: "D:\\small.ply" }),
    ["D:\\scan.ply", "--decimate", "2000000", "D:\\small.ply"],
  );
});

test("short takes extract at a higher fps to reach the frame floor", () => {
  assert.equal(extractionFps(25.35), 3);
  assert.equal(extractionFps(20.13), 3);
  assert.equal(extractionFps(15.0), 4);
  assert.equal(extractionFps(14.585), 5);
  assert.equal(extractionFps(10.03), 6);
  assert.equal(extractionFps(3.33), 8);
});

test("buildExtractArgs uses the requested fps", () => {
  assert.equal(frameFilter(5), "fps=5,scale=1280:-2");
  assert.deepEqual(
    buildExtractArgs({ clip: "C:\\a\\clip.mp4", framesDir: "C:\\a\\frames", fps: 5 }).slice(5, 7),
    ["-vf", "fps=5,scale=1280:-2"],
  );
});
