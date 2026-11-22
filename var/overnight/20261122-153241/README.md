# Evidence bundle — LihatDulu scan-quality run `20261122-153241`

Curated record of a two-session run (2026-11-22, Asia/Jakarta) that tried to turn 20-second
phone clips of one office chair into an inspectable 3D result, and the opt-in pipeline profile
that came out of it.

This folder is the publishable subset. The working copy on the machine that produced it holds
1.0 GB of run data; only the documents, measurements, comparison sheets and the best artifact
are here. What is deliberately excluded is listed at the bottom.

## Code

| Item | Value |
|---|---|
| Branch | `work/scan-quality-overnight-20261122-153241` |
| Head | `d001013` (seven commits) |
| Base | `a26d952` (`main` at the time) |
| Default behaviour | unchanged: no cleanup, no extra provenance key, same Brush and convert arguments |
| Opt-in | `SCAN_PROFILE=chair`, or `profile: "chair"` in the job request |

Commits: `6363101` viewer placement/orbit/reset/pose-API fix plus the matched-pose QA harness ·
`24c0e04` lifecycle proof (resize, route re-entry, reload, disposal) ·
`5f782ae` opt-in chair cleanup profile ·
`c51a704` hardening after an independent review ·
`58148a1` and `d001013` documentation ·
`5e28473` clamp tests.

## What the cleanup does

```
centre = least-squares intersection of the aligned COLMAP camera optical axes
radius = clamp(0.9 * r90(opaque mass about that mass's own median), 1.8, 2.7)
trainSteps = 6000
```

The scans are room-scale (52 k–68 k splats for a whole room), so percentile framing cannot
isolate furniture. A sphere around the camera-axis target can. The radius is measured from the
cloud rather than hard-coded, and it converges across independent reconstructions:

| Take | radius | kept / before |
|---|---:|---|
| Golden 25.35 s (tuning) | 2.042 | 6 096 / 68 076 |
| Repeat 20.13 s, offline alignment | 2.528 | 5 015 / 52 026 |
| Repeat 20.13 s, real pipeline run | 2.514 | 4 993 / 51 940 |
| Stress 10.03 s | 2.700 (clamp) | 1 155 / 70 725 |

## Best result (not promoted)

`best/chair-q2-6000-sph20.spz` — 5 958 splats, 124 705 bytes; job fixture
`6bbc9bf5-e44b-4989-99cf-4fd7852634ff`. The shipped rule reproduces it within 0.33–0.39/255 mean
pixel difference (0.41–0.67 % of pixels changed) at 6 096 splats.

```powershell
SCAN_ROOT=<path containing 6bbc9bf5-e44b-4989-99cf-4fd7852634ff>
SCAN_KEEP=100
npm run scan:serve
# /pindai/6bbc9bf5-e44b-4989-99cf-4fd7852634ff
```

## Verdict

The visual gate is **not** cleared. Of four matched poses on Golden only the front quarter
reads cleanly — backrest, seat and arms; az030 streaks through the arms, az120/az210 are dark
with haze at the base. Repeat is partial: its opaque mass is genuinely softer (r90 2.81 vs 2.27)
and the lower half smears. The 10.03 s stress take fails outright — it never framed the chair,
so no filtering can recover it. Nothing here has been seen on a physical phone.

## Contents

| Path | What it holds |
|---|---|
| `MORNING.md` | Handoff written for the morning: result first, open command, tests, failures, phone checklist |
| `HANDOFF.md` | Full technical handoff: commands, measurements, frozen configuration, gotchas |
| `status.json` | Machine-readable run state: commits, verification, artifacts, known issues |
| `experiments.jsonl` | Append-only ledger of every experiment, including rejected candidates (`S0`…`T3`) |
| `NEXT_SESSION_PROMPT.md` | The prompt that started the second session (kept as provenance; marked consumed) |
| `analysis/` | Diagnostics, coverage, SPZ statistics, fixture maps and the measurement scripts |
| `comparisons/` | Labelled contact sheets: rule matrix, frozen configuration, stress grading, radius sweep; `reference/` holds the source stills used to grade |
| `best/` | Best SPZ, its contact sheets and the four matched viewer renders |
| `tools/` | Helper scripts used for the measurements and the PLY cleanup |

## Not published (kept local)

`datasets/` 519 MB (COLMAP databases and sparse models), `jobs-e2e/` 128 MB and `jobs/` 47 MB
(job stores), `qa/` 59 MB (browser reports and screenshots), `train/` 52 MB (Brush PLY exports),
`filtered/` 28 MB, `analysis/csv/` 86 MB (per-splat CSV dumps) and `renders/` (every pose of
every variant). Three COLMAP `db.db` files exceed GitHub's 100 MB file limit, so this data
cannot be committed as ordinary git objects. Everything needed to regenerate it is described in
`HANDOFF.md` §6.
