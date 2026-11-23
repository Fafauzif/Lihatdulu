import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { createFrameExtractor } from "../server/kiri-frames.mjs";

// ffmpeg is simulated: the fake child writes the JPEGs the real one would, so
// the extractor's argument building, counting and failure paths are tested
// without depending on an installed binary.

async function writeFrames(pattern, count) {
  const directory = dirname(pattern);
  await mkdir(directory, { recursive: true });
  for (let index = 1; index <= count; index += 1) {
    const name = `frame-${String(index).padStart(4, "0")}.jpg`;
    await writeFile(join(directory, name), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  }
}

function fakeSpawn({ frames = 24, probeFails = false, exitCode = 0, runError } = {}) {
  const calls = [];
  const spawnImpl = (bin, args, options) => {
    calls.push({ bin, args, options });
    const child = new EventEmitter();
    child.stderr = new PassThrough();
    child.kill = () => {};
    const isProbe = args.includes("-version");
    setImmediate(async () => {
      if (isProbe) {
        child.emit("close", probeFails ? 1 : 0);
        return;
      }
      if (runError) {
        child.emit("error", runError);
        return;
      }
      if (frames > 0) await writeFrames(args[args.length - 1], frames);
      child.emit("close", exitCode);
    });
    return child;
  };
  return { spawnImpl, calls };
}

async function tempDir(t) {
  const directory = await mkdtemp(join(tmpdir(), "lihatdulu-kiri-frames-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test("extract samples the clip with bounded fps and frame count", async (t) => {
  const directory = await tempDir(t);
  const { spawnImpl, calls } = fakeSpawn({ frames: 24 });
  const extractor = createFrameExtractor({ ffmpegPath: "ffmpeg", spawnImpl });
  const files = await extractor.extract({
    videoPath: join(directory, "clip.mp4"),
    directory: join(directory, "frames"),
    fps: 4,
    count: 120,
  });
  assert.equal(files.length, 24);
  assert.deepEqual(
    files.slice(0, 2).map((file) => file.filename),
    ["frame-0001.jpg", "frame-0002.jpg"],
  );
  assert.match(files[0].path, /frames[\\/]frame-0001\.jpg$/);
  const run = calls.find((call) => !call.args.includes("-version"));
  assert.equal(run.bin, "ffmpeg");
  assert.equal(run.options.stdio[0], "ignore");
  assert.ok(run.args.includes("fps=4"));
  assert.ok(run.args.includes("-frames:v"));
  assert.equal(run.args[run.args.indexOf("-frames:v") + 1], "120");
  assert.match(run.args[run.args.length - 1], /frame-%04d\.jpg$/);
});

test("extract caps the photo count at KIRI's ceiling", async (t) => {
  const directory = await tempDir(t);
  const { spawnImpl, calls } = fakeSpawn({ frames: 24 });
  const extractor = createFrameExtractor({ spawnImpl, maxPhotos: 40 });
  await extractor.extract({
    videoPath: join(directory, "clip.mp4"),
    directory: join(directory, "frames"),
    count: 900,
  });
  const run = calls.find((call) => !call.args.includes("-version"));
  assert.equal(run.args[run.args.indexOf("-frames:v") + 1], "40");
});

test("extract refuses a clip that yields too few stills", async (t) => {
  const directory = await tempDir(t);
  const { spawnImpl } = fakeSpawn({ frames: 5 });
  const extractor = createFrameExtractor({ spawnImpl });
  await assert.rejects(
    extractor.extract({
      videoPath: join(directory, "clip.mp4"),
      directory: join(directory, "frames"),
    }),
    (error) => {
      assert.equal(error.code, "kiri_unavailable");
      assert.match(error.detail, /minimal 20/);
      return true;
    },
  );
});

test("extract reports a missing ffmpeg instead of throwing raw ENOENT", async (t) => {
  const directory = await tempDir(t);
  const { spawnImpl } = fakeSpawn({ probeFails: true });
  const extractor = createFrameExtractor({ spawnImpl });
  await assert.rejects(
    extractor.extract({
      videoPath: join(directory, "clip.mp4"),
      directory: join(directory, "frames"),
    }),
    (error) => {
      assert.equal(error.code, "kiri_unavailable");
      assert.match(error.detail, /ffmpeg/);
      return true;
    },
  );
});

test("extract surfaces a non-zero ffmpeg exit with a short reason", async (t) => {
  const directory = await tempDir(t);
  const { spawnImpl } = fakeSpawn({ frames: 0, exitCode: 1 });
  const extractor = createFrameExtractor({ spawnImpl });
  await assert.rejects(
    extractor.extract({
      videoPath: join(directory, "clip.mp4"),
      directory: join(directory, "frames"),
    }),
    (error) => {
      assert.equal(error.code, "kiri_unavailable");
      assert.match(error.detail, /kode 1/);
      return true;
    },
  );
});

test("extract rejects an empty request before spawning anything", async () => {
  const extractor = createFrameExtractor({
    spawnImpl: () => {
      throw new Error("must not spawn");
    },
  });
  await assert.rejects(extractor.extract({}), (error) => {
    assert.equal(error.code, "kiri_unavailable");
    assert.match(error.detail, /kosong/);
    return true;
  });
});

test("frames land in a directory the job can delete afterwards", async (t) => {
  const directory = await tempDir(t);
  const { spawnImpl } = fakeSpawn({ frames: 21 });
  const extractor = createFrameExtractor({ spawnImpl });
  const framesDirectory = join(directory, "frames");
  await extractor.extract({
    videoPath: join(directory, "clip.mp4"),
    directory: framesDirectory,
  });
  assert.equal((await readdir(framesDirectory)).length, 21);
});
