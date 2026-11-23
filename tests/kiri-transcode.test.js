import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SCALE_FILTER,
  createVideoTranscoder,
  parseFfmpegDuration,
  sniffVideoContainer,
  transcodeArgs,
} from "../server/kiri-transcode.mjs";
import { KiriError } from "../server/kiri-errors.mjs";

// The phone-format problem in one file: Android records WebM, KIRI wants MP4,
// and the conversion must happen on the server without a shell.

function mp4Head(brand = "isom") {
  const head = Buffer.alloc(16);
  head.writeUInt32BE(0x18, 0);
  head.write("ftyp", 4, "latin1");
  head.write(brand, 8, "latin1");
  return head;
}

test("containers are identified by bytes, not by the file name", () => {
  assert.equal(sniffVideoContainer(mp4Head()), "mp4");
  assert.equal(sniffVideoContainer(mp4Head("qt  ")), "mov");
  assert.equal(
    sniffVideoContainer(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0])),
    "webm",
  );
  assert.equal(sniffVideoContainer(Buffer.from("<html>nope</html>")), "unknown");
  assert.equal(sniffVideoContainer(null), "unknown");
});

test("the ffmpeg duration line is parsed, and a missing one is not invented", () => {
  assert.equal(
    parseFfmpegDuration("  Duration: 00:00:15.03, start: 0.000000, bitrate: 4100 kb/s"),
    15.03,
  );
  assert.equal(parseFfmpegDuration("Duration: 00:01:02.50, start"), 62.5);
  assert.equal(parseFfmpegDuration("no header here"), null);
});

test("the transcode argument array is fixed and caps the frame at KIRI's ceiling", () => {
  const args = transcodeArgs("/tmp/in.webm", "/tmp/out.mp4");
  assert.deepEqual(args.slice(0, 6), ["-hide_banner", "-nostdin", "-loglevel", "info", "-y", "-i"]);
  assert.equal(args[6], "/tmp/in.webm");
  assert.ok(args.includes("libx264"));
  assert.ok(args.includes("+faststart"));
  // No audio: the recorder never captures sound and KIRI does not use it.
  assert.ok(args.includes("-an"));
  assert.equal(args[args.indexOf("-vf") + 1], SCALE_FILTER);
  assert.match(SCALE_FILTER, /min\(1920/);
  assert.match(SCALE_FILTER, /min\(1080/);
  assert.equal(args.at(-1), "/tmp/out.mp4");
});

function fakeSpawn({ duration = "00:00:12.00", exitCode = 0, onRun = null } = {}) {
  const calls = [];
  const spawnImpl = (command, args) => {
    calls.push({ command, args });
    const child = new EventEmitter();
    child.kill = () => {};
    child.stderr = new EventEmitter();
    child.stdout = new EventEmitter();
    setTimeout(async () => {
      if (args.includes("-version")) {
        child.emit("close", 0);
        return;
      }
      if (onRun) await onRun(args);
      else {
        const output = args.at(-1);
        await writeFile(output, Buffer.alloc(2048, 7));
      }
      child.stderr.emit("data", Buffer.from(`  Duration: ${duration}, start: 0`));
      child.emit("close", exitCode);
    }, 0);
    return child;
  };
  return { spawnImpl, calls };
}

test("a WebM clip is converted and its duration is reported", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "lihatdulu-transcode-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const input = join(dir, "in.webm");
  const output = join(dir, "out.mp4");
  await writeFile(input, Buffer.from("webm"));
  const { spawnImpl, calls } = fakeSpawn();
  const transcoder = createVideoTranscoder({ spawnImpl, ffmpegPath: "ffmpeg" });
  const result = await transcoder.toMp4({ inputPath: input, outputPath: output });
  assert.equal(result.converted, true);
  assert.equal(result.durationS, 12);
  assert.equal(result.bytes, 2048);
  assert.equal(calls.length, 2, "one probe and one conversion");
  assert.ok(calls[1].args.includes(input));
});

test("a clip over the duration ceiling is refused and its output removed", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "lihatdulu-transcode-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const input = join(dir, "in.webm");
  const output = join(dir, "out.mp4");
  await writeFile(input, Buffer.from("webm"));
  const { spawnImpl } = fakeSpawn({ duration: "00:04:30.00" });
  const transcoder = createVideoTranscoder({ spawnImpl, maxDurationS: 180 });
  await assert.rejects(
    () => transcoder.toMp4({ inputPath: input, outputPath: output }),
    (error) => error instanceof KiriError && error.code === "video_too_long",
  );
  await assert.rejects(() => readFile(output), /ENOENT/);
});

test("a failing ffmpeg is a conversion error, not a silent success", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "lihatdulu-transcode-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const input = join(dir, "in.webm");
  const output = join(dir, "out.mp4");
  await writeFile(input, Buffer.from("webm"));
  const { spawnImpl } = fakeSpawn({ exitCode: 1 });
  const transcoder = createVideoTranscoder({ spawnImpl });
  await assert.rejects(
    () => transcoder.toMp4({ inputPath: input, outputPath: output }),
    (error) => error instanceof KiriError && error.code === "video_convert_failed",
  );
});

test("without ffmpeg the page is told to use the camera app, not left hanging", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "lihatdulu-transcode-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const input = join(dir, "in.webm");
  const output = join(dir, "out.mp4");
  await writeFile(input, Buffer.from("webm"));
  const spawnImpl = () => {
    const child = new EventEmitter();
    child.kill = () => {};
    child.stderr = new EventEmitter();
    setTimeout(() => child.emit("error", new Error("ENOENT")), 0);
    return child;
  };
  const logs = [];
  const transcoder = createVideoTranscoder({ spawnImpl, log: (entry) => logs.push(entry) });
  await assert.rejects(
    () => transcoder.toMp4({ inputPath: input, outputPath: output }),
    (error) => error instanceof KiriError && error.code === "video_needs_converter",
  );
  assert.ok(logs.some((entry) => entry.event === "transcode_unavailable"));
});

test("an oversized conversion is refused before it is sent to KIRI", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "lihatdulu-transcode-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const input = join(dir, "in.webm");
  const output = join(dir, "out.mp4");
  await writeFile(input, Buffer.from("webm"));
  const { spawnImpl } = fakeSpawn();
  const transcoder = createVideoTranscoder({ spawnImpl, maxBytes: 1000 });
  await assert.rejects(
    () => transcoder.toMp4({ inputPath: input, outputPath: output }),
    (error) => error instanceof KiriError && error.code === "video_too_large",
  );
});
