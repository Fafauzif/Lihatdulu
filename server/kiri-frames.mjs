import { spawn as defaultSpawn } from "node:child_process";
import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { KiriError } from "./kiri-errors.mjs";

// KIRI's 3DGS photo endpoint wants 20–300 stills. A seller sends one clip, so
// the server samples it with ffmpeg (already required by the asset scripts) and
// sends the frames to /v1/open/3dgs/image. A video orbit reconstructs the whole
// room around a chair; the same frames as a photoset reconstruct the chair.
//
// ffmpeg is always spawned with an argument array, never a shell string, and
// the extractor is injectable so tests never need the real binary.

export const MIN_PHOTOS = 20;
export const MAX_PHOTOS = 300;
export const FRAME_PATTERN = "frame-%04d.jpg";

export function createFrameExtractor({
  ffmpegPath = "ffmpeg",
  spawnImpl = defaultSpawn,
  minPhotos = MIN_PHOTOS,
  maxPhotos = MAX_PHOTOS,
} = {}) {
  let available = null;

  async function probe() {
    if (available !== null) return available;
    available = await new Promise((resolve) => {
      let child;
      try {
        child = spawnImpl(ffmpegPath, ["-hide_banner", "-version"], {
          stdio: "ignore",
          windowsHide: true,
        });
      } catch {
        resolve(false);
        return;
      }
      child.on?.("error", () => resolve(false));
      child.on?.("close", (code) => resolve(code === 0));
    });
    return available;
  }

  function run(args, timeoutMs) {
    return new Promise((resolve, reject) => {
      const child = spawnImpl(ffmpegPath, args, {
        stdio: ["ignore", "ignore", "pipe"],
        windowsHide: true,
      });
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill?.("SIGKILL");
        reject(new KiriError("kiri_unavailable", { detail: "ffmpeg timeout" }));
      }, timeoutMs);
      child.stderr?.on("data", (chunk) => {
        stderr = (stderr + String(chunk)).slice(-400);
      });
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(
          new KiriError("kiri_unavailable", {
            cause: error,
            detail: "ffmpeg tidak tersedia",
          }),
        );
      });
      child.once("close", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else
          reject(
            new KiriError("kiri_unavailable", {
              detail: `ffmpeg keluar dengan kode ${code}: ${stderr.slice(0, 160)}`,
            }),
          );
      });
    });
  }

  // Returns [{ path, filename }] sorted by frame number, or throws a KiriError
  // so the caller can fall back to sending the video itself.
  async function extract({
    videoPath,
    directory,
    fps = 4,
    count = maxPhotos,
    timeoutMs = 180_000,
  } = {}) {
    if (!videoPath || !directory)
      throw new KiriError("kiri_unavailable", { detail: "frame input kosong" });
    if (!(await probe()))
      throw new KiriError("kiri_unavailable", { detail: "ffmpeg tidak ada di PATH" });
    await mkdir(directory, { recursive: true });
    const limit = Math.max(minPhotos, Math.min(maxPhotos, Math.trunc(count)));
    await run(
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        videoPath,
        "-vf",
        `fps=${fps}`,
        "-frames:v",
        String(limit),
        "-q:v",
        "2",
        join(directory, FRAME_PATTERN),
      ],
      timeoutMs,
    );
    const names = (await readdir(directory))
      .filter((name) => name.endsWith(".jpg"))
      .sort();
    if (names.length < minPhotos)
      throw new KiriError("kiri_unavailable", {
        detail: `hanya ${names.length} frame, minimal ${minPhotos}`,
      });
    return names.map((filename) => ({ path: join(directory, filename), filename }));
  }

  return { probe, extract };
}
