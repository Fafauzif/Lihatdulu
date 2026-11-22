// Create ready job fixtures for candidate SPZ files so the scan server can
// serve them at /pindai/<id>. Usage (from the run dir):
//   node tools/prepare-candidate-jobs.mjs --jobs-root <dir> --base-job <id>
//     --cli <splat-transform cli> --still-source <job dir> <name>=<spz> ...
// Prints a JSON map { name: { id, spz, splats, bytes } }.
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
function value(name) {
  const index = args.indexOf(name);
  if (index < 0) throw new Error(`missing ${name}`);
  return args[index + 1];
}
const jobsRoot = resolve(value("--jobs-root"));
const baseJob = value("--base-job");
const cli = resolve(value("--cli"));
const stillSource = resolve(value("--still-source"));
const specs = [];
for (let index = 0; index < args.length; index += 1) {
  const argument = args[index];
  if (argument === "--jobs-root" || argument === "--base-job" || argument === "--cli" || argument === "--still-source") {
    index += 1;
    continue;
  }
  const [name, spz] = argument.split("=");
  if (name && spz) specs.push({ name, spz: resolve(spz) });
}
if (!specs.length) throw new Error("no <name>=<spz> specs");

const baseRecord = JSON.parse(await readFile(join(jobsRoot, baseJob, "job.json"), "utf8"));
const stills = await readdir(join(stillSource, "stills"));
const map = {};
for (const spec of specs) {
  const id = randomUUID();
  const dir = join(jobsRoot, id);
  await mkdir(join(dir, "output"), { recursive: true });
  await mkdir(join(dir, "stills"), { recursive: true });
  for (const still of stills.filter((name) => /\.(jpg|jpeg|png|webp)$/i.test(name))) {
    await copyFile(join(stillSource, "stills", still), join(dir, "stills", still));
  }
  const spzBytes = (await stat(spec.spz)).size;
  await copyFile(spec.spz, join(dir, "output", "scan.spz"));
  const info = spawnSync(process.execPath, [cli, spec.spz, "--info", "json", "null"], {
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  const text = (info.stdout ?? "").trim();
  const start = text.indexOf("{");
  let splats = 0;
  if (start >= 0) {
    try {
      splats = Number(JSON.parse(text.slice(start)).numGaussians) || 0;
    } catch {
      splats = 0;
    }
  }
  if (!splats) throw new Error(`could not read splat count for ${spec.name}: ${text.slice(0, 300)}`);
  const record = {
    ...baseRecord,
    id,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    stage: "ready",
    meta: { ...baseRecord.meta, title: spec.name },
    artifact: {
      format: "spz",
      bytes: spzBytes,
      splatCount: splats,
      file: "scan.spz",
      stills,
    },
  };
  await writeFile(join(dir, "job.json"), `${JSON.stringify(record, null, 2)}\n`, "utf8");
  map[spec.name] = { id, spz: spec.spz, splats, bytes: spzBytes };
}
console.log(JSON.stringify(map, null, 2));
