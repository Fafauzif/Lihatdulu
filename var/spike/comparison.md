# Chair clip comparison — Task 5 (2026-11-22)

All rows are camera originals from `var/spike/clips/`; the 3.33 s false start is excluded and the five compressed WhatsApp copies never entered a batch. Pipeline: FFmpeg 8.1.2 → COLMAP 4.2.1 (CUDA) → Brush 0.3.0 → splat-transform 3.12.0. Frames are 1280 long edge; extraction fps is adaptive (base 3, capped 8). Golden and repeat rows are the Task 4 reference pair, not variants.

| clip | resolution | duration s | extracted | registered | ratio | extract ms | align ms | train ms | convert ms | total ms | splats | artifact MiB | outcome |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `184212135.mp4` (variant) | 1920×1080 | 10.03 | 60 | 60 | 1.00 | 1 479 | 166 342 | 164 537 | 515 | 332 873 | 34 342 | 0.68 | ready |
| `184320272.mp4` (variant) | 1920×1080 | 10.21 | 60 | 60 | 1.00 | 1 646 | 106 862 | 135 113 | 521 | 244 142 | 25 811 | 0.50 | ready |
| `184453628.mp4` (variant) | 1920×1080 | 14.59 | 72 | 72 | 1.00 | 2 400 | 113 234 | 143 254 | 489 | 259 377 | 27 466 | 0.51 | ready |
| `184626753.mp4` (variant) | 1920×1080 | 15.00 | 74 | 74 | 1.00 | 3 020 | 130 291 | 135 725 | 503 | 269 539 | 33 284 | 0.62 | ready (5 fps extraction retry) |
| `184714115.mp4` (variant, 4K source) | 3840×2160 → 1280 frames | 14.62 | 71 | 71 | 1.00 | 3 874 | 105 922 | 134 968 | 458 | 245 222 | 18 461 | 0.34 | ready |
| `184227976.mp4` (golden, reference) | 1920×1080 | 25.35 | 76 | 76 | 1.00 | 2 730 | 128 856 | 158 546 | 1 149 | 291 281 | 27 447 | 0.52 | ready |
| `184349140.mp4` (repeat, reference) | 1920×1080 | 20.13 | 60 | 60 | 1.00 | 6 244 | 119 804 | 162 142 | 1 528 | 289 718 | 25 181 | 0.47 | ready |

The 4K take is downscaled to the same 1280 frames as the others, as the plan intends; that is why it is comparable, not higher fidelity in this pipeline.

## Top two failure causes

- **No variant hit the registration gate.** Every variant registered every extracted frame (60/60, 72/72, 74/74, 71/71, 100 %). The ratio counts frames present in the chosen COLMAP model, not visual quality, so it cannot separate these takes; the only variant failure was the 15.00 s VFR take producing 59 real frames at the 4 fps calculation (`footage_short`), a frame-extraction edge fixed by the capped extraction retry — not motion blur, dimness or coverage.
- **The 4K take buys nothing after the 1280 downscale.** It produced the fewest splats (18 461) and smallest artifact (0.34 MiB) of the 14–15 s takes, while carrying 49 Mbps source cost; the 1080p 14–15 s takes produced 27 466–33 284 splats and 0.51–0.62 MiB. The 18–34 k splat counts are lower than the South Building smoke (122 158) because these are short 60–76 frame indoor orbits; the viewer still needs the Task 7 check.

## Decision (Task 5 Step 4)

Golden and repeat pass the Task 4 gate and every variant passes; the one honest failure was tooling-side and is fixed. **Proceed** to Task 7 previews and Task 8 verdict. No reshoot is required for reconstruction success. Raw evidence: `var/spike/results-golden.json`, `var/spike/results-variants.json`; attempt-1 failure evidence kept in `var/spike/results-variants-attempt1.json`.
