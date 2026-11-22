# DIAGNOSTICS - LihatDulu overnight 3D-scan quality run `20261122-153241`

Author: diag subagent. Scope: the seven pinned fixture SPZs under `jobs/`, the Golden COLMAP
alignment under `datasets/golden-25.35/`, and the reference sheets under `comparisons/reference/`.
No GPU/CUDA action was used: only `--filter-nan`, CSV output and `--stats json` from
splat-transform v3.12.0, plus Python/numpy/pandas/Pillow. Nothing was written outside
`analysis/`, `comparisons/reference/` and `qa/diag/`; no fixtures were modified or deleted.

Companion files:
- `analysis/fixtures.md` - fixture verification table (7/7 PASS).
- `analysis/SPZ_STATS.md` - full percentile tables per take.
- `analysis/spz-stats.json` - machine-readable statistics (all numbers below).
- `analysis/stats/<take>.json` - the converter's own `--stats json` per take.
- `analysis/csv/<take>.csv` - raw per-splat CSV export per take (log scales, logit opacity).
- `analysis/COVERAGE.md` + `analysis/coverage-golden-diag.json` - camera coverage.
- `analysis/filter-semantics.json` - CLI filter semantics verification.

---

## 1. Headline results

1. **Fixtures are intact: 7/7 pass.** Every `job.json` parses, `artifact.bytes` equals the on-disk
   `output/scan.spz` size, `artifact.splatCount` equals the SPZ v4 header `numPoints` **and** the CSV
   row count, and all three stills exist with the declared names. `--filter-nan` removes **0**
   splats in every take (no NaN/Inf values anywhere): NaN filtering is not a cleanup lever here.
2. **Encoding is confirmed:** `scale_0..scale_2` in the CSV are **natural-log** scales (exp() matches
   the stats tool); `opacity` is a **logit** (sigmoid() matches the stats tool, and the SPZ alpha is
   8-bit linear, so `sigmoid(op)*255` lands on integers to ~1e-6). All thresholds below are stated in
   **linear** units; `--filter-value` also compares linear values (verified, see §4).
3. **The scene is room-scale, not chair-only.** The 1-99 percentile box of the splat cloud is
   14.5-32.2 units across (radius 7.2-16.1); the chair is a small part of each scan (the stills show a
   bedroom with wardrobe/bed/floor). World units are arbitrary reconstruction units - never compare
   absolute caps between takes without normalising by that take's own median/percentiles.
4. **Clutter ranking (most -> least):** `stress-10.03` and `sweep-10.21` are worst; `sweep-4k-14.62`
   and `golden` are cleanest. Details in §3.
5. **The transform defect is large for six of seven takes.** With the viewer's current
   `position = -center` (instead of `-R*center`) and `q=(x=1,y=0,z=0,w=0)` => R=diag(1,-1,-1), the
   object's world centre is displaced by **1.64-1.95 x its own robust radius** (82-98% of the robust
   box diagonal) on all takes except Golden (0.53R / 26.6%). Table in §5.
6. **Camera coverage of Golden is a broad front arc, not an orbit:** 76/76 frames registered
   (0.957 px reprojection error), 8/12 azimuth bins occupied, ~225 deg unwrapped azimuth span, mean
   optical-axis elevation +24.7 deg. The chair's back (azimuth bins 0-90 deg) was never observed.
   Full detail in `analysis/COVERAGE.md`.

---

## 2. Fixture verification (summary; table in `analysis/fixtures.md`)

| take | job id | spz bytes | splats | stills | frames ext/reg | PASS |
|---|---|---|---|---|---|---|
| Golden 25.35 s | `0283ca80` | 544,854 | 27,447 | 3 | 76 / 76 | yes |
| Repeat 20.13 s | `a3e551df` | 495,405 | 25,181 | 3 | 60 / 60 | yes |
| 10.03 s stress | `f4755525` | 708,640 | 34,342 | 3 | 60 / 60 | yes |
| 10.21 s sweep | `15d33c98` | 523,603 | 25,811 | 3 | 60 / 60 | yes |
| 14.59 s sweep | `bb588361` | 538,833 | 27,466 | 3 | 72 / 72 | yes |
| 15.00 s sweep | `e8d4c2a3` | 651,694 | 33,284 | 3 | 74 / 74 | yes |
| 4K 14.62 s sweep | `37a5694c` | 353,915 | 18,461 | 3 | 71 / 71 | yes |

All seven SPZs are SPZ **v4**, SH degree 3, `fractionalBits=12`, flags 0, 19.17-20.63 bytes/splat.
The known `job.json` lock-byte mismatch (1,472 expected vs 1,536 on disk, CRLF) is the only
discrepancy and is metadata-only; the SPZ/still hashes match the pinned evidence.

---

## 3. SPZ statistics highlights

Percentiles below are exact over every splat of each CSV export (not the tool's 1024-bin medians -
that is why tool medians differ slightly, e.g. 0.028295 vs 0.028368 for Golden scale_0; the tool
documents median as histogram-approximated, everything else exact).

| take | n | robust diag | full/robust diag | L p50 | L p99 | L p99.9 | L max | max/median | L>0.5 | L>1 | suspects (8x med or >2R) | % splats | % of L mass |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| golden | 27,447 | 16.675 | **1.89** | 0.087 | 1.367 | 3.716 | 8.373 | 95.8 | 1,809 | 498 | 975 | 3.55% | 27.4% |
| repeat | 25,181 | 17.998 | **2.25** | 0.087 | 1.284 | 4.482 | 15.643 | 179.0 | 2,055 | 467 | 1,059 | 4.21% | 29.5% |
| stress-10.03 | 34,342 | 28.517 | **2.82** | 0.153 | 2.254 | 6.126 | 17.725 | 115.6 | 4,368 | 1,324 | 948 | 2.76% | 23.9% |
| sweep-10.21 | 25,811 | 32.185 | **2.22** | 0.185 | 2.554 | 6.126 | 24.228 | 131.0 | 4,836 | 1,557 | 798 | 3.09% | 23.4% |
| sweep-14.59 | 27,466 | 18.317 | **2.45** | 0.087 | 1.455 | 4.210 | 17.725 | **202.9** | 2,158 | 552 | 1,140 | 4.15% | 30.2% |
| sweep-15.00 | 33,284 | 16.340 | **2.26** | 0.082 | 1.064 | 2.894 | 10.751 | 131.0 | 1,751 | 371 | 960 | 2.88% | 22.2% |
| sweep-4k-14.62 | 18,461 | 14.492 | **1.54** | 0.099 | 1.284 | 2.894 | 6.941 | **70.1** | 1,574 | 328 | 589 | 3.19% | 21.8% |

`L` = longest linear splat axis = `exp(max(scale_0, scale_1, scale_2))`; "suspects" = `L > 8 x
median(L)` OR distance from robust centre `> 2 x robust radius` (see §3.2).

### 3.1 Which takes are most/least cluttered

- **Most cluttered by spread:** `stress-10.03` - full/robust box ratio **2.82**, the largest robust
  box of all takes (diag 28.5), the most splats (34,342), and 4,368 splats with L > 0.5. Its median
  splat is already 1.75x Golden's.
- **Most cluttered by splat coarseness / longest splats:** `sweep-10.21` - median L **0.185**
  (2.1x Golden), absolute max L **24.2** (biggest of all), 4,836 splats with L > 0.5 (18.7% of the
  cloud). Only 25.8k splats spread over a 32-unit box: the classic "few, big, smeared" look.
- **Worst long-splat outliers (relative):** `sweep-14.59` max/median **202.9x**, then `repeat`
  **179.0x**; both also carry the largest haze-suspect mass (~30% of total splat length).
- **Least cluttered:** `sweep-4k-14.62` - ratio **1.54**, max/median **70.1x**, max L 6.94, only
  18,461 splats, smallest robust box (14.5). **Golden** is second-cleanest by box ratio (1.89) and
  has one of the smaller absolute outlier sets (975 suspects, L max 8.37), which supports keeping it
  as the tuning/quality reference.
- Converter `fillRatio` (19.9-27.5 for all takes) does **not** discriminate: all are healthy per the
  tool's own "ones-to-hundreds" guidance.

### 3.2 The suspicious mass is volumetric, not a distant shell

Splats with `L > 8 x median` are long streaks, but **95%+ of them sit within 2R of the robust
centre** (e.g. Golden: 974 of 975 within 2R; `centralBig` count in `spz-stats.json` is 806-1,067 per
take). Distance-from-centre is a very weak discriminator: max distance/R is only 1.3-2.8, and only
0-6 splats per take exceed 2R. So:
- do **not** expect a `--filter-sphere`/`--filter-box` distance cut to fix haze - it catches ~0-6
  splats per take (worth doing only as trace-junk insurance, it is effectively free);
- the haze is **long faint splats inside the scene**, consistent with the fast-pan camera segments
  (p90 consecutive azimuth step 15.8 deg, max 39 deg). Median opacity of suspects is 0.13-0.16 vs
  0.21-0.25 for the whole cloud - they are also fainter than average.
Opaque/near-zero opacity counts are small: alpha < 0.01 is 14-45 splats, alpha < 0.02 is 260-409 per
take (alpha is 8-bit quantised linear, so the lowest non-zero value is 1/255 = 0.0039; 0.02 is
~5/255). An opacity floor therefore removes ~1% of splats and is a safe complement to a scale cap,
but it will not remove the streaks on its own (their median alpha is ~0.14).

---

## 4. Suggested conservative CPU-only cleanup trial

Semantics verified against the tool (not guessed): `--filter-value` on `scale_0..2` and `opacity`
compares **linear** values, so the three per-axis caps below are equivalent to "drop splats whose
longest linear axis exceeds CAP", and `opacity,gte,FLOOR` keeps splats at least FLOOR opaque.
`--filter-nan` is a no-op on these files (kept for hygiene).

Recommended **default trial** per take (protects thin arms/legs/mesh: only the top ~1% of scales are
touched, and the chair's thin parts are near/below the median splat size):

```
node <impl>/node_modules/@playcanvas/splat-transform/bin/cli.mjs -w <in.spz> \
  --filter-nan \
  --filter-value scale_0,lt,CAP --filter-value scale_1,lt,CAP --filter-value scale_2,lt,CAP \
  --filter-value opacity,gte,0.02 \
  --filter-sphere CX,CY,CZ,2R \
  <out.spz>
```

| take | CAP = p99(L) | removal | ultra-safe CAP = p99.9(L) | ultra-safe removal | sphere centre (robust) | 2R |
|---|---|---|---|---|---|---|
| golden | **1.367** | 270 (0.98%, 13.3% of L mass) | 3.716 | 26 (0.09%) | 5.301, 2.165, 0.481 | 16.675 |
| repeat | **1.284** | 248 (0.98%, 13.1%) | 4.482 | 23 (0.09%) | 2.292, -0.827, 8.668 | 17.998 |
| stress-10.03 | **2.254** | 317 (0.92%, 13.2%) | 6.126 | 34 (0.10%) | 2.593, 0.302, 13.932 | 28.517 |
| sweep-10.21 | **2.554** | 234 (0.91%, 11.1%) | 6.126 | 24 (0.09%) | 1.206, -1.247, 15.476 | 32.185 |
| sweep-14.59 | **1.455** | 263 (0.96%, 13.6%) | 4.210 | 24 (0.09%) | 3.154, -0.817, 8.225 | 18.317 |
| sweep-15.00 | **1.064** | 322 (0.97%, 11.7%) | 2.894 | 30 (0.09%) | 5.171, 0.126, 6.710 | 16.340 |
| sweep-4k-14.62 | **1.284** | 177 (0.96%, 9.9%) | 2.894 | 16 (0.09%) | 5.795, 2.805, 6.288 | 14.492 |

- Add `--filter-value opacity,gte,0.02` (removes 260-409 splats, 1.0-1.4% per take). For a slightly
  stronger lift use 0.05 (removes 1,329-2,011 splats, 4.9-7.3%) - still far from the chair's opaque
  surfaces (median alpha 0.21-0.25), so it is a reasonable second trial, not a default.
- **Scale-invariant equivalent** if a global rule is preferred: CAP = `16 x median(L)` gives
  1.398 / 1.398 / 2.454 / 2.960 / 1.398 / 1.313 / 1.584 and removes 270 / 221 / 274 / 167 / 297 /
  198 / 97 splats - nearly identical to the p99 caps above with no per-take percentile estimation.
- **Do not** cap near the median (that would delete ~half the splats and thin chair geometry). The
  median L of 0.082-0.185 is the size of ordinary surface splats.
- A **combined** even-lighter filter (`L > p99.9` OR `(alpha<0.02 AND L>median)` OR `dist>2R`) removes
  only 133-275 splats (0.7-0.9%); use that as the "no visual risk" control if reviewers are nervous.
- Corrected for the units caveat: all caps are in reconstruction units. The Brush SPZ appears to keep
  the COLMAP scale (Golden's splat median x/z = 4.34/1.72 vs sparse-point median 3.98/1.74), so the
  numbers above are directly usable on these SPZs; re-derive them if any candidate is rescaled.

---

## 5. Transform-displacement sanity check (viewer defect 1)

Viewer: rotation q=(x=1,y=0,z=0,w=0) => **R = diag(1, -1, -1)** (180 deg about X). Current code sets
`position = -center`; the world centre becomes `R*c - c` instead of 0. Corrected `position = -R*c`
gives world centre exactly 0. Using each take's robust centre c (midpoint of its per-axis 1-99 box):

| take | c = (x, y, z) | correct position -R c | old world-centre offset |Rc - c| | robust radius R | offset / R | offset % of robust diagonal | offset % of full diagonal |
|---|---|---|---|---|---|---|
| golden | (5.301, 2.165, 0.481) | (-5.301, 2.165, 0.481) | **4.435** | 8.338 | 0.53 | 26.6% | 14.1% |
| repeat | (2.292, -0.827, 8.668) | (-2.292, -0.827, 8.668) | **17.414** | 8.999 | 1.94 | 96.8% | 43.0% |
| stress-10.03 | (2.593, 0.302, 13.932) | (-2.593, 0.302, 13.932) | **27.871** | 14.258 | 1.95 | 97.7% | 34.6% |
| sweep-10.21 | (1.206, -1.247, 15.476) | (-1.206, -1.247, 15.476) | **31.052** | 16.093 | 1.93 | 96.5% | 43.5% |
| sweep-14.59 | (3.154, -0.817, 8.225) | (-3.154, -0.817, 8.225) | **16.531** | 9.158 | 1.81 | 90.3% | 36.9% |
| sweep-15.00 | (5.171, 0.126, 6.710) | (-5.171, 0.126, 6.710) | **13.423** | 8.170 | 1.64 | 82.1% | 36.3% |
| sweep-4k-14.62 | (5.795, 2.805, 6.288) | (-5.795, 2.805, 6.288) | **13.772** | 7.246 | 1.90 | 95.0% | 61.6% |

Closed form: `|R c - c| = 2 * sqrt(c_y^2 + c_z^2)` for R=diag(1,-1,-1); it depends only on the
centre's y/z. Golden is the mild case (offset 0.53R) because its centre is close to the y=z=0 plane;
the six sweep/stress/repeat takes are displaced by 1.6-2.0 robust radii, i.e. the subject can be
half a to a full frame off-centre (and the previous `-center` semantics was hiding the real subject
position, so any visual comparison done before the fix is not representative).

---

## 6. Data-quality surprises worth flagging

1. **The scans are room-scale, not chair-scale.** 1-99 boxes are 14.5-32.2 units; the chair is a
   minority of most clouds. All "haze" thresholds must be relative (percentiles / median multiples);
   absolute world-unit caps are only comparable within one take.
2. **The audit's full-vs-robust box ratio is a good outlier score** and matches the visual ordering:
   1.54 (4K) -> 2.82 (stress). A handful of extreme splats (full box up to 80.6 diagonal on stress)
   inflates the full box 1.5-2.8x; these extremes are exactly what the p99/p99.9 caps remove.
3. **Long splats are not far splats.** Unlike the usual "floater shell", 95%+ of long splats sit
   inside the robust volume and are fainter than average. Distance filtering will not clean them;
   length+opacity filtering will. This also correlates with the fast-pan segments in the coverage
   analysis (p90 azimuth step 15.8 deg, max 39 deg).
4. **`--filter-nan` is a no-op** on all seven SPZs (0 NaN/Inf), so it cannot improve quality here -
   it should only be kept as hygiene.
5. **SPZ alpha is 8-bit linear** (`k/255`), so per-splat opacity is coarse (0.0039 steps) and the
   "near-zero" population has a hard floor; also splat scales are quantised (log step 1/16), which is
   why Golden/Repeat/14.59 all report exactly the same median L = 0.0874. Percentile clustering on
   these grids is expected, not a bug.
6. **The three stills are camera stills, not viewer renders** (yes, they are the raw phone frames at
   t~0 / mid / end; verified by SHA-256 against `frames/0001.jpg`, `0039.jpg`, `0076.jpg`). Reviewer
   sheets built from them in `comparisons/reference/` are *input* references, not render QA.
7. **`analysis/coverage-golden.json` (written 15:52 by a coordinator-side coverage export) and my
   independent `analysis/coverage-golden-diag.json` agree** on camera centroid, azimuth histogram,
   occupied bins and forward concentration; only a consecutive-step statistic differs by convention
   (1.22/8.30 deg vs 3.16/15.78 deg - mine is defined in `COVERAGE.md`). Both refer to the same model
   bytes (`images.bin` SHA-256 `b6d0f036...`; the `aligned/` copy is byte-identical).
8. **Fixture job.json files disagree with the pinned lock bytes** (1,472 expected vs 1,536 actual;
   CRLF vs LF) on all seven takes - already logged by preflight; artifacts themselves hash-match.

---

## 7. Reference sheets produced (Pillow)

| sheet | path | size |
|---|---|---|
| per-take 3 stills + label | `comparisons/reference/ref-golden.jpg` | 1454x948 |
| | `comparisons/reference/ref-repeat.jpg`, `ref-stress-10.03.jpg`, `ref-sweep-10.21.jpg`, `ref-sweep-14.59.jpg`, `ref-sweep-15.00.jpg`, `ref-sweep-4k-14.62.jpg` | 1454x948 each |
| combined 7 rows x 3 stills | `comparisons/reference/ref-all-takes.jpg` | 1152x3979 |
| Golden 12-frame montage (3x4) | `comparisons/reference/ref-golden-frames.jpg` | 936x2286 |
| stress 10.03 12-frame montage (3x4) | `comparisons/reference/ref-stress-frames.jpg` | 936x2286 |

Manifest: `qa/diag/reference-sheets.json`. Frame montages sample 12 frames evenly from the 76/60
source frames (0, 25.35 s); labels carry the frame filenames for camera-matched comparisons. Example
reference: `comparisons/reference/ref-all-takes.jpg` (every take's first/middle/last still in one
sheet).

---

## 8. Coverage status

**Done** (see `analysis/COVERAGE.md` and `analysis/coverage-golden-diag.json`): alignment completed
15:41:10, single model `datasets/golden-25.35/sparse/0` with 76/76 registered images, parsed from
`images.bin` (no `images.txt` was produced; parsed directly in Python - no COLMAP invocation).
No newer model directory appeared during the 20-minute poll window (checked 15:52 and 16:00).

---

## 9. Recommendations for the coordinator

1. Fix the viewer transform to `position = -R*c` (with `c` from the same robust fit the viewer uses);
   the displacement table in §5 quantifies the bug per take. Golden is a poor test case for this bug
   (0.53R); validate the fix on Repeat/stress/10.21 where displacement is ~2R.
2. Run the conservative filter trial from §4 on **copies** of Golden (and optionally stress/10.21) and
   A/B against the no-op control; the p99 cap + 0.02 opacity floor removes ~2.0-2.4% of splats and
   ~14% of the long-splat mass while keeping every splat at or below the 99th percentile of size.
3. Do not chase distance-based floater removal for these takes - there is no distant shell. Priority
   is the transform fix, then scale/opacity cleanup, then retraining (Q2 6000-step) comparison.
4. For reviewer camera-matched comparisons, use `ref-golden-frames.jpg` / `ref-stress-frames.jpg`:
   camera coverage is a ~225 deg front arc (8/12 bins), so the azimuth sector 0-90 deg (the chair's
   rear) was never imaged and must not be scored.
