# Scan toolchain — recorded on the Helios

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
colmap model_analyzer --path var\spike\sparse\0

# 3. Brush — positional dataset path, then export options from `brush_app.exe --help`
brush_app.exe var\spike --total-steps 3000 --max-splats 2000000 --export-path var\spike --export-name scan.ply --export-every 3000

# 4. Convert to the web artifact
node node_modules\@playcanvas\splat-transform\bin\cli.mjs var\spike\scan.ply --filter-nan var\spike\scan.spz
```

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

These prove tool installation and wiring. They do **not** prove the required real chair scan.

## Still pending (needs a real chair clip)

- One 30–45 s rear-camera clip of the same chair, filmed slowly at two heights.
- Extracted frame count, `model_analyzer` registration line, registered/total ratio.
- Brush wall-clock time, PLY size, splat count, SPZ size.
- Whether the whole clip-to-preview run fits a 10-minute demo window.
- Repeatability check with a second clip.
- Go/no-go verdict.

Until those numbers exist, the worker and UI are exercised only through the fake pipeline. The real pipeline stays labelled as unproven.
