# Morning handoff — continued run 2026-11-22 (deadline 21:32 Asia/Jakarta)

**Result** — best diagnostic result only, not promoted. The opt-in chair profile is integrated and
verified end to end (`SCAN_PROFILE=chair`, commits `5f782ae`…`d001013` on the local branch), and the
Golden take reproduces the best chair observed so far. The visual gate is **not** cleared: of the four
rendered poses on Golden only the front-quarter reads cleanly, and Repeat is partial. The 10.03 s take
fails. Details and the exact failures are below.

**Open first** — from the implementation worktree:

```powershell
cd C:\Users\fauzi\OneDrive\Documents\GitHub\Lihatdulu-overnight-20261122-153241
npm run build
$env:SCAN_ROOT='C:\Users\fauzi\OneDrive\Documents\GitHub\Lihatdulu\var\overnight\20261122-153241\best\open'
$env:SCAN_KEEP='100'
npm run scan:serve
# open http://127.0.0.1:8787/pindai/6bbc9bf5-e44b-4989-99cf-4fd7852634ff
```

That job holds `golden-q2-6000-sph20`: 5 958 splats, 124 705 bytes. Expected: black mesh office chair,
upright, centred on a clean background, orbitable from all four matched poses. It is the artefact that
`--orbit-proof` (4/4) and `--lifecycle-proof` (17/17) were run against in this session, so the viewer
behaviour is measured, not assumed. The equivalent produced by the shipped pipeline code (6 096 splats,
127 554 bytes) is job `031cffdc-71e0-40ab-a43d-7f251611891b` in
`var\overnight\20261122-153241\jobs`; serve that root instead of `best\open` to compare them.

**Why this result** — the raw scans are room-scale: a 20 s take exports the whole room (52 k–68 k splats)
and percentile framing cannot isolate furniture (1–99 percentile fit is still 8.34 of a 16.68 diagonal).
The working method is a sphere around the point where the aligned COLMAP camera optical axes intersect,
with the radius taken from the cloud instead of hard-coded. Measured this session: Golden radius 2.042
(6 096/68 076 splats), Repeat 2.528 (5 015/52 026) offline and **2.514** in a full real pipeline run whose
alignment differed from the offline one — the rule converges on the same radius from an independent
reconstruction. Comparison sheets:
`comparisons/rule-final-matrix.jpg` (control vs frozen rule vs rejected variant),
`comparisons/frozen-config-sheet.jpg` (Golden 6000 / Repeat offline 6000 / Repeat through the pipeline
6000 / Repeat at 3000 steps, every tile labelled with step and splat count),
`comparisons/stress-grade-sheet.jpg` (stress, failure).

## Where the work lives

| Item | Location |
|---|---|
| Original checkout (untouched) | `C:\Users\fauzi\OneDrive\Documents\GitHub\Lihatdulu`, branch `feat/scan-video-study`, HEAD `c4b3192` |
| Implementation worktree and branch | `C:\Users\fauzi\OneDrive\Documents\GitHub\Lihatdulu-overnight-20261122-153241`, `work/scan-quality-overnight-20261122-153241` |
| Baseline and final commit | base `a26d952`; seven commits `6363101` viewer fix, `24c0e04` lifecycle proof, `5f782ae` chair profile, `c51a704` review hardening, `58148a1` docs, `5e28473` clamp tests, `d001013` evidence corrections (HEAD) |
| Run directory and ledger | `C:\Users\fauzi\OneDrive\Documents\GitHub\Lihatdulu\var\overnight\20261122-153241` (`experiments.jsonl`, `analysis/`, `renders/`, `qa/`) |
| Opt-in command and output | `SCAN_PROFILE=chair npm run scan:serve` (or `profile: "chair"`); output `scan.spz` + `provenance.profile` |
| Matched comparison and orbit | `comparisons/rule-final-matrix.jpg`, `comparisons/rule-final-sheet.jpg`, `qa/orbit-proof-final/report.json`, `qa/lifecycle-final/report.json` |
| Benchmark and test reports | `qa/v8-browser-final/report.json` (26/26), `qa/scan-simulated-final/report.json` (15/15), `qa/orbit-proof-final` (4/4), `qa/lifecycle-final` (17/17), `analysis/` for sweeps |

## Results

| Input and role | Compared versions | Visual verdict | Worker time | First usable view | MiB | Evidence |
|---|---|---|---:|---:|---:|---|
| Golden 25.35 s, tuning (76/76 registered) | 6000-step Brush 68 076 splats, hand r=2.0 (5 958) vs frozen rule r=2.042 (6 096) | **partial** — az290 clear: backrest, seat and arms readable; az030 streaked; az120 dark with floor haze; az210 thin frame only | 286 s Brush (alignment preserved, not re-run) | ~2 s to `ready` in the harness after page load | 0.12 | `renders/rule-final`, `comparisons/rule-final-matrix.jpg` |
| Repeat 20.13 s, confirmation (60/60, 0.898 px) | full real pipeline `SCAN_PROFILE=chair`: Brush 6000 = 51 940 splats → r=2.514 → 4 993 | **partial** — front/three-quarter readable with arms and base; rear-quarter smeared | 420 s total (extract 2.8 s, align 99.3 s, train 315.7 s, cleanup 0.4 s, convert 1.8 s) | ~2 s to `ready` after processing | 0.10 | `renders/e2e-chair-6000`, `jobs-e2e/fbdd66b6-…` (record persisted from the run's captured return, see its `RECORD_NOTE.md`) |
| 10.03 s take, stress (60/60, 0.769 px) | full export 70 725 vs cleaned r=2.7 → 1 155 | **fail** — full export is room-scale chaos with yellow wall glow and streaks; cleaned export is a dark smudge, no arms, no base | not re-measured (Brush 6000 already trained offline) | viewer reached `ready`; content unusable | 0.02 | `comparisons/stress-grade-sheet.jpg`, `renders/stress-full`, `renders/stress-rule` |

Golden pixel check against the validated control: mean difference 0.33–0.39/255 with 0.41–0.67 % of pixels
changed across the four poses (the extra 138 splats); the rejected r=2.555 variant differs 2.1–2.8/255 with
10–13 % changed. The frozen rule is therefore the same result as the hand-tuned best, produced by shipped code.

`comparisons/frozen-config-sheet.jpg` carries a fourth row that is not a candidate: Repeat at 3 000 steps
(1 711 splats, `renders/e2e-chair-3000`, job `56f03ae6-…`). It shows why the profile pins `trainSteps: 6000` —
the same sphere and pose set, visibly thinner and more smeared.

## What still fails

1. **A consistent chair from every pose.** Of the four rendered poses only the front-quarter view is
   clean. az030 shows long streaks
   through the arm region, az120 and az210 are underexposed with haze at the base. The streaks are
   view-dependent artefacts: no attribute filter separates them (max longest-axis inside r=2.0 is 1.274,
   below the 16×median cap that would remove 0 splats; only 30 splats are long *and* faint).
2. **Repeat.** Its opaque mass is genuinely softer (r90 2.81 vs Golden 2.27) and the lower half smears even
   at the calibrated radius. Not a radius error; the take has less coherent geometry.
3. **Stress take.** 889 opaque splats within 3.0 of the ray target and the mass median sits 2.3 m away — the
   take never framed the chair. No filtering can recover it; retake guidance is the honest outcome.
4. **Physical phone.** Nothing here has been seen on real hardware (see below).

## Changes and verification

Kept on branch `work/scan-quality-overnight-20261122-153241` (seven commits over `a26d952`, HEAD `d001013`):

- `6363101` viewer placement/orbit/reset/pose-API fix + `scripts/qa-scan-views.mjs` + 9 tests.
- `24c0e04` `--lifecycle-proof` (resize, route re-entry, reload, disposal).
- `5f782ae` `server/scan-cleanup.mjs` (pose maths, PLY/images.bin readers, ray target, sphere filter,
  radius rule, `CHAIR_PROFILE`) + opt-in wiring in `server/scan-pipeline.mjs` + 15 tests. Default path
  unchanged: no filter, no extra provenance key, same Brush and convert args.
- `c51a704` hardening from independent review: CRLF PLY headers, zero quaternions rejected, near-parallel
  axes rejected, non-finite vertices ignored, no 6000-step spend without a usable subject point, guarded
  whole-PLY read, `--jobs-root` no longer overwritten (it silently served the wrong job store) + 5 tests,
  so `tests/scan-cleanup.test.js` now holds 20.
- `58148a1` docs: the chair-profile decision, its evidence and this session in the project logs.
- `5e28473` test: pin the radius clamps with boundary inputs instead of asserting the clamps hold.
- `d001013` docs: record the verification pass that closed the run (the six evidence corrections below).

Commands and actual results in this worktree, dist rebuilt, Node v24.19.0 on Windows, GPU RTX 4060 Laptop:

| Command | Result |
|---|---|
| `npm run test:unit` | **226/226 pass** |
| `npm run test:browser` | **26/26 pass** (`QA_OUTPUT=…/qa/v8-browser-final`) |
| `node scripts/verify-scan.mjs` | **15/15 pass** (`…/qa/scan-simulated-final`) |
| `qa-scan-views.mjs --orbit-proof` | **4/4** — mouse +77.0°, touch +58.8°, both resets exact |
| `qa-scan-views.mjs --lifecycle-proof` | **17/17** — 1024×768, 390×844, 1440×900 keep pose and 5 958 splats; route exit disposes; back + reload ready at the initial pose |
| real `SCAN_PROFILE=chair` run | 4 993 splats, provenance `applied:true`, `trainSteps:6000`, r=2.514 |
| matched-pose renders of the recorded jobs | `renders/e2e-chair-6000` → `state=ready`, `splats=4993`, all four poses applied; `renders/e2e-chair-3000` → `state=ready`, `splats=1711` |

The four suites ran on `c51a704` with a freshly built `dist`; the three later commits change docs and tests
only, and `npm run test:unit` was re-run on `5e28473` (226/226).

Simulated, replay and live checks are distinct: `verify-scan.mjs` drives a simulated pipeline, the viewer
proofs serve a prepared SPZ locally, and the end-to-end run used real ffmpeg/COLMAP/Brush on the Repeat clip.
No physical phone and no phone viewing a result over HTTPS was exercised.

Reproduction: `SCAN_PROFILE=chair` on the same clip is deterministic in radius (repeat of the offline and
pipeline alignments both give ≈2.51–2.53) but not in splat count, because Brush sampling and COLMAP
alignment are not bit-reproducible. The promoted-best SPZ is kept byte-exact in `best/`.

Rejected candidates: ray-centre r=2.555 and median-centred spheres (floor haze, bottom fragments,
10–13 % pixel change); attribute filters (removed no streak splat); 3000-step exports for the profile
(1 711 splats, visibly thinner than 6000) — hence the profile now carries `trainSteps: 6000`.

## Work not finished at the deadline

- Independent review ran twice: over `5f782ae` (its findings became `c51a704`) and over `c51a704` (the
  evidence corrections in this file). No third pass over `5e28473`.
- The Golden take was not re-run through the full pipeline this session (its alignment was preserved from
  earlier work); only Repeat was.
- Physical phone checks: none observed.
- `dist/` is tracked in this repository. The committed build is the stale baseline from `a26d952` and
  predates the scan-route work, so serving it makes `/pindai/<job>` fall back to the *missing* state —
  observed and reproduced during this session. Run `npm run build` before previewing or rendering; `dist`
  is restored to the committed build in the branch before handoff. Session log and decisions are updated in
  this branch.

## First physical phone test

Use the intended phone (rear camera), Chrome on Android or Safari on iPhone, the demo laptop as the server,
and the venue or fallback network. Record, with the actual result:

1. Camera permission prompt: granted, and the page does not request the camera before the tap.
2. Actual camera resolution and aspect the recorder negotiates (the pipeline assumes ≥ 1080 px wide).
3. Upload of a 20 s clip over the venue network, including any retry, and the queue position shown.
4. Real processing on this laptop with `SCAN_PROFILE=chair`: expect ~5–8 min for a 20 s clip; confirm the
   status page stages and that time agrees with the 420 s measured here.
5. First usable view: is the chair immediately recognisable and upright, and is it centred without
   unrelated room fragments?
6. Orbit by touch, then `Atur ulang`; confirm the subject stays recoverable and the pose returns exactly.
7. Reload and re-entry from history: the viewer must return `ready` with the initial pose.
8. One genuine failure path: deny the camera, or upload a clip that fails reconstruction, and confirm the
   Indonesian explanation and retake offer are usable.

Keep the phone-camera recording separate from a local replay in the report; label which evidence came from
which device.
