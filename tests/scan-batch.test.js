import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readJob } from "../server/scan-jobs.mjs";
import { ScanError } from "../server/scan-errors.mjs";
import {
  listClips,
  runBatch,
  selectClips,
  summarizeRun,
  toolDefaults,
} from "../scripts/scan-batch.mjs";

test("selectClips matches tokens case-insensitively and keeps order", () => {
  const clips = [
    { name: "chair-01-golden.mp4" },
    { name: "chair-02-repeat.mov" },
    { name: "VID_3.mp4" },
  ];
  assert.deepEqual(
    selectClips(clips, ["REPEAT", "01"]).map((clip) => clip.name),
    ["chair-01-golden.mp4", "chair-02-repeat.mov"],
  );
  assert.equal(selectClips(clips, []).length, 3);
});

test("summarizeRun exposes the comparison numbers", () => {
  const summary = summarizeRun({
    provenance: {
      frames: { extracted: 76, registered: 61, ratio: 0.8026 },
      timings: { totalMs: 300000 },
    },
    artifact: { splatCount: 120000, bytes: 2_300_000, format: "spz" },
  });
  assert.deepEqual(summary, {
    extracted: 76,
    registered: 61,
    ratio: 0.8026,
    totalMs: 300000,
    splatCount: 120000,
    bytes: 2_300_000,
    format: "spz",
  });
});

test("toolDefaults finds pinned binaries only when they exist", async () => {
  const root = await mkdtemp(join(tmpdir(), "scan-tools-"));
  assert.deepEqual(toolDefaults(root), { colmap: "", brush: "" });
  await mkdir(join(root, "var/tools/colmap/bin"), { recursive: true });
  await writeFile(join(root, "var/tools/colmap/bin/colmap.exe"), "x");
  assert.match(toolDefaults(root).colmap, /colmap\.exe$/);
});

test("runBatch records a failed clip and still runs the next one", async () => {
  const root = await mkdtemp(join(tmpdir(), "scan-batch-"));
  const clips = [
    { name: "chair-a.mp4", path: join(root, "chair-a.mp4"), sizeBytes: 1 },
    { name: "chair-b.mp4", path: join(root, "chair-b.mp4"), sizeBytes: 1 },
  ];
  await writeFile(clips[0].path, "x");
  await writeFile(clips[1].path, "x");
  const calls = [];
  const pipeline = async (record) => {
    calls.push(record.meta.title);
    if (record.meta.title === "chair-a")
      throw new ScanError("alignment_failed", "uji");
    return {
      media: { ...record.media, durationS: 12.3, width: 1280, height: 720 },
      provenance: {
        frames: { extracted: 60, registered: 50, ratio: 0.8333 },
        timings: { totalMs: 1 },
      },
      artifact: { format: "spz", bytes: 10, splatCount: 60, file: "scan.spz", stills: [] },
    };
  };
  const results = await runBatch({ root, clips, pipeline });
  assert.deepEqual(calls, ["chair-a", "chair-b"]);
  assert.deepEqual(results.map((result) => result.ok), [false, true]);
  assert.equal((await readJob(root, results[0].jobId)).error.code, "alignment_failed");
});
