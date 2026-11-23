import { existsSync } from "node:fs";
import { SPLAT_CLI } from "../server/kiri-artifact.mjs";
import {
  defaultEnvFile,
  loadDotEnv,
  readKiriConfig,
} from "../server/kiri-config.mjs";

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
  console.log("Pass --scan to check the KIRI configuration and the SPZ converter.");
} else {
  loadDotEnv(defaultEnvFile());
  const config = readKiriConfig();
  console.log(`KIRI mode       ${config.mode}${config.mode === "mock" ? " · simulation, no network" : ""}`);
  console.log(`KIRI_API_KEY    ${config.apiKey ? "set · value hidden" : "not set"}`);
  console.log(`KIRI API base   ${config.baseUrl}`);
  console.log(`Jobs root       ${config.jobsRoot}`);
  console.log(`Converter       ${existsSync(SPLAT_CLI) ? "splat-transform present" : "missing · run npm ci"}`);
  console.log(`dist            ${existsSync(new URL("dist/index.html", repoRoot)) ? "present" : "missing · run npm run build"}`);
  console.log("The KIRI path runs without COLMAP, Brush, CUDA or FFmpeg.");
  if (config.mode === "unconfigured")
    console.log("Set KIRI_API_KEY in .env for one live test, or KIRI_MOCK=1 for the labelled simulation.");
}
