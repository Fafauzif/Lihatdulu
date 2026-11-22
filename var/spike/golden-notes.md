# Golden pair — Task 4 evidence (2026-11-22)

Branch `feat/scan-video-study` at `b419d54`. Camera originals only: the five compressed WhatsApp copies were archived to `var/spike/clips-compressed/` before any run, and the 3.33 s false start is excluded in `var/spike/clip-roles.json`. Pipeline: FFmpeg 8.1.2 → COLMAP 4.2.1 (CUDA) → Brush 0.3.0 → splat-transform 3.12.0, 1280 long-edge frames at the 3 fps base (both clips are ≥ 20 s, so no adaptive fps was needed).

| clip | resolution | duration s | extracted | registered | ratio | extract ms | align ms | train ms | convert ms | total ms | splats | artifact bytes | artifact MiB | outcome |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `VID_20261121_184227976.mp4` (golden) | 1920×1080 | 25.35 | 76 | 76 | 1.00 | 2 730 | 128 856 | 158 546 | 1 149 | 291 281 | 27 447 | 544 854 | 0.52 | ready |
| `VID_20261121_184349140.mp4` (repeat) | 1920×1080 | 20.13 | 60 | 60 | 1.00 | 6 244 | 119 804 | 162 142 | 1 528 | 289 718 | 25 181 | 495 405 | 0.47 | ready |

Final jobs: golden `0283ca80-8f9c-4fa4-85a6-f0edb5fc962c`, repeat `a3e551df-7e05-4d0c-8146-d2a686a8d30a`. Artifacts at `var/scans/<id>/output/scan.spz`; stills at `var/scans/<id>/stills/`.

## Acceptance gate (Task 4 Step 3)

- Both clips reach `ready`: **PASS**.
- Golden registered ratio ≥ 0.60: **1.00 → PASS**.
- Repeat ratio within 0.10 of golden: **difference 0.00 → PASS**.
- Total runtime per clip ≤ 10 minutes: **4.85 min / 4.83 min → PASS**.
- Artifact ≤ 60 MB: **0.52 MiB / 0.47 MiB → PASS**.

No threshold was changed. The 60-frame minimum, `minRegistered` 20 / ratio 0.30 job gate, 2.5 M splat cap and 60 MB artifact cap all ran as committed.

## Failures seen before the gate (kept as evidence; both fixed)

1. **`tool_failed` at `aligning`** — COLMAP rejected the database path with `Check failed: database_parent_path.empty() || ExistsDir(database_parent_path)` / `Invalid options provided.` Cause: the new batch harness passed a relative `--root`, while the pipeline runs COLMAP with `cwd=<job>/logs`, so the relative DB path resolved against the wrong directory. The server was unaffected because it resolves its root absolute. Fixed in `897bd8d` with a RED→GREEN regression test. Failed jobs: `c800f454-570c-429f-8dcd-3f6819ec8c05`, `211a5c8d-c9ed-42a9-b34e-10c166fa1cba`.
2. **`alignment_failed` at 2/60** — the repeat clip initially failed because `colmap mapper` emitted two sub-models: `sparse/0` with 2 images / 923 points and `sparse/1` with 60 images / 12 884 points (verified with `model_analyzer` on both). The pipeline assumed `sparse/0`, a carry-over from the single-model South Building smoke. Fixed in `b419d54`: every numeric model folder is analysed and `pickBestModel` uses the most registered images for the gate and the Brush dataset. Failed job: `e91cfbee-70e8-4f78-bc03-33efc98e4d63`.

Run command:

```powershell
$env:SCAN_COLMAP="$PWD\var\tools\colmap\bin\colmap.exe"
$env:SCAN_BRUSH="$PWD\var\tools\brush\brush_app.exe"
node scripts/scan-batch.mjs --only 184227,184349 --out var/spike/results-golden.json
```

Raw rows: `var/spike/results-golden.json`. Visual verdict is still pending Task 7; no screenshot was viewed or attached.
