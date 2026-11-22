// Real end-to-end run of the opt-in chair profile: create a job in the given
// root, copy a clip into it and run the actual pipeline (ffmpeg, COLMAP,
// Brush, splat-transform). Usage (from the run dir):
//   SCAN_PROFILE=chair SCAN_BRUSH=... SCAN_COLMAP=... \
//     node tools/e2e-chair.mjs <jobs-root> <clip.mp4>
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createJob,
  jobPaths,
} from "file:///C:/Users/fauzi/OneDrive/Documents/GitHub/Lihatdulu-overnight-20261122-153241/server/scan-jobs.mjs";
import { runRealPipeline } from "file:///C:/Users/fauzi/OneDrive/Documents/GitHub/Lihatdulu-overnight-20261122-153241/server/scan-pipeline.mjs";

const root = process.argv[2];
const clipSource = process.argv[3];
const record = await createJob(root, {
  title: "e2e-chair",
  widthCm: 60,
  depthCm: 60,
  heightCm: 110,
  conditionNote: "",
  device: "phone",
});
const paths = jobPaths(root, record.id);
await mkdir(paths.dir, { recursive: true });
await copyFile(clipSource, `${paths.clip}.mp4`);
const stages = [];
const started = Date.now();
const result = await runRealPipeline(record, {
  root,
  updateStage: (stage) => {
    stages.push(stage);
    console.log(`[stage +${Math.round((Date.now() - started) / 1000)}s]`, stage);
  },
  limits: { keepFrames: 100 },
});
const job = JSON.parse(await readFile(paths.job, "utf8"));
console.log("RESULT", JSON.stringify(result, null, 2));
console.log(
  JSON.stringify(
    {
      id: record.id,
      stage: job.stage,
      splatCount: job.artifact?.splatCount,
      bytes: job.artifact?.bytes,
      provenance: job.provenance,
      timings: job.timings,
      stages,
    },
    null,
    2,
  ),
);
