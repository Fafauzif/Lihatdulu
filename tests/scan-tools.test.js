import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  TOOL_NAMES,
  resolveTool,
  runTool,
} from "../server/scan-tools.mjs";
import { ScanError } from "../server/scan-errors.mjs";

test("resolveTool returns a command and prefix for ffmpeg and splat-transform", () => {
  process.env.SCAN_FFMPEG = "C:\\tools\\ffmpeg.exe";
  assert.deepEqual(resolveTool("ffmpeg"), {
    command: "C:\\tools\\ffmpeg.exe",
    prefix: [],
  });
  const splat = resolveTool("splatTransform");
  assert.equal(splat.command, process.execPath);
  assert.match(splat.prefix[0], /splat-transform[\\/]bin[\\/]cli\.mjs$/);
  assert.deepEqual(TOOL_NAMES, [
    "ffprobe",
    "ffmpeg",
    "colmap",
    "brush",
    "splatTransform",
  ]);
  delete process.env.SCAN_FFMPEG;
});

test("resolveTool reports an unknown tool", () => {
  assert.throws(
    () => resolveTool("nope"),
    (error) => error instanceof ScanError && error.code === "tool_missing",
  );
});

test("runTool reports tool_missing for a binary that cannot spawn", async () => {
  process.env.SCAN_FFMPEG = "definitely-not-a-real-binary";
  await assert.rejects(
    () => runTool("ffmpeg", ["-version"], { timeoutMs: 1000 }),
    (error) => error.code === "tool_missing",
  );
  delete process.env.SCAN_FFMPEG;
});

test("runTool appends output and maps a timeout", async () => {
  const logPath = join(await mkdtemp(join(tmpdir(), "scan-tool-")), "tool.log");
  process.env.SCAN_FFMPEG = process.execPath;
  await assert.rejects(
    () =>
      runTool(
        "ffmpeg",
        ["-e", "process.stdout.write('halo'); setTimeout(() => {}, 5000)"],
        { timeoutMs: 120, logPath },
      ),
    (error) => error.code === "tool_timeout",
  );
  assert.match(await readFile(logPath, "utf8"), /halo/);
  delete process.env.SCAN_FFMPEG;
});

test("runTool resolves with elapsed milliseconds on success", async () => {
  process.env.SCAN_FFMPEG = process.execPath;
  const result = await runTool("ffmpeg", ["-e", "process.exit(0)"], {
    timeoutMs: 2000,
  });
  assert.equal(typeof result.ms, "number");
  assert.ok(result.ms >= 0);
  delete process.env.SCAN_FFMPEG;
});
