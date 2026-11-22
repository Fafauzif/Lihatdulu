# Camera coverage - Golden 25.35 s reconstruction

Status: **COMPLETE** - the coordinator's COLMAP alignment finished at 2026-11-22 15:41:10 (+07:00),
before the 20-minute poll window was needed. Parsed at 15:52; re-checked at 16:00 - no newer model
directory and no `images.txt` appeared.

Data: `analysis/coverage-golden-diag.json` (mine) - produced by `analysis/coverage.py`.
Parser is pure Python over the COLMAP **binary** model; COLMAP itself was not invoked (CPU-only rule).

> Path note: `analysis/coverage-golden.json` already existed when this analysis finished (written
> 15:52 by a coordinator-side coverage export of the aligned dataset). It was **left untouched**;
> my machine-readable result is `analysis/coverage-golden-diag.json`. The two independently agree on
> the camera centroid, the 12-bin azimuth histogram, occupied-bin count and forward-vector
> concentration; they differ only in the consecutive-frame step statistic (the coordinator file
> reports median 1.22 deg / p90 8.30 deg with its own ordering convention, mine reports 3.16 deg /
> 15.78 deg as defined above). Both source files point at the same model bytes.

## Model selection

| item | value |
|---|---|
| sparse dir | `datasets/golden-25.35/sparse/0` (only numeric model produced) |
| model format | COLMAP binary (`images.bin` 17,902,532 B; no `images.txt` was written) |
| `images.bin` SHA-256 | `b6d0f036ad1f1c32b57f89d18188fa604b5a2d686cc506b26f4f45bae1121455` |
| other files | `cameras.bin` 96 B, `points3D.bin` 1,304,332 B, `rigs.bin` 24 B, `frames.bin` 6,392 B |
| registered images | **76 / 76** (100%) |
| model copy | `datasets/golden-25.35/aligned/sparse/0` is byte-identical (`images.bin` hash match) |

Cross-check against the coordinator's own analyser log (`logs/align-golden-analyze-0.log`):
Rigs 1, Cameras 1, Frames 76, Registered frames 76, Images 76, Points 12,676, Observations 82,231,
mean track length 6.487, mean reprojection error 0.957 px. My parse reproduces image/point counts and
the 0.957 px mean reprojection error exactly; the binary walk leaves **0 leftover bytes**, all quats
are unit (`max | |q| - 1 | = 2.2e-16`), all image names are printable ASCII.

## Camera centres (C = -R^T t, quaternion w,x,y,z -> world-to-camera R)

| item | x | y | z |
|---|---|---|---|
| bbox min | -2.401 | -1.149 | -3.892 |
| bbox max | 2.804 | 1.904 | 4.691 |
| bbox size | 5.204 | 3.053 | 8.583 |
| centroid | 0.170 | 0.071 | 0.199 |

Distance camera -> centroid: min **0.843**, p10 **1.490**, median **3.041**, mean 3.155,
p90 **5.047**, max **5.196** world units.
Consecutive camera-centre step: median **0.227**, p90 **0.814**, max **1.321** units.

## Azimuth of camera positions around the centroid

Convention: `azimuth = atan2(x - cx, z - cz) mod 360` in the XZ plane; **0 deg = +Z from the
centroid, 90 deg = +X, 180 deg = -Z, 270 deg = -X** (COLMAP world frame; y is the height axis here).

| bin start | 0 | 30 | 60 | 90 | 120 | 150 | 180 | 210 | 240 | 270 | 300 | 330 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| frames | 0 | 0 | 0 | 0 | 13 | 12 | 4 | 11 | 3 | 10 | 5 | 18 |

- bins occupied: **8 / 12 = 66.7%** (bins 0-90 deg empty: no camera ever on that side)
- circular mean resultant length (azimuth): **0.229** - cameras are spread over a broad arc,
  not concentrated in one direction
- unwrapped azimuth span over the frame sequence: **225.1 deg** (start 226.3 deg, end 212.3 deg)
- consecutive-frame azimuth step: median **3.162 deg**, mean 6.244 deg, p90 **15.777 deg**,
  max **38.983 deg**, sum of |steps| 468 deg (the handheld arc also pans back and forth;
  0 frames with a zero step)

## Viewing direction (optical axis, world = R^T * (0,0,1))

- 3-D mean resultant length (concentration): **0.786** - a fairly consistent facing direction
- mean direction unit vector: (0.736, 0.509, 0.447); mean azimuth **59.6 deg**
- azimuth circular resultant length 0.761
- optical-axis elevation: min **4.5 deg**, median **24.7 deg**, max **42.0 deg**
  (positive = pointing upward: the camera looks up towards the chair back at all times)
- camera height (y): min **-1.149**, median **-0.234**, max **1.904**, range **3.053** units
- camera elevation around the centroid: min -54.8 deg, median -3.8 deg, max +21.9 deg

## Mapping sorted image names to the three stills

Sorted COLMAP names are `0001.jpg ... 0076.jpg`; the Golden stills hash-match frames
(000 = first, 001 = middle, 002 = last):

| still | frame | rank in sorted names | registered | centre (x, y, z) | azimuth | elevation | dist to centroid |
|---|---|---|---|---|---|---|---|
| `stills/000.jpg` | `0001.jpg` | 0 | yes | (-0.873, 0.182, -0.798) | 226.3 deg | +4.4 deg | 1.447 |
| `stills/001.jpg` | `0039.jpg` | 38 | yes | (-1.131, -0.558, -0.676) | 236.1 deg | -21.9 deg | 1.690 |
| `stills/002.jpg` | `0076.jpg` | 75 | yes | (-0.132, -0.555, -0.277) | 212.3 deg | -48.0 deg | 0.843 |

The last frame is the closest to the subject and is looking 48 deg down at it; the first is the
farthest and level. This matches the still images (still 002 is the high-angle seat shot).

## Supplementary: coverage around the sparse-point centre

`points3D.bin` contains 12,676 points (mean reprojection error 0.957 px). Their per-axis median
centre is (3.975, 4.945, 1.740) with p99 radius 8.172 units - this cloud includes room/background,
so the median is not the chair centre, but as a proxy:

- camera distance to that centre: min 5.62, median 7.40, max 8.27 units
- azimuth around it: bins 180-330 deg only -> **5 / 12 = 41.7%**, resultant length 0.774,
  mean direction 247 deg
- camera elevation around it: -50.5 to -32.1 deg, median -44.2 deg

i.e. measured against the reconstructed room content, the capture covers one **~150-225 deg front
arc**, not a full orbit. Both measures agree with the "walk past the chair, pan up/down" motion seen
in the stills and the 4K frame montage.

## What this means for the quality run

- 100% registration of 76 frames with 0.96 px reprojection error: the existing footage is
  geometrically sound; any quality gain must come from training/filtering, not more frames.
- Coverage is a ~225 deg arc with 8/12 azimuth bins; no camera was ever positioned in the azimuth
  sector 0-90 deg, so the side of the chair facing that sector (the rear) was never imaged. Expect
  missing/soft geometry there; do not evaluate it.
- Frame-to-frame angular steps are mostly small (median 3.2 deg) but p90 = 15.8 deg and max 39 deg:
  a few fast-pan segments exist. That is the likely source of the elongated "streak" splats seen in
  the SPZ statistics, not just distant floaters.
- Vertical coverage is good (optical-axis elevation spans +4 to +42 deg, camera height range 3.05
  units) so seat, arms and upper back were seen from above and level; the five-star base/underside
  (seen only when looking down at 48 deg) will be the thinnest data.
