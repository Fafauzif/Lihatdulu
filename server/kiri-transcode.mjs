import { spawn as defaultSpawn } from "node:child_process";
import { rm, stat } from "node:fs/promises";
import { KiriError } from "./kiri-errors.mjs";

// Phones disagree about what MediaRecorder produces. iOS writes MP4 (H.264),
// Android Chromium writes WebM (VP8/VP9). KIRI's video endpoint wants MP4, and
// so does our own header check, so the server transcodes the one format it was
// handed instead of asking the seller to install a converter app.
//
// The transcoder is deliberately small and injectable: one process, a fixed
// argument array, a timeout, and a parsed duration. Tests never need ffmpeg.

// A container is identified by its first bytes, not by the file extension: a
// phone can hand us `clip.mp4` that is really WebM, and KIRI would reject it
// after the upload was paid for.
export function sniffVideoContainer(head) {
  if (!Buffer.isBuffer(head) || head.length < 12) return "unknown";
  if (head.toString("latin1", 4, 8) === "ftyp")
    return head.toString("latin1", 8, 11) === "qt " ? "mov" : "mp4";
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3)
    return "webm";
  return "unknown";
}

export function parseFfmpegDuration(stderr) {
  const match = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(String(stderr ?? ""));
  if (!match) return null;
  const seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  return Number.isFinite(seconds) ? seconds : null;
}

// Long edge 1920, short edge 1080, either orientation. -2 keeps the aspect
// ratio and forces an even height, which libx264 requires.
export const SCALE_FILTER =
  "scale='if(gte(iw,ih),min(1920,iw),min(1080,iw))':-2";

export function transcodeArgs(inputPath, outputPath) {
  return [
    "-hide_banner",
    "-nostdin",
    "-loglevel",
    "info",
    "-y",
    "-i",
    inputPath,
    "-an",
    "-sn",
    "-vf",
    SCALE_FILTER,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    outputPath,
  ];
}

export function createVideoTranscoder({
  ffmpegPath = "ffmpeg",
  spawnImpl = defaultSpawn,
  timeoutMs = 5 * 60 * 1000,
  maxBytes = 200 * 1024 * 1024,
  maxDurationS = 180,
  log = () => {},
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
      let settled = false;
      const settle = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      child.on?.("error", () => settle(false));
      child.on?.("close", (code) => settle(code === 0));
      setTimeout(() => {
        try {
          child.kill?.("SIGKILL");
        } catch {}
        settle(false);
      }, 5000);
    });
    if (!available) log({ event: "transcode_unavailable", detail: "ffmpeg tidak ada" });
    return available;
  }

  function run(inputPath, outputPath) {
    return new Promise((resolve, reject) => {
      const child = spawnImpl(ffmpegPath, transcodeArgs(inputPath, outputPath), {
        stdio: ["ignore", "ignore", "pipe"],
        windowsHide: true,
      });
      let stderr = "";
      const timer = setTimeout(() => {
        try {
          child.kill?.("SIGKILL");
        } catch {}
        reject(new KiriError("video_convert_failed", { detail: "ffmpeg timeout" }));
      }, timeoutMs);
      child.stderr?.on("data", (chunk) => {
        // ffmpeg is chatty; the duration line is near the top, the tail carries
        // the error if it fails.
        stderr = `${stderr}${String(chunk)}`.slice(-8000);
      });
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(new KiriError("video_needs_converter", { cause: error }));
      });
      child.once("close", (code) => {
        clearTimeout(timer);
        if (code === 0) {
          resolve(stderr);
          return;
        }
        reject(
          new KiriError("video_convert_failed", {
            detail: `ffmpeg keluar dengan kode ${code}: ${stderr.slice(-200)}`,
          }),
        );
      });
    });
  }

  // Returns the path of an MP4 that is safe to send. `outputPath` must differ
  // from `inputPath`: the caller removes the original after this resolves.
  async function toMp4({ inputPath, outputPath }) {
    if (!(await probe()))
      throw new KiriError("video_needs_converter", { detail: "ffmpeg tidak tersedia" });
    const stderr = await run(inputPath, outputPath);
    const durationS = parseFfmpegDuration(stderr);
    if (durationS !== null && durationS > maxDurationS + 1) {
      await rm(outputPath, { force: true }).catch(() => {});
      throw new KiriError("video_too_long", {
        detail: `durasi ${Math.round(durationS)} detik`,
      });
    }
    const size = (await stat(outputPath).catch(() => null))?.size ?? 0;
    if (!size) {
      await rm(outputPath, { force: true }).catch(() => {});
      throw new KiriError("video_convert_failed", { detail: "keluaran kosong" });
    }
    if (size > maxBytes) {
      await rm(outputPath, { force: true }).catch(() => {});
      throw new KiriError("video_too_large", { detail: `${size} byte setelah konversi` });
    }
    log({ event: "transcode_done", bytes: size, durationS: Math.round(durationS ?? 0) });
    return { converted: true, bytes: size, durationS };
  }

  return { probe, toMp4 };
}
