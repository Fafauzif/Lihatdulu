import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat, statfs } from "node:fs/promises";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));
const lock = JSON.parse(await readFile(join(directory, "../evidence/lock.json"), "utf8"));
const usage = "node overnight-scan/tools/preflight.mjs [--root path] [--clips path] [--evidence path] [--json]";
const values = {};
const argumentsList = process.argv.slice(2);
for (let index = 0; index < argumentsList.length; index++) {
  const arg = argumentsList[index];
  if (arg === "--help") {
    console.log(usage);
    process.exit(0);
  }
  if (arg === "--json") {
    values.json = true;
    continue;
  }
  if (!["--root", "--clips", "--evidence"].includes(arg) || !argumentsList[index + 1] || argumentsList[index + 1].startsWith("--")) {
    console.error(usage);
    process.exit(2);
  }
  values[arg.slice(2)] = argumentsList[++index];
}

const root = resolve(values.root ?? join(directory, "../.."));
const clips = resolve(values.clips ?? join(root, lock.captureDirectory));
const evidence = resolve(values.evidence ?? root);
const windows = process.platform === "win32";

async function present(path) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function git(...args) {
  const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8", windowsHide: true, timeout: 5000 });
  return result.status === 0 ? result.stdout.trim() : null;
}

async function findTool(environmentVariable, basename, defaultPath) {
  const executable = basename + (windows ? ".exe" : "");
  const override = process.env[environmentVariable];
  const locations = [];
  if (override && isAbsolute(override)) {
    locations.push(override);
  }
  if (defaultPath) {
    locations.push(join(root, defaultPath));
  }
  for (const folder of (process.env.PATH ?? "").split(delimiter).filter(Boolean)) {
    locations.push(join(folder, override && !isAbsolute(override) ? override : executable));
  }
  for (const path of locations) {
    if (await present(path)) return path;
  }
  return null;
}

if (!await present(join(root, "package.json")) || git("rev-parse", "--is-inside-work-tree") !== "true") {
  console.error("LihatDulu checkout not found. Extract at the repo root or pass --root.");
  process.exit(2);
}
const takes = await Promise.all(lock.takes.map(async (take) => ({
  name: take.take,
  role: take.role,
  clip: join(clips, take.clip),
  clipExists: await present(join(clips, take.clip)),
  evidence: await Promise.all(take.files.map(async (file) => {
    const location = join(evidence, file.path);
    if (!await present(location)) return { path: file.path, status: "missing" };
    const bytes = (await stat(location)).size;
    const digest = await sha256(location);
    return { path: file.path, status: bytes === file.bytes && digest === file.sha256 ? "match" : "mismatch" };
  })),
})));

const available = await statfs(root, { bigint: true }).then((fileSystem) =>
  Number(fileSystem.bavail * fileSystem.bsize) / (1024 ** 3)).catch(() => null);
const [ffmpeg, ffprobe, colmap, brush] = await Promise.all([
  findTool("SCAN_FFMPEG", "ffmpeg"),
  findTool("SCAN_FFPROBE", "ffprobe"),
  findTool("SCAN_COLMAP", "colmap", "var/tools/colmap/bin/colmap.exe"),
  findTool("SCAN_BRUSH", "brush", "var/tools/brush/brush_app.exe"),
]);
const result = {
  root,
  clips,
  evidence,
  node: process.version,
  branch: git("branch", "--show-current") || "(detached)",
  head: git("rev-parse", "HEAD"),
  originMain: git("rev-parse", "--verify", "origin/main"),
  fetchedEvidence: git("rev-parse", "--verify", "origin/" + lock.evidenceBranch),
  expectedEvidence: lock.evidenceCommit,
  workingTree: git("status", "--short"),
  freeGiB: available === null ? null : Number(available.toFixed(1)),
  toolCandidates: { ffmpeg, ffprobe, colmap, brush },
  takes,
};

if (values.json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log("LihatDulu preflight");
  console.log("Checkout", result.root);
  console.log("Node / branch / HEAD", result.node, result.branch, result.head);
  console.log("Working tree", result.workingTree === "" ? "clean" : result.workingTree);
  console.log("Free GiB", result.freeGiB ?? "unknown");
  console.log("Original clips", result.clips);
  console.log("Evidence", result.evidence, result.fetchedEvidence === result.expectedEvidence ? "(pinned ref fetched)" : "(check pinned commit)");
  for (const [tool, path] of Object.entries(result.toolCandidates)) console.log(tool, path ?? "not found");
  for (const take of result.takes) {
    const counts = take.evidence.reduce((acc, item) => ({ ...acc, [item.status]: (acc[item.status] ?? 0) + 1 }), {});
    console.log(take.name, take.clipExists ? "clip present" : "clip missing", JSON.stringify(counts));
  }
  console.log("Tool candidates are paths. The runbook checks versions and executes capability checks before use.");
}
