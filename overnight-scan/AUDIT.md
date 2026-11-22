# Chair scan evidence audit

**Scope:** LihatDulu `main` at `a26d952` and the seven-take evidence branch at `cbf69f09fbb41eacaa8ea40e6e6cb55ceec61e4c`. The source originals and aligned frame sets remain on the Helios. This audit reviewed all published previews and stills, decoded the seven SPZs, inspected repository code, and ran an isolated browser diagnostic on Golden and the 10.03-second variant. It did not retrain or alter the production repository.

**Verdict:** All seven published opening views fail as furniture inspection views. Better camera framing shows more of the chair in some cases, but a trial that targeted oversized splats left substantial room debris and distortion. The work should attack both viewer framing and reconstruction quality.

## What the evidence says

All 80 manifest assets were present. One Markdown digest matched after restoring Windows line endings. The seven original SPZs decoded successfully, with finite position and scale columns and splat counts matching the manifest. The published stills are frames 0, middle, and last, so they show source appearance and visible room clutter but cannot establish full orbit coverage. The published mobile screenshots are desktop-browser emulations.

| Take | Frames registered | Worker stages | SPZ MiB | Full vs percentile box diagonal | Max vs median longest splat axis |
|---|---:|---:|---:|---:|---:|
| Golden, 25.35 s | 76/76 | 4:51 | 0.52 | 1.89× | 95.8× |
| Repeat, 20.13 s | 60/60 | 4:50 | 0.47 | 2.25× | 179.0× |
| 10.03 s | 60/60 | 5:33 | 0.68 | 2.83× | 115.6× |
| 10.21 s | 60/60 | 4:04 | 0.50 | 2.22× | 131.0× |
| 14.59 s | 72/72 | 4:19 | 0.51 | 2.45× | 202.9× |
| 15.00 s, extraction retry | 74/74 | 4:30 | 0.62 | 2.26× | 131.0× |
| 4K-source 14.62 s | 71/71 | 4:05 | 0.34 | 1.54× | 70.1× |

The percentile box uses per-axis 1st and 99th percentiles of splat centers. It measures outlier sensitivity and is not a semantic chair boundary. Longest-axis scale is the maximum of each decoded splat's three linear scale estimates. Neither diagnostic identifies which splats belong to the chair. See [the raw diagnostic stats](evidence/splat-stats.json), [all seven published views and stills](evidence/published-views.jpg), and the [reframing and trim comparison](evidence/reframe-and-trim.jpg).

Golden's published view has bright haze over the chair. Repeat and the 10.03-second variant show small fragments. The 10.21-second and 14.59-second takes also open with small streaked views. The 15-second and 4K-source takes show more colored material without providing a clear chair silhouette at opening. Registration, splat counts, and a centered PNG all failed as visual proxies here.

## Findings that change the run order

| Finding | Evidence | Overnight implication |
|---|---|---|
| **Viewer centers in the wrong coordinate system.** | `src/scan-viewer.js` applies a rotation to the model, then subtracts its unrotated local center. A synthetic nonzero-center test reproduced the displacement. A corrected render moved the real Golden model, with haze still present. | Fix the transform independently of training. Capture the same file before and after. |
| **The view fits the whole reconstruction.** | `getBoundingBox(true)` fits all splat centers, including room points and outliers. All seven full diagonals are larger than their percentile boxes. Reframing made the Golden detail larger without producing a usable chair. Default camera controls move through the scene instead of maintaining a chair-centered orbit. | Use stable object framing, orbit, reset and resize. Verify actual views and inspect the rotation convention before deriving a pose. |
| **The artifacts contain large, distracting splats and room content.** | The longest splat axes vary sharply. In a controlled diagnostic copy, dropping about the largest 1% removed 270 splats from Golden and 317 from the 10.03-second take. It reduced some haze and streaks. A Golden view turned 90° was still dominated by a cupboard, and the short take still included floor and background fragments. | Treat cheap cleanup as an experiment. Move to object-aware training and capture coverage if the result remains unusable. Protect thin chair details during filtering. |
| **The reported frame size is wrong for this footage.** | `server/scan-pipeline.mjs` uses `scale=1280:-2`, which fixes width. All 21 published stills are portrait **1280 × 2276**, even though the metadata reports encoded landscape dimensions and the handoff says 1280 long edge. FFmpeg preserves aspect ratio for the computed negative dimension. | Measure encoded and displayed orientation separately. Confirm actual dataset dimensions. For a speed candidate use a real long-edge cap and rerun alignment on resized frames. Treat the older dimension claim as unverified for the full dataset. |
| **Existing checks measure process completion.** | The harness verifies ready state, a splat count, and PNG size. The earlier verdict used center/edge metrics. Seven visually weak defaults passed. | Separate processing complete, rendered, visually usable, and physical phone verified. Add fixed-view and actual image review gates. |
| **Capture advice combines tasks.** | The timer's prompts move from an orbit to open drawers and defect close-ups in one take. The study's baseline recommends a complete, overlapping orbit. The published stills include partial framing and room clutter. | Keep the main geometry pass consistent and validate coverage from the actual aligned frame set. Keep any separate detail evidence out of the geometry experiment. |
| **Replay and timing provenance can mislead.** | Batch titles are filenames and dimensions are fixture values. The result page uses fresh-recording language. Worker total sums four stages and excludes capture, transfer, queue, and viewer load. | Label replay accurately, preserve real and provisional metadata, and time replay-to-usable-view separately. Do not infer dimensions from the SPZ. |
| **Local trial isolation matters.** | The scan server prunes completed jobs at startup and during runs. The worker deletes its temporary aligned dataset after success. Tracked `dist/` predates the scan feature. | Use isolated jobs, preserve reusable alignment before cleanup, and build from the implementation worktree. |

The experimental trim wrote a separate SPZ. Its re-encoding changes the byte hash, so treat the comparison as diagnostic and include a verified no-op round-trip render in future A/Bs. The first attempt to write a trim used an incorrect argument position and produced a seven-splat file. It was rejected by structural verification and replaced before review.

## Speed and remaining proof

Across the seven lab runs, alignment consumed about **45%** and Brush training **54%** of summed worker time. SPZ conversion took about **0.52 s** at the median. The fresh build's lazy scan-viewer bundle was about **959 kB gzip** before loading an asset. That makes alignment and training the first worker speed targets after quality passes, with viewer transfer and first usable view measured separately.

The previous fresh build passed 26 marketplace and 15 simulated scan checks. Unit tests were 196/197 in the Linux environment because one Brush argument test passes Windows-style paths to the native path module. Those checks establish workflow behavior, and the lab study establishes laptop reconstruction. A new capture from the physical phone over HTTPS and end-to-end phone timing are still open.

## References

- [Pinned evidence and study manifest](https://github.com/Fafauzif/Lihatdulu/blob/cbf69f09fbb41eacaa8ea40e6e6cb55ceec61e4c/docs/handoff/scan-evidence-manifest.json)
- [Viewer on the audited baseline](https://github.com/Fafauzif/Lihatdulu/blob/a26d952/src/scan-viewer.js) and [worker on the audited baseline](https://github.com/Fafauzif/Lihatdulu/blob/a26d952/server/scan-pipeline.mjs)
- [Lab report](https://github.com/Fafauzif/Lihatdulu/blob/a26d952/docs/handoff/scan-toolchain.md)
- [FFmpeg scale filter](https://ffmpeg.org/ffmpeg-filters.html#scale-1), [Spark camera controls](https://sparkjs.dev/docs/controls/), and [Brush release notes for mask support](https://github.com/ArthurBrussee/brush/releases). Check the locally pinned help before running version-specific options.
