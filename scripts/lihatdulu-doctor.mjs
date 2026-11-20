import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const repoRoot = new URL("../", import.meta.url);
const scan = process.argv.includes("--scan");
if (process.argv.slice(2).some((arg) => arg !== "--scan")) {
  console.error("Usage: node scripts/lihatdulu-doctor.mjs [--scan]");
  process.exit(2);
}

const [major, minor] = process.versions.node.split(".").map(Number);
const supported = (major === 20 && minor >= 19) || (major === 22 && minor >= 12) || major > 22;
console.log(`Node ${process.versions.node} · ${process.platform} ${process.arch}`);
if (!supported) {
  console.log("Use Node 20.19+ on the 20.x line or Node 22.12+.");
  process.exitCode = 1;
}

console.log(existsSync(new URL("node_modules/vite/package.json", repoRoot))
  ? "Vite dependencies are present."
  : "Vite dependencies are missing. Run npm ci from the repo root.");
if (!scan) {
  console.log("Pass --scan to inventory the laptop's reconstruction tools.");
} else {
  for (const [command, args] of [
    ["ffmpeg", ["-version"]],
    ["ffprobe", ["-version"]],
    ["colmap", ["-h"]],
    ["brush", ["--help"]],
    ["nvidia-smi", ["--query-gpu=name,memory.total,driver_version", "--format=csv,noheader"]],
    ["cloudflared", ["--version"]],
  ]) {
    const result = spawnSync(command, args, { encoding: "utf8", timeout: 5000, windowsHide: true });
    const firstLine = (result.stdout || result.stderr || "").trim().split(/\r?\n/, 1)[0];
    const status = result.error?.code ?? (result.status === 0 ? "OK" : `exit ${result.status}`);
    console.log(`${command.padEnd(12)} ${status}${firstLine ? ` · ${firstLine}` : ""}`);
  }
  console.log("Inventory only. A tool absent from PATH may have a desktop launcher or absolute executable path.");
}
