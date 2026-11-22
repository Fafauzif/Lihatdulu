# Real Chair Clip Study Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the captured chair takes into a measured reconstruction result, a capture recipe, and the small code/docs changes that follow — or an honest "reshoot" decision.

**Architecture:** A committed inventory script probes and labels the clips; a committed batch harness reuses `runRealPipeline` and writes jobs into `var/scans`; adaptive frame extraction lets short takes reach the 60-frame floor; results are compared before any threshold or copy change.

**Tech Stack:** Node 24, FFmpeg 8.1.2, COLMAP 4.2.1 (CUDA), Brush 0.3.0, `@playcanvas/splat-transform` 3.12.0, Playwright, the existing scan server/pipeline.

**Spec:** [scan workstream](../../handoff/workstreams/scan.md) · [toolchain record](../../handoff/scan-toolchain.md) · [previous plan](2026-11-20-real-furniture-scan.md)

## Shallow pass over the dropped clips (2026-11-22)

Eight camera originals, all the same chair and room:

| # | File | Duration | Size | Resolution | FPS | Bitrate |
|---|---|---|---|---|---|---|
| 1 | `VID_20261121_184212135.mp4` | 10.03 s | 25.5 MB | 1920×1080 | 60 | ~20.4 Mbps |
| 2 | `VID_20261121_184227976.mp4` | 25.35 s | 64.3 MB | 1920×1080 | 60 | ~20.3 Mbps |
| 3 | `VID_20261121_184320272.mp4` | 10.21 s | 25.9 MB | 1920×1080 | 60 | ~20.3 Mbps |
| 4 | `VID_20261121_184333634.mp4` | 3.33 s | 8.8 MB | 1920×1080 | 60 | ~21.2 Mbps |
| 5 | `VID_20261121_184349140.mp4` | 20.13 s | 51.0 MB | 1920×1080 | 60 | ~20.3 Mbps |
| 6 | `VID_20261121_184453628.mp4` | 14.59 s | 37.0 MB | 1920×1080 | 60 | ~20.3 Mbps |
| 7 | `VID_20261121_184626753.mp4` | 15.00 s | 38.0 MB | 1920×1080 | 60 | ~20.3 Mbps |
| 8 | `VID_20261121_184714115.mp4` | 14.62 s | 89.8 MB | 3840×2160 | 29.97 | ~49.1 Mbps |

All are H.264 with a `-90` rotation flag (portrait display 1080×1920, or 2160×3840 for the 4K take), AAC stereo audio and bt709 color; the 4K file reports `smpte170m`/`bt470bg` primaries, so watch for a color shift. The five WhatsApp copies from the previous pass are still in `var/spike/clips/`; they must be archived before any inventory run.

What the takes contain (from the contact sheet, 10/50/90 % frames):

- Same **black mesh office chair** with a chrome five-star base, yellow wardrobe, white tile and checkerboard floor; mixed indoor ceiling/window light, chair dark and low-contrast, wheels sometimes at the frame edge.
- `184227` (25.35 s) is the longest, with the widest orbit. `184349` (20.13 s) is the second-longest and also covers the chair well. These are the natural golden/repeat pair unless the frames say otherwise.
- `184333` (3.33 s) is a **false start** — exclude it. `184212` and `184320` (≈10 s) are shorter extra attempts; `184320` ends pointed at the wardrobe/floor, so its tail is not useful.
- `184453`, `184626` (≈15 s) and `184714` (4K, 14.62 s) are the likely variant takes. The 4K take is the last recorded and also ends with a lot of room in frame.

Implications this plan is built around:

- The originals are proof-capable (1080p/20 Mbps and 4K/49 Mbps); the compressed copies are legacy input only and must not enter the batch.
- At 3 fps the 3.3 s clip gives 9 frames, the 10 s clips 30, the 14.6–15 s clips 43–45, the 20.1 s clip 60 and the 25.3 s clip 76. Adaptive extraction (Task 3) covers everything from ~10 s up; the 3.3 s clip stays below 60 even at 8 fps and must be excluded.
- A dark object in mixed light still needs a side-light instruction (Task 6), now based on real 1080p footage rather than compressed thumbnails.
- All clips carry audio; the extraction step ignores it, so no code change is needed.
- Images are expensive here: the planner/executor must keep screenshots on disk and verify the viewer programmatically. Do not read them into the conversation unless the user explicitly asks for the single per-checkpoint contact sheet.

## Global Constraints

- Work on `feat/scan-video-study` (already created from `main` at `667bdb8`, with this plan committed as `f3ef898`). Do not recreate the branch.
- Clips live in `var/spike/clips/` (git-ignored); never commit clips, frames, runs or screenshots.
- **Originals rule:** the eight `VID_*.mp4` files are the proof set (1080p/20 Mbps, 4K/49 Mbps). The five `WhatsApp Video*.mp4` files are legacy compressed copies; archive them before the inventory and keep them out of every batch.
- The `VID_20261121_184333634.mp4` clip is 3.33 s; it is a false start and must not be run as a usable take.
- Tools: `SCAN_COLMAP=var/tools/colmap/bin/colmap.exe`, `SCAN_BRUSH=var/tools/brush/brush_app.exe`; FFmpeg/ffprobe on PATH; `splat-transform` via the installed devDependency.
- Keep the one-worker/disk-job model, 60-frame minimum, 60 MB / 2.5 M splat cap and 10-minute demo target.
- Do not change catalogue IDs, Sora assets, buyer/seller contracts, or merge/push the branch.
- User-facing copy stays natural Indonesian. `dist/` is restored with `git checkout -- dist` after screenshots.
- Do not lower a threshold just to make a failed clip pass; record the failure instead.
- **Image guardrail (all phases):** the conversation has a hard cap of 20 attached images; exceeding it kills the session. Never attach, paste or read rendered images into the conversation. Save every render, screenshot, contact sheet and still to `var/spike/` and report only the file path plus a text summary. Verify programmatically wherever possible (viewer `data-state`, splat count, PNG byte size, pixel/edge checks in a script). When a human review is genuinely needed, build ONE tiled contact sheet for that checkpoint (e.g. 3×N with captions) and attach only that single image, only when asked. Keep a running count of images attached in the session; before adding one, if the total would reach 15, stop, save everything, summarize, and tell the user to open a new session.
  - This session already has 14 attached images; do not attach anything else here. The new session starts its own count at 0 and follows the same rule.

## Starting point

```powershell
git switch feat/scan-video-study
git status --short --branch
Get-ChildItem var\spike\clips | Select-Object Name,Length
```

Expected: the branch has the plan commit; the tree is clean; the folder contains eight `VID_*.mp4` originals and the five legacy WhatsApp copies; `var/tools/colmap/bin/colmap.exe` and `var/tools/brush/brush_app.exe` still exist.

## Review Focus

1. **The five compressed copies are still in the clip folder and get mixed into the batch.** The inventory must archive them first and flag anything below 720p/2.5 Mbps; Task 5 must not count a compressed file as proof. Pinned in Task 1 (`classifyClip`) and the archive step.
2. **The 3.3 s false start or a 10 s take is rejected by the frame floor.** The false start is excluded by role mapping; the 10 s takes must reach 60 frames through adaptive extraction. Pinned in Task 1's duration warning and Task 3 (`extractionFps`).
3. **One bad clip aborts the whole batch.** The batch harness must record a failed job, continue to the next clip, and write results incrementally. Pinned in Task 2 (`runBatch` failure test).
4. **A missing/wrong tool path fails mid-run with a useless error.** Tool resolution must fail with the install hint before the first clip, and the batch must name the tool. Pinned in Task 2 (`toolDefaults`/`assertTools`).
5. **A batch job cannot be opened as a buyer preview.** The shot script must assert the viewer reaches `data-state="ready"` and the canvas is non-blank, not just that the page loads. Pinned in Task 7.

---

### Task 1: Inventory the clips and assign roles

**Files:**
- Create: `scripts/scan-inventory.mjs`
- Create: `tests/scan-inventory.test.js`
- Output (ignored): `var/spike/clip-inventory.json`, `var/spike/contact-sheet.jpg`, `var/spike/frames/<slug>/`
- Output (ignored, manual): `var/spike/clip-roles.json`

**Interfaces:**
- `classifyClip({ width, height, durationS, bitRate }) -> { quality: "original" | "compressed", warnings: string[] }`
  - `compressed` when `Math.min(width, height) < 720` or `bitRate < 2_500_000`; warning text mentions the low resolution and suggests requesting the original file.
  - A warning is also added when `durationS < 8`: `"Durasi <n> detik; minimal 8 detik."` (the 3.33 s false start must be visible before the batch).
- `frameTimes(durationS, count = 3) -> number[]` — 10 %, 50 % and 90 % of duration, rounded to two decimals.
- CLI: `node scripts/scan-inventory.mjs [--dir var/spike/clips] [--out var/spike]`.

- [ ] **Step 1: Archive the legacy compressed copies**

```powershell
New-Item -ItemType Directory -Force var\spike\clips-compressed | Out-Null
Move-Item "var\spike\clips\WhatsApp Video*.mp4" var\spike\clips-compressed\ -ErrorAction SilentlyContinue
(Get-ChildItem var\spike\clips -Filter *.mp4).Count
```

Expected: `8`; `var/spike/clips/` now contains only the eight `VID_*.mp4` originals.

- [ ] **Step 2: Write the failing tests**

```js
import { classifyClip, frameTimes } from "../scripts/scan-inventory.mjs";

test("a 478x850 WhatsApp copy is compressed", () => {
  const result = classifyClip({ width: 478, height: 850, durationS: 25.35, bitRate: 1_860_550 });
  assert.equal(result.quality, "compressed");
  assert.match(result.warnings.join(" "), /478×850|Original/i);
});
test("a 1080x1920 original is accepted", () => {
  assert.deepEqual(
    classifyClip({ width: 1080, height: 1920, durationS: 25, bitRate: 20_000_000 }),
    { quality: "original", warnings: [] },
  );
});
test("the 3.3 s false start is flagged but stays original quality", () => {
  const result = classifyClip({ width: 1080, height: 1920, durationS: 3.33, bitRate: 20_000_000 });
  assert.equal(result.quality, "original");
  assert.match(result.warnings.join(" "), /minimal 8|terlalu singkat/i);
});
test("frameTimes samples start, middle and end", () => {
  assert.deepEqual(frameTimes(20), [2, 10, 18]);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node tests/scan-inventory.test.js`
Expected: FAIL with `Cannot find module ... scan-inventory.mjs`.

- [ ] **Step 4: Implement the inventory**

Use `node:child_process` `execFile` for `ffprobe`/`ffmpeg`, `node:fs/promises` for files, `node:path` for names. For each `*.mp4|*.mov|*.m4v`:

1. `ffprobe -v error -print_format json -show_streams -show_format <file>`.
2. Record `{ file, sizeBytes, width, height, durationS, fps, codec, bitRate, quality, warnings, frames }`.
3. Extract the three `frameTimes` to `var/spike/frames/<slug>/frame-<n>.jpg` with `ffmpeg -y -v error -ss <t> -i <file> -frames:v 1 -q:v 2 <out>`.
4. Build the sheet: copy the frames to numbered `f%02d.jpg` in a temp folder, then `ffmpeg -y -v error -framerate 1 -i f%02d.jpg -vf "scale=300:-1,tile=3xN:padding=4:margin=4" -frames:v 1 var/spike/contact-sheet.jpg` (the Windows FFmpeg build has no glob support).
5. Write the JSON and print one table row per clip, including each clip's `warnings` (the 3.33 s false start must show its duration warning).

The archive step already left only the eight originals in `var/spike/clips`; the inventory should not see a WhatsApp file.

- [ ] **Step 5: Run tests and the inventory**

Run: `node tests/scan-inventory.test.js` → PASS, 4 tests.
Run: `node scripts/scan-inventory.mjs`
Expected: eight JSON entries, all `quality: "original"`; the 3.33 s file carries the duration warning; the 4K file reports 3840×2160. Write the sheet to `var/spike/contact-sheet.jpg` and **do not read it into the conversation** — use it locally to map roles.

- [ ] **Step 6: Assign roles by content**

Open the local contact sheet **on disk** and write `var/spike/clip-roles.json`. Start from these candidates (duration and recording order), then correct them from the sheet:

```json
{
  "preliminary": false,
  "excluded": ["VID_20261121_184333634.mp4"],
  "golden": "VID_20261121_184227976.mp4",
  "repeat": "VID_20261121_184349140.mp4",
  "variants": [
    "VID_20261121_184212135.mp4",
    "VID_20261121_184320272.mp4",
    "VID_20261121_184453628.mp4",
    "VID_20261121_184626753.mp4",
    "VID_20261121_184714115.mp4"
  ],
  "notes": "Candidates from duration and order; confirm on the local sheet. The 4K file is the last take."
}
```

The 3.33 s file is excluded. Do not attach the contact sheet to the conversation; if a human review is genuinely needed, it is the single per-checkpoint image and the user must ask for it.

- [ ] **Step 7: Commit**

```bash
git add scripts/scan-inventory.mjs tests/scan-inventory.test.js
git commit -m "feat(scan): inventory chair clips and contact sheet"
```

---

### Task 2: Batch reconstruction harness

**Files:**
- Create: `scripts/scan-batch.mjs`
- Create: `tests/scan-batch.test.js`
- Output (ignored): `var/scans/<uuid>/`, `var/spike/results-*.json`

**Interfaces:**
- `listClips(dir) -> Promise<[{ name, path, sizeBytes }]>` for `mp4/mov/m4v`, sorted by name.
- `selectClips(clips, tokens) -> clips[]` — case-insensitive substring match on `name`; empty `tokens` returns all, preserving order.
- `toolDefaults(root) -> { colmap, brush }` — returns the `var/tools` paths only when the files exist, otherwise `""`.
- `summarizeRun({ provenance, artifact }) -> { extracted, registered, ratio, totalMs, splatCount, bytes, format }`.
- `runBatch({ root, clips, meta, pipeline = runRealPipeline, limits, onProgress }) -> Promise<results[]>`; one failed clip is recorded as `{ clip, ok: false, stage: "failed", error: { code, message } }` and the next clip still runs.
- CLI: `node scripts/scan-batch.mjs [--dir var/spike/clips] [--root var/scans] [--out var/spike/results.json] [--only token,token] [--limit n] [--dry-run] [--w 60 --d 60 --h 100]`.

- [ ] **Step 1: Write the failing tests**

```js
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readJob } from "../server/scan-jobs.mjs";
import { ScanError } from "../server/scan-errors.mjs";
import { listClips, runBatch, selectClips, summarizeRun, toolDefaults } from "../scripts/scan-batch.mjs";

test("selectClips matches tokens case-insensitively and keeps order", () => {
  const clips = [{ name: "chair-01-golden.mp4" }, { name: "chair-02-repeat.mov" }, { name: "VID_3.mp4" }];
  assert.deepEqual(
    selectClips(clips, ["REPEAT", "01"]).map((clip) => clip.name),
    ["chair-01-golden.mp4", "chair-02-repeat.mov"],
  );
  assert.equal(selectClips(clips, []).length, 3);
});
test("summarizeRun exposes the comparison numbers", () => {
  const summary = summarizeRun({
    provenance: { frames: { extracted: 76, registered: 61, ratio: 0.8026 }, timings: { totalMs: 300000 } },
    artifact: { splatCount: 120000, bytes: 2_300_000, format: "spz" },
  });
  assert.deepEqual(summary, { extracted: 76, registered: 61, ratio: 0.8026, totalMs: 300000, splatCount: 120000, bytes: 2_300_000, format: "spz" });
});
test("toolDefaults finds pinned binaries only when they exist", async () => {
  const root = await mkdtemp(join(tmpdir(), "scan-tools-"));
  assert.deepEqual(toolDefaults(root), { colmap: "", brush: "" });
  await mkdir(join(root, "var/tools/colmap/bin"), { recursive: true });
  await writeFile(join(root, "var/tools/colmap/bin/colmap.exe"), "x");
  assert.match(toolDefaults(root).colmap, /colmap\.exe$/);
});
test("runBatch records a failed clip and still runs the next one", async () => {
  const root = await mkdtemp(join(tmpdir(), "scan-batch-"));
  const clips = [
    { name: "chair-a.mp4", path: join(root, "chair-a.mp4"), sizeBytes: 1 },
    { name: "chair-b.mp4", path: join(root, "chair-b.mp4"), sizeBytes: 1 },
  ];
  await writeFile(clips[0].path, "x");
  await writeFile(clips[1].path, "x");
  const calls = [];
  const pipeline = async (record) => {
    calls.push(record.meta.title);
    if (record.meta.title === "chair-a") throw new ScanError("alignment_failed", "uji");
    return {
      media: { ...record.media, durationS: 12.3, width: 1280, height: 720 },
      provenance: { frames: { extracted: 60, registered: 50, ratio: 0.8333 }, timings: { totalMs: 1 } },
      artifact: { format: "spz", bytes: 10, splatCount: 60, file: "scan.spz", stills: [] },
    };
  };
  const results = await runBatch({ root, clips, pipeline });
  assert.deepEqual(calls, ["chair-a", "chair-b"]);
  assert.deepEqual(results.map((result) => result.ok), [false, true]);
  assert.equal((await readJob(root, results[0].jobId)).error.code, "alignment_failed");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node tests/scan-batch.test.js`
Expected: FAIL with `Cannot find module ... scan-batch.mjs`.

- [ ] **Step 3: Implement the harness**

- At CLI start call `const tools = toolDefaults(repoRoot)`, set `process.env.SCAN_COLMAP ||= tools.colmap` and `SCAN_BRUSH ||= tools.brush`, then `resolveTool("colmap")` and `resolveTool("brush")` once so a missing tool fails before the first clip with its install hint.
- For each selected clip: `createJob(root, { title: basenameWithoutExt(clip.name), widthCm, depthCm, heightCm, conditionNote: "Uji klip pindai, bukan listing.", device: "clip study", clientId: "" })`; copy the clip to `${jobPaths(root, id).clip}.${extension}`; `updateJob` the media `{ contentType, bytes }`; `pipeline(record, { root, updateStage: async (stage) => onProgress(clip.name, stage) })`; on success `updateJob(..., { stage: "ready", ...result })`; on failure `updateJob(..., { stage: "failed", error })` and continue.
- Write the results JSON after each clip. `--dry-run` prints selected names and exits without creating jobs.
- Print a table line: `clip | extracted | registered | ratio | totalMs | splats | MB | OK/FAILED`.

- [ ] **Step 4: Run tests and the dry run**

Run: `node tests/scan-batch.test.js` → PASS, 4 tests.
Run: `node scripts/scan-batch.mjs --only 6.43 --dry-run`
Expected: the selected filename only, exit 0, no job folders created.

- [ ] **Step 5: Commit**

```bash
git add scripts/scan-batch.mjs tests/scan-batch.test.js
git commit -m "feat(scan): batch chair clips through the real worker"
```

---

### Task 3: Adaptive frame extraction

**Files:**
- Modify: `server/scan-pipeline.mjs` (frame filter and extraction call)
- Test: `tests/scan-pipeline.test.js`

**Interfaces:**
- `BASE_FRAME_FPS = 3`, `MAX_FRAME_FPS = 8`.
- `extractionFps(durationS, { minFrames = MIN_FRAMES, base = BASE_FRAME_FPS, max = MAX_FRAME_FPS } = {}) -> number` = `Math.min(max, Math.max(base, Math.ceil(minFrames / durationS)))`, with duration clamped to ≥ 1 s.
- `frameFilter(fps) -> "fps=<fps>,scale=1280:-2"`; keep `FRAME_FILTER = frameFilter(BASE_FRAME_FPS)` for existing imports.
- `buildExtractArgs({ clip, framesDir, fps = BASE_FRAME_FPS })` uses `frameFilter(fps)`.
- `runRealPipeline` computes `const fps = extractionFps(mediaInfo.durationS)` after the ffprobe check and passes it to `buildExtractArgs`.

- [ ] **Step 1: Write the failing tests**

```js
test("short takes extract at a higher fps to reach the frame floor", () => {
  assert.equal(extractionFps(25.35), 3);
  assert.equal(extractionFps(20.13), 3);
  assert.equal(extractionFps(15.0), 4);
  assert.equal(extractionFps(14.585), 5);
  assert.equal(extractionFps(10.03), 6);
  assert.equal(extractionFps(3.33), 8);
});
test("buildExtractArgs uses the requested fps", () => {
  assert.equal(frameFilter(5), "fps=5,scale=1280:-2");
  assert.deepEqual(
    buildExtractArgs({ clip: "C:\\a\\clip.mp4", framesDir: "C:\\a\\frames", fps: 5 }).slice(5, 7),
    ["-vf", "fps=5,scale=1280:-2"],
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node tests/scan-pipeline.test.js`
Expected: FAIL — `extractionFps`/`frameFilter` are not exported.

- [ ] **Step 3: Implement**

Add the constants and function; replace the fixed filter in `buildExtractArgs`; compute fps in the pipeline. Keep the 60-frame check unchanged: 15 s at 4 fps gives 60 frames, 10.03 s at 6 fps gives 60, and the 3.33 s false start reaches only 26 at the 8 fps cap — excluded by Task 1, not rescued here.

- [ ] **Step 4: Run the suite**

Run: `node tests/scan-pipeline.test.js` → PASS, all tests including the new ones.
Run: `npm run test:unit` → PASS.

- [ ] **Step 5: Commit**

```bash
git add server/scan-pipeline.mjs tests/scan-pipeline.test.js
git commit -m "feat(scan): adapt extraction fps for short clips"
```

---

### Task 4: Run the golden pair

No new code. Use the roles from Task 1.

- [ ] **Step 1: Confirm originals and roles**

Run: `node scripts/scan-inventory.mjs`
Expected: eight entries, all `quality: "original"`; the 3.33 s clip carries the duration warning and is in `clip-roles.json` under `excluded`. If the golden or repeat file is missing or compressed, stop and fix the archive/roles first.

- [ ] **Step 2: Set tools and run the pair**

Use the two files named in `var/spike/clip-roles.json` (`golden` and `repeat`; candidates are the 25.35 s and 20.13 s takes).

```powershell
$env:SCAN_COLMAP="$PWD\var\tools\colmap\bin\colmap.exe"
$env:SCAN_BRUSH="$PWD\var\tools\brush\brush_app.exe"
node scripts/scan-batch.mjs --only <golden-file>,<repeat-file> --out var/spike/results-golden.json
```

Expected: two rows; both jobs reach `ready` with the originals' 1080p source.

- [ ] **Step 3: Apply the acceptance gate**

- Both clips `ready`.
- Golden registered ratio ≥ 0.60.
- Repeat differs from golden by ≤ 0.10 in ratio.
- Total runtime per clip ≤ 10 minutes.
- Artifact ≤ 60 MB.

If any fails: record the exact stage and error in `var/spike/golden-notes.md`; do not lower thresholds. If `footage_short`, confirm Task 3 is in the build and rerun. If `alignment_failed` on originals, stop and ask for a reshoot with side light and slower orbit.

- [ ] **Step 4: Record the numbers**

Write `var/spike/golden-notes.md` with clip, resolution, duration, extracted/registered, ratio, stage timings, splat count, MB. The visual verdict comes from Task 7, before the Task 8 decision. No commit; Task 8 moves the numbers into the repo docs.

---

### Task 5: Run the variants and compare

No new code.

- [ ] **Step 1: Run the remaining clips**

Use the five files in `clip-roles.json` under `variants` (two ~10 s takes, two ~15 s takes and the 4K take):

```powershell
node scripts/scan-batch.mjs --only <variant-1>,<variant-2>,<variant-3>,<variant-4>,<variant-5> --out var/spike/results-variants.json
```

Expected: each clip has a result row, including honest failures. The 3.33 s false start is not run.

- [ ] **Step 2: Write the comparison table**

Create `var/spike/comparison.md` with one row per clip:

```
| clip | resolution | duration | extracted | registered | ratio | extract | align | train | convert | total | splats | MB | outcome |
```

Add the 4K take explicitly so its 1280-downscaled result can be compared with the 1080p takes.

- [ ] **Step 3: Name the top two failure causes**

Under the table write exactly two bullets. Examples: "dim take: 32 % registered — mesh detail lost"; "fast take: 41 % — motion blur". These drive Task 6 copy and Task 8's verdict.

- [ ] **Step 4: Decide**

- Golden and repeat pass, variants fail in explainable ways → proceed.
- Golden fails but variants reveal a fixable cause → write the fix, do not proceed to Task 8 go/no-go yet.
- Golden fails and no variant passes → stop; ask for a reshoot with side light and a slower orbit.

---

### Task 6: Add the dark-object capture guidance

Data-driven from the shallow pass (black mesh chair, indoor light) and Task 5's failure causes.

**Files:**
- Modify: `src/scan-recorder.js`
- Modify: `src/scan-capture.js` (render tips), `src/scan-capture.css`
- Modify: `src/scan-api.js` (`ERROR_COPY.alignment_failed`)
- Test: `tests/scan-recorder.test.js`, `tests/scan-api.test.js`

**Interfaces:**
- `CAPTURE_TIPS = Object.freeze([...])` in `src/scan-recorder.js`; exactly two strings:
  - `"Untuk barang gelap, nyalakan lampu dari samping, bukan dari belakang barang."`
  - `"Hindari jendela terang tepat di belakang barang saat merekam."`
- `GUIDANCE` stays six prompts.
- `ERROR_COPY.alignment_failed` becomes: `"Kamera tidak cukup mengenali barangnya. Untuk barang gelap, nyalakan lampu dari samping dan rekam lebih pelan."`

- [ ] **Step 1: Write the failing tests**

```js
import { CAPTURE_TIPS, GUIDANCE } from "../src/scan-recorder.js";
test("capture tips cover dark furniture and backlight", () => {
  assert.equal(CAPTURE_TIPS.length, 2);
  assert.match(CAPTURE_TIPS[0], /gelap.*samping/i);
  assert.match(CAPTURE_TIPS[1], /jendela.*belakang/i);
  assert.equal(GUIDANCE.length, 6);
});
test("alignment copy names the dark-object fix", () => {
  assert.match(ERROR_COPY.alignment_failed, /gelap.*samping/i);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/scan-recorder.test.js tests/scan-api.test.js`
Expected: FAIL — `CAPTURE_TIPS` missing; old alignment copy has no dark-object advice.

- [ ] **Step 3: Implement**

Add `CAPTURE_TIPS`; render `<ul class="scan-tips">` after the intro in `renderScanCapture`; add `.scan-tips` styles (small, muted, 2 items, no extra box); update the error copy.

- [ ] **Step 4: Run tests and build**

Run: `npm run test:unit` → PASS.
Run: `npm run build` → success.

- [ ] **Step 5: Commit**

```bash
git add src/scan-recorder.js src/scan-capture.js src/scan-capture.css src/scan-api.js tests/scan-recorder.test.js tests/scan-api.test.js
git commit -m "feat(scan): add dark-object capture guidance"
```

---

### Task 7: Preview screenshots and visual verdicts

**Files:**
- Create: `scripts/scan-preview-shot.mjs`
- Output (ignored): `var/spike/preview-<slug>/`, `report.json`, `var/spike/visual-verdicts.md`, optional `var/spike/preview-contact-sheet.jpg`

**Interfaces:**
- CLI: `node scripts/scan-preview-shot.mjs --job <uuid> [--root var/scans] [--out var/spike/preview-<slug>]`.
- Starts `createScanServer({ root, pipeline: async () => new Promise(() => {}), distDir: "dist" })` (serving only; no new job), opens `/pindai/<job>`, waits for `[data-scan-viewer][data-state="ready"]`, reads `data-splats`, asserts the viewer screenshot is > 15 000 bytes, saves 1440 and 390 PNGs, writes `report.json` with `{ job, state, splats, viewerBytes, screenshots }`.
- Exits 1 if the viewer never reaches ready or the splat count is 0.

- [ ] **Step 1: Implement the QA script**

Reuse `testBrowserPath` from `scripts/test-browser.js`. Use Chromium flags `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`. No unit test; it is verified by running it. **Never open the PNGs in the conversation.**

- [ ] **Step 2: Run it on every job in the two result files**

Run: `npm run build`, then for each `jobId` in `var/spike/results-golden.json` and `var/spike/results-variants.json`:

```powershell
node scripts/scan-preview-shot.mjs --job <jobId> --out var/spike/preview-<slug>
```

Expected: `state=ready`, `splats > 0`, canvas screenshot > 15 000 bytes, two PNGs per job. A job that failed reconstruction has no result; record it as `no preview (failed)`. Do not attach the screenshots.

- [ ] **Step 3: Write programmatic visual verdicts**

Create `var/spike/visual-verdicts.md` with one line per job: clip, viewer state, splats, canvas bytes, and one of `recognizable chair`, `fragment only`, `room dominates`, `floating/cropped`. Derive the label from the screenshot's programmatic signal and the earlier reconstruction numbers, not from reading the image into chat. These lines fill Task 8's `visual` column.

If a human review is genuinely required, build **one** tiled contact sheet at `var/spike/preview-contact-sheet.jpg` and leave it on disk; attach it only if the user explicitly asks for that single checkpoint image. Check the session's image count before doing so.

- [ ] **Step 4: Commit**

```bash
git add scripts/scan-preview-shot.mjs
git commit -m "test(scan): add preview screenshot harness"
```

---

### Task 8: Record the evidence and decide

**Files:**
- Modify: `docs/handoff/scan-toolchain.md`
- Modify: `docs/handoff/session-log.md`
- Modify: `docs/handoff/workstreams/scan.md`
- Modify: `docs/handoff/decisions.md` only if a limit or capture decision actually changed

- [ ] **Step 1: Fill the real-clip table**

Under "Known-dataset smoke", add a **Real chair clips** section with one row per run clip: original filename, resolution, duration, extracted, registered, ratio, extract/align/train/convert/total ms, splat count, artifact MB, outcome, and the visual verdict from `var/spike/visual-verdicts.md`. State explicitly that these are camera originals (and that the 4K take is 3840×2160).

- [ ] **Step 2: Write the verdict**

One of:

- **Go:** golden and repeat pass the Task 4 gate; write the recipe (lighting, speed, heights, duration, fps) that should be used for the competition scan.
- **Reshoot:** name the single change (side light, slower orbit, longer clip, higher resolution) and why.
- **Blocked:** tooling or data missing; state exactly what is needed.

- [ ] **Step 3: Update the handoff**

Session-log entry with branch, commits, commands, results, evidence paths and next step. Update the scan workstream's status: mark only what is actually proven (real chair registration, viewer load, timings). Do not mark the physical-phone acceptance as done. Reference screenshot paths as text; do not attach images.

- [ ] **Step 4: Final verification and commit**

```powershell
npm run test:unit
npm run build
git checkout -- dist
git status --short
```

```bash
git add docs/handoff/scan-toolchain.md docs/handoff/session-log.md docs/handoff/workstreams/scan.md docs/handoff/decisions.md
git commit -m "docs(scan): record real chair reconstruction evidence"
```

If any run accidentally used a compressed copy, the commit must say "preliminary", and the plan ends before the go/no-go.
