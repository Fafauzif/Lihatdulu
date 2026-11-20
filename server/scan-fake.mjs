import { copyFile, mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { jobPaths } from "./scan-jobs.mjs";
import { ScanError } from "./scan-errors.mjs";

// Deterministic stand-in for the GPU pipeline. Tests and `--fake` demos use
// it so the API, capture page and viewer can be exercised without a clip,
// COLMAP or Brush.

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function fixturePly() {
  const properties = [
    "x", "y", "z", "nx", "ny", "nz",
    "f_dc_0", "f_dc_1", "f_dc_2",
    ...Array.from({ length: 45 }, (_, index) => `f_rest_${index}`),
    "opacity", "scale_0", "scale_1", "scale_2",
    "rot_0", "rot_1", "rot_2", "rot_3",
  ];
  const header = [
    "ply",
    "format ascii 1.0",
    `element vertex 4096`,
    ...properties.map((name) => `property float ${name}`),
    "end_header",
  ].join("\n");
  const rows = [];
  for (let index = 0; index < 4096; index++) {
    const x = ((index % 16) - 7.5) * 0.035;
    const y = ((Math.floor(index / 16) % 16) - 7.5) * 0.035;
    const z = (Math.floor(index / 256) - 7.5) * 0.035;
    const values = [
      x, y, z, 0, 0, 0,
      0.2 + (index % 3) * 0.1, 0.35, 0.6,
      ...Array.from({ length: 45 }, () => 0),
      5, -3.9, -3.9, -3.9,
      1, 0, 0, 0,
    ];
    rows.push(values.join(" "));
  }
  return `${header}\n${rows.join("\n")}\n`;
}

const STILL_SOURCES = [
  "/images/catalogue/arca-chair.webp",
  "/images/examples/tala.webp",
  "/images/examples/loka.webp",
];

export async function runFakePipeline(record, { root, updateStage }) {
  const paths = jobPaths(root, record.id);
  const step = Number(process.env.SCAN_FAKE_DELAY_MS ?? 20);
  for (const stage of ["validating", "extracting", "aligning"]) {
    await updateStage(stage);
    await pause(step);
  }
  await updateStage("reconstructing");
  await pause(step);
  if (process.env.SCAN_FAKE_FAIL === "1")
    throw new ScanError("alignment_failed", "Uji kegagalan.");
  await updateStage("finalizing");
  await pause(step);

  await mkdir(paths.output, { recursive: true });
  await mkdir(paths.stills, { recursive: true });
  const file = join(paths.output, "scan.ply");
  await writeFile(file, fixturePly(), "utf8");
  const publicRoot = fileURLToPath(new URL("../public", import.meta.url));
  const stills = [];
  for (let index = 0; index < STILL_SOURCES.length; index++) {
    const name = `00${index}.webp`;
    await copyFile(
      join(publicRoot, STILL_SOURCES[index].replace(/^\//, "")),
      join(paths.stills, name),
    );
    stills.push(name);
  }
  const bytes = (await stat(file)).size;
  const media = {
    ...record.media,
    durationS: 12.3,
    width: 1280,
    height: 720,
  };
  const provenance = {
    source: { clipSeconds: 12.3, device: record.meta.device },
    frames: { extracted: 90, registered: 78, ratio: 0.8667 },
    timings: {
      extractMs: 4200,
      alignMs: 61000,
      trainMs: 118000,
      convertMs: 1800,
      totalMs: 185000,
    },
    artifact: { format: "ply", bytes, splatCount: 4096 },
    tools: {
      ffmpeg: "fake",
      colmap: "fake",
      brush: "fake",
      splatTransform: "fake",
    },
  };
  return {
    media,
    provenance,
    artifact: {
      format: "ply",
      bytes,
      splatCount: 4096,
      file: "scan.ply",
      stills,
    },
  };
}
