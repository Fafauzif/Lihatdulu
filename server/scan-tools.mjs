import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ScanError } from "./scan-errors.mjs";

// Pinned tools. The demo laptop keeps them under var/tools; env overrides let
// the worker find them without changing the system PATH.

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const SPLAT_CLI = join(
  repoRoot,
  "node_modules",
  "@playcanvas",
  "splat-transform",
  "bin",
  "cli.mjs",
);

const TOOLS = Object.freeze({
  ffprobe: {
    env: "SCAN_FFPROBE",
    command: "ffprobe",
    hint: "Pasang FFmpeg dan pastikan ffprobe ada di PATH.",
  },
  ffmpeg: {
    env: "SCAN_FFMPEG",
    command: "ffmpeg",
    hint: "Pasang FFmpeg dan pastikan ffmpeg ada di PATH.",
  },
  colmap: {
    env: "SCAN_COLMAP",
    command: "colmap",
    hint: "Ekstrak COLMAP 4.2.1 dan set SCAN_COLMAP ke colmap.exe.",
  },
  brush: {
    env: "SCAN_BRUSH",
    command: "brush_app.exe",
    hint: "Ekstrak Brush 0.3.0 dan set SCAN_BRUSH ke brush_app.exe.",
  },
  splatTransform: {
    env: "SCAN_SPLAT_TRANSFORM",
    command: null,
    hint: "Jalankan npm ci agar @playcanvas/splat-transform tersedia.",
  },
});

export const TOOL_NAMES = Object.freeze(Object.keys(TOOLS));

export function resolveTool(name) {
  const spec = TOOLS[name];
  if (!spec) throw new ScanError("tool_missing", `Alat ${name} tidak dikenal.`);
  const override = process.env[spec.env];
  if (override) return { command: override, prefix: [] };
  if (name === "splatTransform") {
    if (!existsSync(SPLAT_CLI)) throw new ScanError("tool_missing", spec.hint);
    return { command: process.execPath, prefix: [SPLAT_CLI] };
  }
  return { command: spec.command, prefix: [] };
}

export async function runTool(
  name,
  args,
  { cwd, timeoutMs = 30 * 60_000, logPath, signal } = {},
) {
  const tool = resolveTool(name);
  const started = Date.now();
  const output = [];
  const tail = [];
  const text = (chunk) => {
    const value = chunk.toString("utf8");
    output.push(value);
    for (const line of value.split(/\r?\n/))
      if (line.trim()) tail.push(line.trim());
    while (tail.length > 20) tail.shift();
  };

  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = 0;
    const child = spawn(tool.command, [...tool.prefix, ...args], {
      cwd,
      windowsHide: true,
      shell: false,
    });
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      const done = () =>
        error
          ? reject(error)
          : resolve({ ms: Date.now() - started, stdout: output.join("") });
      if (logPath)
        writeFile(logPath, output.join(""), "utf8").then(done, done);
      else done();
    };
    const onAbort = () => {
      child.kill();
      finish(new ScanError("server_stopped", "Pemrosesan dihentikan."));
    };
    timer = setTimeout(() => {
      child.kill();
      finish(
        new ScanError(
          "tool_timeout",
          `Alat ${name} melebihi batas waktu ${Math.round(timeoutMs / 1000)} detik.`,
        ),
      );
    }, timeoutMs);
    signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout?.on("data", text);
    child.stderr?.on("data", text);
    child.once("error", (error) => {
      const missing = error?.code === "ENOENT";
      finish(
        new ScanError(
          missing ? "tool_missing" : "tool_failed",
          missing
            ? `Alat ${name} tidak ditemukan. ${TOOLS[name]?.hint ?? ""}`.trim()
            : `Alat ${name} gagal dijalankan.`,
        ),
      );
    });
    child.once("close", (code) => {
      if (settled) return;
      if (code === 0) {
        finish();
        return;
      }
      finish(
        new ScanError(
          "tool_failed",
          `Alat ${name} gagal (kode ${code}). ${tail.slice(-4).join(" ")}`.trim(),
        ),
      );
    });
  });
}
