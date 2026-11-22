# Scan toolchain — historical record (local pipeline retired)

> **Historical.** This page records the FFmpeg → COLMAP → Brush study run on the
> Helios in November 2026. The active scan feature no longer uses those tools,
> CUDA, FFmpeg or a local GPU worker. It now calls KIRI Engine from the server;
> see [kiri-scan.md](kiri-scan.md). Keep this page for provenance and evidence,
> not as setup instructions.


**Date** 20 November 2026 · **Machine** Acer Predator PHN16-71 · Windows 11 Home Single Language · NVIDIA GeForce RTX 4060 Laptop GPU, 8 188 MiB, driver 581.80 · Node 24.19.0.

The pinned tools are extracted under `var/tools/` (git-ignored) so nothing was added to the system PATH:

| Tool | Version | Local path |
|---|---|---|
| FFmpeg / ffprobe | 8.1.2-full_build-www.gyan.dev | already on PATH |
| COLMAP | 4.2.1 (Commit bd1fcf6, CUDA) | `var/tools/colmap/bin/colmap.exe` |
| Brush | `brush-cli 0.3.0` | `var/tools/brush/brush_app.exe` |
| splat-transform | 3.12.0 (5d5be2b) | `node_modules/@playcanvas/splat-transform/bin/cli.mjs` |
| cloudflared | pending | — |

The Brush binary is **`brush_app.exe`**, not `brush.exe`. The worker accepts `SCAN_BRUSH`; set it to the absolute `brush_app.exe` path, or add the folder to PATH.

## Recorded commands

```powershell
# 1. Frames (3 fps, long edge 1280) — filter confirmed on FFmpeg 8.1.2
ffmpeg -hide_banner -loglevel error -i var\spike\chair.mp4 -vf "fps=3,scale=1280:-2" -q:v 2 var\spike\frames\%04d.jpg

# 2. Sparse COLMAP — exact flags confirmed with `colmap <command> -h`
colmap feature_extractor --database_path var\spike\db.db --image_path var\spike\frames --ImageReader.single_camera 1 --ImageReader.camera_model OPENCV
colmap sequential_matcher --database_path var\spike\db.db --SequentialMatching.overlap 10 --SequentialMatching.loop_detection 0
colmap mapper --database_path var\spike\db.db --image_path var\spike\frames --output_path var\spike\sparse

# 2b. Analyse EVERY sub-model the mapper wrote, then use the highest "Registered images:"
Get-ChildItem var\spike\sparse -Directory | ForEach-Object { colmap model_analyzer --path $_.FullName }

# 3. Brush — positional dataset path, then export options from `brush_app.exe --help`
brush_app.exe var\spike --total-steps 3000 --max-splats 2000000 --export-path var\spike --export-name scan.ply --export-every 3000

# 4. Convert to the web artifact
node node_modules\@playcanvas\splat-transform\bin\cli.mjs var\spike\scan.ply --filter-nan var\spike\scan.spz
```

The frame step is adaptive: the worker extracts at a 3 fps base and raises the rate one step at a time (capped at 8 fps) only when the actual frame count misses the unchanged 60-frame floor. Phone clips are variable-frame-rate — a 15.00 s take at 4 fps produced 59 real frames — so the retry exists to keep usable footage without lowering the floor. Successful takes keep the base rate.

COLMAP's mapper can emit several disjoint sub-models (`sparse/0`, `sparse/1`, …). The worker runs `model_analyzer` on every numeric folder and uses the model with the highest `Registered images:` for both the registration ratio and the Brush dataset. Reading only `sparse/0` made the 20.13 s repeat take look like a 2/60 failure, while `sparse/1` actually held 60/60. The ratio counts frames present in the chosen COLMAP model; it is a registration metric, not a visual-quality score.

Brush options that matter (from the recorded help):

- `--total-steps <n>` (default 30000)
- `--max-splats <n>` (upper bound; actual count can be lower)
- `--export-path <dir>` (default cwd)
- `--export-name <name>` (default `export_{iter}.ply`)
- `--export-every <n>` (default 5000) — set it equal to `--total-steps` for one final file
- `[PATH_OR_URL]` is positional; the dataset root must contain `images/` and `sparse/0/`

## Known-dataset smoke (not the real scan)

- The prepared Sora walkthrough clip was run through the worker as a known asset. FFmpeg extraction worked (54 frames at 3 fps), COLMAP ran, and registration failed honestly with 2 of 54 frames — the clip is a cabinet close-up without enough parallax to reconstruct. This confirms the failure path, not a usable scan source.
- COLMAP's real analyzer output on the public South Building model reads `Registered images: 128`; the worker's parser matches that line.
- Brush 0.3.0 trained on the public South Building dataset (128 images) in about four minutes: 28.8 MB PLY, 122 158 Gaussians, 2.2 MB SPZ after `--filter-nan`. The SPZ loaded in the in-site SparkJS viewer with no page errors.
- The South Building is a flat facade, so the default fit sees it edge-on. That is a dataset-specific framing observation; a volumetric furniture scan should not share it.

These prove tool installation and wiring. They did **not** prove the required real chair scan at the time of the smoke; see the next section.

## Real chair clips — 22 November 2026

Camera originals only: the five compressed WhatsApp copies were archived under `var/spike/clips-compressed/` before the inventory and never entered a batch. The eight `VID_*.mp4` originals are the proof set; the 3.33 s `VID_20261121_184333634.mp4` false start was excluded. The 4K take is a genuine 3840×2160 source, but like every take its frames are downscaled to 1280 for COLMAP/Brush.

| clip | resolution | duration s | extracted | registered | ratio | extract ms | align ms | train ms | convert ms | total ms | splats | artifact MiB | outcome | visual |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `VID_20261121_184212135.mp4` | 1920×1080 | 10.03 | 60 | 60 | 1.00 | 1 479 | 166 342 | 164 537 | 515 | 332 873 | 34 342 | 0.68 | ready | recognizable chair |
| `VID_20261121_184227976.mp4` (golden) | 1920×1080 | 25.35 | 76 | 76 | 1.00 | 2 730 | 128 856 | 158 546 | 1 149 | 291 281 | 27 447 | 0.52 | ready | recognizable chair |
| `VID_20261121_184320272.mp4` | 1920×1080 | 10.21 | 60 | 60 | 1.00 | 1 646 | 106 862 | 135 113 | 521 | 244 142 | 25 811 | 0.50 | ready | recognizable chair |
| `VID_20261121_184349140.mp4` (repeat) | 1920×1080 | 20.13 | 60 | 60 | 1.00 | 6 244 | 119 804 | 162 142 | 1 528 | 289 718 | 25 181 | 0.47 | ready | recognizable chair |
| `VID_20261121_184453628.mp4` | 1920×1080 | 14.59 | 72 | 72 | 1.00 | 2 400 | 113 234 | 143 254 | 489 | 259 377 | 27 466 | 0.51 | ready | recognizable chair |
| `VID_20261121_184626753.mp4` | 1920×1080 | 15.00 | 74 | 74 | 1.00 | 3 020 | 130 291 | 135 725 | 503 | 269 539 | 33 284 | 0.62 | ready (5 fps extraction retry) | recognizable chair |
| `VID_20261121_184714115.mp4` | 3840×2160 → 1280 frames | 14.62 | 71 | 71 | 1.00 | 3 874 | 105 922 | 134 968 | 458 | 245 222 | 18 461 | 0.34 | ready | recognizable chair |

The visual column is a programmatic verdict, not a human review: all seven viewer captures reached `data-state="ready"` at 1440 and 390 px with the placeholder hidden and a live WebGL2 canvas, rendered 46–122 KB viewer screenshots, and the pixel metrics were centre-weighted with 1–6 % edge content (no clipping signal). No image was opened in chat; the viewer PNGs live under `var/spike/preview-*/`. `VID_20261121_184626753.mp4` needed the capped extraction retry: the 4 fps pass produced 59 frames, so it re-extracted at 5 fps (74 frames); its `extract ms` is the sum of both passes.

**Verdict: Go for reconstruction from phone camera originals in this lab pipeline.** The in-app phone → laptop → same-site preview path remains the unproven acceptance item. Both golden-pair clips pass the Task 4 gate (registration ratio 1.00 vs the 0.60 requirement, 4.85 / 4.83 minutes per clip vs the 10-minute target, 0.52 / 0.47 MiB vs the 60 MB cap), and all five variants reconstruct as well. The measured capture recipe for the competition scan:

- 1080p phone camera frames are enough — all seven originals were 1080p/60 VFR and the 4K take is downscaled — so do not carry the 4K source. One slow single orbit, preferably **15–25 s**, at two heights with overlapping views and the chair fully in frame. The 25.35 s golden take is the best default; 10 s still reconstructs but renders less of the frame.
- Keep the base 3 fps extraction; the worker raises to 5–8 fps only when a VFR clip misses the 60-frame floor. Expect **4.1–5.6 minutes per clip** end-to-end on the Helios (golden 4.85 min, variants 4.07–5.55 min).
- For this black mesh chair in mixed indoor light, side light remains the recommendation (now surfaced in the capture UI) and a bright window directly behind the object should be avoided.

Two pipeline defects were found and fixed during the study without moving any threshold: the batch harness passed a relative root (COLMAP rejected the database parent path), and the worker assumed `sparse/0` even when the mapper emitted a larger `sparse/1` (the repeat take looked like 2/60 registration while the chosen model held 60/60). Both have RED→GREEN regression tests in `tests/scan-batch.test.js` and `tests/scan-pipeline.test.js`.

Raw evidence lives outside version control: `var/spike/results-golden.json`, `var/spike/results-variants.json`, `var/spike/results-variants-attempt1.json` (the 184626 framing failure), `var/spike/results-variants-184626.json` (its re-run), `var/spike/golden-notes.md`, `var/spike/comparison.md`, `var/spike/visual-verdicts.md`, and the per-job preview folders. The viewer-element PNGs behind the programmatic verdicts are `var/spike/preview-<clip>/viewer-1440.png` and `viewer-390.png`.

## Still pending (needs the physical phone and tunnel)

- A fresh rear-camera clip recorded from the intended phone and delivered automatically to the laptop worker, then opened as the same-site `/pindai/:id` preview with no manual file transfer. Record the measured end-to-end time and the phone viewer load time.
- The HTTPS tunnel proof (Cloudflare Quick Tunnel or equivalent) with the actual venue/fallback network.
- The phone-side failure paths: permission denied, unsupported recorder, bad/incomplete footage, failed upload with retry, one busy worker, retake, reload/re-entry, exit releasing the camera, and unavailable result.
- Demo rehearsal with a charged laptop and one earlier scan of the same object ready to show.

The PLY is not retained after a successful run because the worker deletes `work/`; only the SPZ, stills and logs remain. Keep the source clips private as before.

