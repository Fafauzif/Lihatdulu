# Overnight run handoff — detailed state (paused 2026-11-22 ~16:25 +07:00)

This file is the durable continuation state. Read it before touching anything in the next session.
`MORNING.md` is the readable summary; this file records exact state, commands and next actions.

## 1. What is done

### A. Viewer fix (committed)
- Worktree: `C:\Users\fauzi\OneDrive\Documents\GitHub\Lihatdulu-overnight-20261122-153241`
- Branch: `work/scan-quality-overnight-20261122-153241`, base `a26d952` (`origin/main`)
- Commit: `6363101` "fix(scan): correct viewer placement and add subject orbit with QA harness"
- Files: `src/scan-viewer.js`, `src/scan-viewer-math.js` (new), `src/scan-viewer.css`,
  `tests/scan-viewer.test.js` (new, 9 tests), `scripts/qa-scan-views.mjs` (new harness),
  `docs/handoff/session-log.md` (run entry).
- Fixes: `position = -R*c` (rotated centre, was unrotated); 1–99 percentile subject fit with fallback;
  own orbit controller (no camera translation); pose survives resize; "Atur ulang" reset; initial pose
  `{azimuthDeg:290, elevationDeg:15, distanceScale:1}`; `host.scanViewer` API
  `{setPose, getPose, reset, fit}`; `data-scan-focus-box/-center/-radius/-root-box`, `data-scan-pose`.
- Verified: `npm run build` pass; `npm run test:unit` 206/206; viewer tests 9/9. Not verified: `.browser`
  suite, `verify-scan.mjs`, orbit-proof full pass.
- `dist/` was restored to the committed baseline after evidence capture (so `git status` is clean; rebuild
  before any preview).
- `var/baseline-src/` and `var/baseline-dist/` in the worktree are temporary, git-ignored baseline copies
  the viewer agent used for the "before" captures. Safe to delete or reuse.

### B. Evidence captured
- `comparisons/viewer-fix/before/` — old viewer default views (Golden/stress at 1440/390) from the audited
  baseline build.
- `comparisons/viewer-fix/after/` — new viewer default views (Golden/stress/Repeat at 1440/390).
- `comparisons/viewer-fix/sweep/` — Golden at azimuth 0…315 step 45 + default; `sweep-sheet.jpg` is the
  contact sheet. `sweep/probe/` has 250/270/290/315 close-ups (initial pose chosen from here).
- `comparisons/viewer-fix/orbit/` — only the "before drag" shots; orbit-proof run was interrupted.
- `comparisons/candidates/` — matched-pose renders (az 290/30/120/210, el 15, dolly 1.0) for
  `noop`, `c1-scale2`…`c6-scale1-op005`, `q0-3000`, `q0-sph15/20/25`, `q2-6000`, `q2-sph20`, `q2-sph25`
  (junk, 1 splat), `q2-sph30`.
- Contact sheets: `comparisons/candidate-matrix.jpg` (8 candidates × 4 views),
  `comparisons/chair-candidates-sheet.jpg` (4 sphere-cleaned variants × 4 views),
  `comparisons/before-after-sheet.jpg` (old vs new default views), `comparisons/viewer-fix/sweep-sheet.jpg`.

### C. Diagnostics (complete)
`analysis/DIAGNOSTICS.md`, `SPZ_STATS.md`, `COVERAGE.md`, `fixtures.md`, `spz-stats.json`, `csv/`, `stats/`.
Highlights:
- 7/7 fixtures valid; SPZ v4, SH3, 0 NaN; `--filter-nan` is a no-op.
- CSV `scale_0..2` are ln-scale; `opacity` is logit; `--filter-value` compares **linear** values.
- Transform defect quantified per take: 1.64–1.95× robust radius on 6/7 (Golden mild, 0.53R).
- Cleanup yield for a p99 scale cap: removes 0.9–1.0% of splats but 10–14% of long-axis mass; opacity floor
  0.02 removes 1.0–1.4%. Long splats are **not far** — distance-only filters will not clean haze.
- Coverage: Golden 76/76 registered, 0.96 px reprojection, 8/12 azimuth bins, ~225° arc, chair rear
  (0–90° sector) never imaged. Clutter ranking (worst→best): stress-10.03, sweep-10.21, …, 4K, Golden.
- **Caveat found by diag:** `splat-transform --filter-sphere` maps its centre through an internal transform
  and is unreliable (removed 353 when 1 predicted). Use `tools/filter_splat_ply.py` instead; it filters the
  Brush PLY directly and was used for the winning assets.

### D. Reconstruction experiments (GPU, single lease)
- `datasets/golden-25.35/`: Golden frames copied from the retained worker frames (76 images), COLMAP
  feature/match/mapper run and **preserved** (`aligned/images` + `aligned/sparse/0`), plus `db.db`,
  `sparse/` and logs. Alignment: feature 6 296 ms + match 45 073 ms + mapper 119 365 ms ≈ 170.7 s,
  76/76 registered, model 0.
- `train/golden-3000/scan.ply`: Brush 3000 steps, 155 906 ms, 27 406 splats, PLY 6.47 MB.
- `train/golden-6000/scan.ply`: Brush 6000 steps, 285 918 ms, 68 076 splats, PLY 16.07 MB.
- Converted artifacts: `candidates/golden-q0-3000.spz` (545 503 B), `golden-q2-6000.spz` (1 499 291 B).
- Frame extraction was **reused** from the worker's retained frames (no ffmpeg re-run in this benchmark).
- The GPU was free after this; no Brush/COLMAP was running when the run was paused.

### E. Winning result so far
- Subject centre from the aligned COLMAP optical axes (least-squares ray intersection):
  `(3.412, 2.309, 2.149)` in the Golden reconstruction frame. Radius 2.0 chosen from the render matrix.
- Best: `candidates/golden-q2-6000-sph20.spz` (5 958 splats, 124 705 B) → job fixture
  `6bbc9bf5-e44b-4989-99cf-4fd7852634ff` (also copied to `best/open/<id>/`).
- First verdict from that contact sheet: upright, recognizable black mesh office chair, far better than any
  raw SPZ (room scenes with haze). The stricter matched-pose renders in the continuation session soften
  this: only the front quarter (az290) reads cleanly — backrest, seat and arms — while az030 streaks through
  the arm region and az120/az210 are dark with haze at the base. Wheel-base detail is not reliably visible.

## 2. Exact commands used (repeat/validation)

```powershell
# Worktree setup (already done)
cd C:\Users\fauzi\OneDrive\Documents\GitHub\Lihatdulu-overnight-20261122-153241
npm ci
npm run build

# Matched-pose render of one candidate job (run-local scan root; never primary var/scans)
node scripts/qa-scan-views.mjs --job <job-id> --jobs-root C:\Users\fauzi\OneDrive\Documents\GitHub\Lihatdulu\var\overnight\20261122-153241\jobs --dist dist --out <out-dir> --poses 290,30,120,210

# Brush training from the preserved aligned dataset
cd C:\Users\fauzi\OneDrive\Documents\GitHub\Lihatdulu\var\overnight\20261122-153241\datasets\golden-25.35\aligned
C:\Users\fauzi\OneDrive\Documents\GitHub\Lihatdulu\var\tools\brush\brush_app.exe <aligned> --total-steps 6000 --max-splats 2000000 --export-path <out> --export-name scan.ply --export-every 6000

# Subject cleanup + conversion (CPU) — use this, not --filter-sphere
python C:\Users\fauzi\OneDrive\Documents\GitHub\Lihatdulu\var\overnight\20261122-153241\tools\filter_splat_ply.py <scan.ply> <clean.ply> --sphere 3.412,2.309,2.149,2.0 --json-out <log.json>
node C:\Users\fauzi\OneDrive\Documents\GitHub\Lihatdulu-overnight-20261122-153241\node_modules\@playcanvas\splat-transform\bin\cli.mjs <clean.ply> --filter-nan <out.spz>

# Serve the best fixture locally (build first)
cd C:\Users\fauzi\OneDrive\Documents\GitHub\Lihatdulu-overnight-20261122-153241
npm run build
$env:SCAN_ROOT='C:\Users\fauzi\OneDrive\Documents\GitHub\Lihatdulu\var\overnight\20261122-153241\best\open'; $env:SCAN_KEEP='5'; npm run scan:serve
```

Helper scripts in the run dir (all local, versioned only by this handoff): `tools/spz-csv-stats.py`,
`tools/colmap-cameras.py`, `tools/colmap-images-bin.py`, `tools/filter_splat_ply.py`,
`tools/montage.py`, `tools/prepare-candidate-jobs.mjs`, `tools/log-experiment.mjs`.
Fixture mapping: `analysis/candidate-jobs.json` (name → job id) and `analysis/candidate-jobs-q2sph.json`.

## 3. Next actions from the paused session (all carried out — see the continuation section below)

1. **Verify the viewer fix end-to-end** (fresh session): `npm run build`, run
   `node scripts/qa-scan-views.mjs --job 6bbc9bf5-… --orbit-proof` (retry serially; it was interrupted), plus
   the 390×844 touch case, a route re-entry (navigate away and back), and a resize. Then run
   `npm run test:browser` and `node scripts/verify-scan.mjs` in the worktree and record results.
2. **Tune the cleanup on Golden** (CPU only): sweep sphere radius 1.8–2.6 on the existing
   `train/golden-6000/scan.ply` (and optionally the 3000 PLY), render the same four poses, compare against
   the source stills and `comparisons/reference/ref-golden*.jpg`; check thin arms/backrest/wheel base.
   Optionally add a small opacity floor (0.02–0.05) or scale cap after the sphere.
3. **Repeat confirmation** (GPU, ~8 min): copy frames from `var/scans/a3e551df-…/frames`, align with COLMAP
   (~2.5 min), compute its own ray target, Brush 6000 (~5 min), sphere-clean, render, grade against
   `ref-repeat.jpg`. Freeze the config only if Golden+Repeat both pass.
4. **Stress verdict** (GPU, ~9 min): same for `f4755525-…` (10.03 s); grade independently; a fail there is
   acceptable if explicitly labelled.
5. **Integrate the opt-in profile**: add a `SCAN_PROFILE=chair` (or `--profile chair`) path to
   `server/scan-pipeline.mjs` that, after alignment, computes the camera-axis subject centre, filters the
   Brush PLY with the sphere (and optional safe caps), then converts to SPZ; record the profile in
   provenance. Keep the current default profile untouched and add unit tests. Do NOT change existing job
   schema keys; an extra provenance field is allowed (`provenance` is a free object).
6. **Optional viewer preset**: keep the corrected viewer as the default (defect fix); if a preset toggle is
   still wanted, expose the initial pose/cleanup as an explicit query param, never replacing the default.
7. **Regressions + report**: unit/browser/verify-scan/marketplace, matched before/after and orbit evidence,
   then a final `MORNING.md` per `overnight-scan/MORNING_TEMPLATE.md`.
8. **Physical phone checklist** stays pending (see `MORNING.md`).

## 4. Constraints and gotchas

- Original checkout `C:\Users\fauzi\OneDrive\Documents\GitHub\Lihatdulu` is untouched (HEAD `c4b3192`,
  `feat/scan-video-study`, only `overnight-scan/` untracked). Do not run builds/servers there; use the
  worktree.
- Never point a benchmark server at the primary `var/scans` (the server prunes completed jobs at startup).
  Use `var/overnight/20261122-153241/jobs` (19 jobs) or `best/open` (1 job) and `SCAN_KEEP` high enough.
  The harness already passes `keep: 100`.
- One GPU lease: do not run Brush/COLMAP/WebGPU filters concurrently with each other or with many
  SwiftShader browser instances. The earlier batch render failure was Chromium contention between agents;
  serial runs work.
- Do not rebuild/copy `dist` into a commit: build artifacts churn tracked `dist/`; keep source commits only
  (the repo already has a stale tracked `dist/`).
- `--filter-sphere` in splat-transform is unreliable for these files (internal transform); use the PLY
  filter script. `--filter-value` scale/opacity thresholds are linear (CSV columns are ln/logit).
- Evidence and run data are local under `var/overnight/20261122-153241/` (git-ignored) and the branch is local.

---

# Continuation session — 2026-11-22 16:40–19:40 (+07:00), closed as best diagnostic result

Read this section first; the paused-state sections above describe the earlier 53-minute session and are
still accurate for the viewer fix and the Golden/Repeat evidence.

## 1. What changed in the continuation

| Commit | What it does |
|---|---|
| `5f782ae` | `server/scan-cleanup.mjs`: pose maths, PLY + images.bin readers, camera-axis target, sphere filter, radius rule, `CHAIR_PROFILE`. `server/scan-pipeline.mjs`: opt-in wiring, `provenance.profile`, `timings.cleanupMs`. 15 tests. |
| `c51a704` | Hardening from an independent review: CRLF PLY headers, zero quaternions rejected, near-parallel axes rejected, non-finite vertices ignored, no 6000-step spend without a usable subject point, guarded whole-PLY read, `--jobs-root` no longer overwritten in the QA harness. 5 more tests, so `tests/scan-cleanup.test.js` holds 20. |
| `58148a1` | Docs: the chair-profile decision, its evidence and this session in the project logs. |
| `5e28473` | Test: pin the radius clamps with boundary inputs instead of asserting they hold. |
| `d001013` | Docs: record the verification pass that closed the run (commit list, `dist` behaviour, test counts, Repeat 6000 evidence path, withdrawn wheel-base claim, view wording). |

Branch `work/scan-quality-overnight-20261122-153241`, HEAD `d001013` (seven commits), base `a26d952`. Nothing pushed;
original checkout untouched (`feat/scan-video-study`, `c4b3192`, only `overnight-scan/` untracked).

## 2. Frozen configuration (measured, not guessed)

```
centre = least-squares intersection of the aligned COLMAP camera optical axes
radius = clamp(0.9 * r90(opaque mass, measured about that mass's own median), 1.8, 2.7)
trainSteps = 6000        # the 3000-step default export is too thin once the room is removed
```

| Take | radius | kept / before | notes |
|---|---:|---|---|
| Golden 25.35 s | 2.042 | 6 096 / 68 076 | reproduces the hand-tuned r=2.0 best (0.33–0.39/255 mean pixel difference) |
| Repeat 20.13 s (offline) | 2.528 | 5 015 / 52 026 | |
| Repeat 20.13 s (real pipeline) | 2.514 | 4 993 / 51 940 | independent alignment, same radius → rule is robust |
| Stress 10.03 s | 2.700 (clamp) | 1 155 / 70 725 | fails the visual gate; take never framed the chair |

## 3. Verification actually run (this session, rebuilt dist)

- `npm run build` pass.
- `npm run test:unit` **226/226**.
- `npm run test:browser` **26/26** (`QA_OUTPUT=…/qa/v8-browser-final`).
- `node scripts/verify-scan.mjs` **15/15** (`…/qa/scan-simulated-final`).
- `qa-scan-views.mjs --orbit-proof` **4/4** (`qa/orbit-proof-final`): mouse +77.0°, touch +58.8°, resets exact.
- `qa-scan-views.mjs --lifecycle-proof` **17/17** (`qa/lifecycle-final`): three viewports keep pose and
  5 958 splats; route exit disposes; history back + reload return `ready` at az290/el15/d1.0.
- Real `SCAN_PROFILE=chair` run on the Repeat clip: 4 993 splats, `provenance.profile.applied:true`,
  `trainSteps:6000`, r=2.514, total 419 908 ms (extract 2 767, align 99 271, train 315 668, cleanup 400,
  convert 1 802).
- Matched-pose renders re-run from the recorded jobs against a freshly built `dist`:
  `renders/e2e-chair-6000` → `state=ready`, `splats=4993`, all four poses applied;
  `renders/e2e-chair-3000` → `state=ready`, `splats=1711`. A stale tracked `dist` makes the same command
  report `state=missing`, which is how the dist/route dependency was found.

## 4. Where the evidence is

- `comparisons/rule-final-sheet.jpg`, `comparisons/rule-final-matrix.jpg` — control vs frozen rule vs rejected
  variant, with the pixel-difference numbers.
- `comparisons/frozen-config-sheet.jpg` — Golden 6000, Repeat offline 6000, Repeat through the pipeline 6000
  and Repeat at 3000 steps; every tile labelled with step and splat count.
- `comparisons/stress-grade-sheet.jpg` — the failing stress take, full vs cleaned.
- `renders/{rule-final,repeat-rule,e2e-chair-6000,e2e-chair-3000,stress-full,stress-rule}` — four matched poses
  each. `e2e-chair-6000` was re-rendered from the recorded job and reports `splats=4993`; `e2e-chair-3000`
  reports `splats=1711` (that job is `56f03ae6-…`, kept as the step-count control, not as Repeat evidence).
- `jobs-e2e/fbdd66b6-2958-4bdf-98ff-ae11f3fcc3f9` — the real pipeline job (frames, logs, output). Its
  `RECORD_NOTE.md` records that the record was persisted from the run's captured pipeline return after the
  fact; the SPZ header (`numPoints=4993`), `convert.log` and `colmap-analyze-0.log` (60/60 at 0.898 px)
  corroborate it.
- `analysis/{rule-final-job,repeat-rule-job,stress-jobs,sweep-jobs,rule-jobs}.json` — job id maps.
- `qa/{v8-browser-final,scan-simulated-final,orbit-proof-final,lifecycle-final}` — reports.

## 5. Open work, in priority order

1. **Streaks on az030** survive every attribute filter tried (longest-axis inside r=2.0 maxes at 1.274,
   below the 16×median cap; only 30 splats are long *and* faint). This is the next real investigation, and
   it needs a second take's evidence, not another radius sweep.
2. **Repeat** smears in the lower half; its opaque mass is softer (r90 2.81 vs Golden 2.27). A longer, slower
   orbit is the likely fix at capture time.
3. **Second review pass**: one ran over `c51a704` and its evidence findings are corrected here; there is no
   third pass over `5e28473`.
4. **Golden through the full pipeline** was not re-run this session; only Repeat was.
5. **Physical phone** checks: none observed (see MORNING.md for the checklist).
6. `dist/` is tracked in this repository. The committed build is the stale baseline from `a26d952` and
   predates the scan-route work: serving it makes `/pindai/<job>` render the *missing* state (reproduced this
   session). Run `npm run build` before previewing; the worktree is restored to the committed `dist` at handoff.

## 6. Re-entry commands

```powershell
cd C:\Users\fauzi\OneDrive\Documents\GitHub\Lihatdulu-overnight-20261122-153241
git log --oneline -7          # expect d001013 at HEAD
npm run build
npm run test:unit
node --test tests/scan-cleanup.test.js
$env:SCAN_ROOT='C:\Users\fauzi\OneDrive\Documents\GitHub\Lihatdulu\var\overnight\20261122-153241\best\open'
$env:SCAN_KEEP='100'
npm run scan:serve            # open /pindai/6bbc9bf5-e44b-4989-99cf-4fd7852634ff
```

To reproduce the profile end to end on the retained Repeat clip:

```powershell
$env:SCAN_PROFILE='chair'
$env:SCAN_BRUSH='C:\Users\fauzi\OneDrive\Documents\GitHub\Lihatdulu\var\tools\brush\brush_app.exe'
$env:SCAN_COLMAP='C:\Users\fauzi\OneDrive\Documents\GitHub\Lihatdulu\var\tools\colmap\bin\colmap.exe'
node tools/e2e-chair.mjs <jobs-root> <clip.mp4>     # from the run dir
```

Never serve the primary `var\scans`; use the run-local `jobs/`, `jobs-e2e/` or `best/open` roots.
