// Build the saved-chair demo from one finished KIRI job directory.
//
//   node scripts/build-demo-scan.mjs <job-dir> [out-dir]
//
// The result is a static bundle in public/demo/kursi: the refined GLB, KIRI's
// raw GLB, eight of the seller's stills and a job.json in the same shape the API
// returns. /pindai/demo-chair reads it with a plain fetch, so the example opens
// on a static host with no scan server and costs no credit.

import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { toJobDto } from "../server/kiri-jobs.mjs";

const PHOTO_SAMPLES = 8;

const [jobDirArg, outArg] = process.argv.slice(2);
if (!jobDirArg) {
  console.error("usage: node scripts/build-demo-scan.mjs <job-dir> [out-dir]");
  process.exit(1);
}

const jobDir = resolve(jobDirArg);
const outDir = resolve(outArg ?? "public/demo/kursi");
const job = JSON.parse(await readFile(join(jobDir, "job.json"), "utf8"));
if (job.stage !== "ready" || job.artifact?.format !== "glb") {
  console.error(`job ${job.id} is ${job.stage}/${job.artifact?.format}, not a ready GLB`);
  process.exit(1);
}

const dto = toJobDto(job, { mock: false, ttlMs: 0, now: Date.now() });
if (!dto.artifact || dto.artifact.format !== "glb") {
  console.error("job has no mesh artifact");
  process.exit(1);
}

await rm(join(outDir, "photos"), { recursive: true, force: true });
await mkdir(join(outDir, "photos"), { recursive: true });

const refined = dto.artifact.refined && job.refined ? "refined.glb" : "result.glb";
await cp(join(jobDir, refined), join(outDir, "result.glb"));
await cp(join(jobDir, "result.glb"), join(outDir, "raw.glb"));

// Evenly spaced stills across the orbit, not the first eight seconds.
const all = job.photos ?? [];
const picked = [];
const wanted = Math.min(PHOTO_SAMPLES, all.length);
for (let index = 0; index < wanted; index += 1) {
  const at = wanted === 1 ? 0 : Math.round((index * (all.length - 1)) / (wanted - 1));
  picked.push(all[at]);
}
const photos = [];
for (let index = 0; index < picked.length; index += 1) {
  const source = join(jobDir, "photos", picked[index].file);
  const target = join(outDir, "photos", `${index + 1}.jpg`);
  await cp(source, target);
  photos.push({ url: `/demo/kursi/photos/${index + 1}.jpg`, bytes: picked[index].bytes ?? 0 });
}

const result = {
  ...dto,
  id: "demo-chair",
  demo: true,
  stage: "ready",
  completedAt: dto.completedAt,
  artifact: {
    ...dto.artifact,
    url: "/demo/kursi/result.glb",
    raw: { ...dto.artifact.raw, url: "/demo/kursi/raw.glb" },
  },
  photos,
  // A saved example has nothing to retry; the buttons stay hidden client-side.
  error: null,
  now: new Date().toISOString(),
};

await writeFile(join(outDir, "job.json"), `${JSON.stringify(result, null, 2)}\n`);
console.log(
  `demo written from ${basename(jobDir)}: ${result.artifact.format}, ` +
    `${photos.length} photos, ${result.artifact.triangles} triangles`,
);
