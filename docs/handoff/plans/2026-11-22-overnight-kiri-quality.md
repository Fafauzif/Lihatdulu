# Overnight plan · KIRI scan quality (22–23 November 2026)

**Goal:** wake up to one chair reconstruction that visibly passes — seat, backrest,
legs readable in the viewer at four matched poses — or a clear, evidence-backed
answer that KIRI cannot deliver it with the clips we own.

**Branch:** `feat/kiri-scan` (worktree `Lihatdulu-kiri-scan`). Nothing merged or
deployed. Primary checkout, `var/scans`, raw footage and the overnight-scan
evidence stay untouched.

## Why last night failed

The one paid job returned 281 000 splats: 50 000 of them a synthetic backdrop
ball at radius 50.0, the rest a dark hollow shell at r≈3–8. The transport,
storage, conversion, viewer, reload resume and mobile layout all worked. So the
open question is purely reconstruction quality, and the suspects are, in order:

1. the clip (dark object, moving camera, portrait, 25 s);
2. `isMask=1` (automatic object masking) cutting the chair into fragments;
3. KIRI's video pipeline preferring a room-scale scene over one object;
4. our capture guidance (distance, orbit coverage, lighting).

## Budget and stop rules

- **Hard cap: 8 paid jobs** (one credit each), ~40 min each ⇒ ≈5.5 h serial.
  The server already maps `kiri_no_credit` honestly; the runner stops on it.
- Stop at the first PASS. Stop on two identical failure signatures in a row —
  change axis instead of repeating.
- Every job keeps its own evidence folder. Nothing is overwritten; the previous
  live job `bb2ea77d…` stays intact.
- If the runner dies, it resumes from `state.json` and never re-pays a ready job
  (existing hash dedupe).

## Candidate matrix (ordered, one at a time)

| # | Clip | isMask | Question it answers |
|---|---|---|---|
| 1 | gold (25.3 s, portrait) | **0** | Is automatic masking destroying the chair? |
| 2 | repeat (20.1 s) | 1 | Is this clip-specific? |
| 3 | repeat (20.1 s) | **0** | Best clip × no mask |
| 4 | 4K take downscaled to 1080p | 1 | Does more detail help? |
| 5 | stress (10.0 s) | 1 | Cheap control: is 25 s even needed? |
| 6 | gold trimmed to a 12 s clean orbit | **0** | Can a tighter, steadier orbit fix it? |
| 7 | outside-in: best clip + higher-quality flag if the API exposes one | best | Last setting-level lever |
| 8 | reserve for a re-run of the best candidate with a fix suggested by 1–7 | best | Recovery slot |

Clips live in `var/kiri-live/input/` and the retained `var/scans/*/frames`.
Clips are resubmitted byte-identical only when the mask setting differs, so hash
dedupe never silently reuses a job (mask is part of the matrix, not the hash —
the runner submits through KIRI directly for each variant and records both).

## Per-job pipeline (automated, serial)

1. Submit `POST /v1/open/3dgs/video` with the matrix's `isMask`.
2. Poll `getStatus` with capped backoff; record every stage transition + timing.
3. On success: download the ZIP, validate the PLY, run `stripBackdrop`, convert
   with the pinned `splat-transform`, validate the SPZ.
4. Render four matched poses (front / three-quarter / side / top) with the
   existing harness at 1440 px, plus one 390 px mobile frame.
5. Score programmatically and keep the evidence.

## Scoring (programmatic, then human)

Written to `score.json` per job, computed from the stripped PLY:

- **dome**: splats within ±1 of a single far radius (must be 0 after cleanup);
- **shell test**: radial mass histogram — a usable object fills a volume, not a
  thin shell at one radius band;
- **extent**: bounding box after removing the far field; flag room-scale blobs;
- **centring**: distance from the camera-ray target to the splat centroid;
- **colour spread**: a chair has seat/leg/backrest contrast, a grey soup does not;
- **coverage**: fraction of the four render poses whose silhouette is non-empty
  and inside frame (no "model is off-screen" results).

PASS = shell test passes **and** extent plausible **and** all four poses show a
readable object when I look at the contact sheet. The contact sheet is the final
judge; the score only ranks candidates and rejects obvious garbage without me.

## Evidence layout

```
var/kiri-overnight/
  20261122-<start>/
    state.json                  # resume state, credits spent, matrix position
    jobs/<id>/job.json          # KIRI serial, timings, mask flag, artifact
    jobs/<id>/score.json
    jobs/<id>/contact.png       # four poses + mobile
    jobs/<id>/result.spz
    SUMMARY.md                  # ranked table, best candidate, open command
    matrix.jpg                  # all contact sheets in one sheet
  LATEST -> 20261122-<start>
```

Git-ignored, like the rest of `var/`. Only the plan, the runner and the docs go
into the branch.

## Morning handoff

`SUMMARY.md` plus a short `MORNING.md` entry with:

- the best candidate and the **exact command** to open it (`KIRI_JOBS_ROOT=…
  npm run scan:serve`, then `/pindai/:id`);
- credits spent, jobs attempted, timings table;
- what each axis changed, and the remaining failure signature if nothing passed;
- the honest recommendation: keep KIRI, change capture, or stop.

## Code touched (kept minimal and reversible)

- `server/kiri-client.mjs` — `isMask` from config instead of hardcoded `1`
  (default unchanged, so the prototype behaves exactly as today).
- `server/kiri-config.mjs` — `KIRI_ISMASK` env, default `1`.
- `tests/kiri-client.test.js` — mask default + override.
- `var/kiri-overnight/run.mjs` + `score.mjs` — the runner and scorer (git-ignored
  diagnostic tooling, same as `var/kiri-live/drive.mjs`).

No UI change, no route change, no change to the mock path.

## Risks

- **Credits run out mid-matrix.** Handled: the API refuses, the runner records
  `no_credit` and writes the summary with what it has.
- **All eight fail the same way.** Then the conclusion is capture/API-level, and
  the summary says exactly which axis was ruled out and what a 9th job should
  change — no silent "try again".
- **A job takes longer than 40 min.** The runner keeps polling up to 3 h per job;
  overnight budget still holds.
- **Session dies.** The runner is a detached Node process writing state and
  evidence to disk; a resume re-reads `state.json`.
