# Overnight execution runbook

## Owner decisions

Prioritize 3D quality, then speed. Integrate an evidence-backed winner as an opt-in preset. Use the existing phone footage and the RTX 4060 laptop. Project-local downloads for an open segmentation tool and model are authorized if needed for the mask trial. Record tool versions and download origins. Preserve the Vite, JavaScript, Three.js, SparkJS, and local reconstruction setup. Keep the prepared Sora demo separate. Keep branch changes and run evidence local.

## 0. Set up and checkpoint

1. Read the project `AGENTS.md` and the current scan handoff. Collect `git status --short --branch` and commit IDs. Record the start time and a deadline six hours later. Create `var/overnight/<YYYYMMDD-HHMMSS>/` in the original checkout, write its absolute path to `var/overnight/LATEST.txt`, and save the preflight output. Use one durable ledger per run.
2. Keep the current checkout and branch in place. Fetch `origin`, verify the evidence commit, and create a sibling worktree on a new local `work/scan-quality-overnight-<id>` branch from current `origin/main`, after checking that it contains the audited baseline `a26d952`. If the base has advanced, note which audited lines changed and reproduce each defect on the new base. A detached evidence worktree at `cbf69f09fbb41eacaa8ea40e6e6cb55ceec61e4c` is a convenient source of the seven pinned jobs. Keep test builds and repository edits in the implementation worktree.
3. Run `node overnight-scan/tools/preflight.mjs` from the original checkout after the fetch. Use `--evidence <evidence-worktree>` to verify evidence bytes by hash. Use `--clips <directory>` if the originals moved. Record actual FFmpeg/ffprobe, COLMAP, Brush, Node and splat-transform versions. Check actual help before passing experimental flags. Run the project doctor, install the lockfile in the implementation worktree, and capture baseline unit, build, marketplace, and simulated-scan results. A baseline failure goes in the ledger with its exact environment.
4. Resolve clips from the original checkout's `var/spike/clips` or an explicit override. Record input SHA-256 for actual training runs. Locate `var/tools/colmap/bin/colmap.exe` and `var/tools/brush/brush_app.exe` in the original checkout. The scan worker accepts `SCAN_COLMAP` and `SCAN_BRUSH` as absolute paths. Use `node node_modules/@playcanvas/splat-transform/bin/cli.mjs --help` from the implementation worktree for the pinned converter.
5. Keep the evidence and inputs read-only. Start all test servers on loopback with a distinct `SCAN_ROOT` inside the run directory, a fresh build via `SCAN_DIST` if needed, and a free `SCAN_PORT`. Set retention high enough for the isolated run or copy accepted jobs to a separate evidence directory before they can be pruned. The server prunes completed jobs at startup and after runs. Never target the primary `var/scans` for a benchmark. Set `QA_OUTPUT` per suite to keep its screenshots in the run.
6. Reserve the last 40 minutes for review and handoff. Start a GPU run only if its timeout and the remaining verification work fit. Begin with at least 20 GiB free if doing fresh reconstructions and keep an 8 GiB reserve. If available space falls below the reserve, finish artifact audit and code QA with existing inputs. Log unexpected GPU adapters, OOM, or thermal throttling when observed.

## 1. Split work by ownership

| Owner | Job | Proof |
|---|---|---|
| Coordinator | Deadline, experiment queue, comparison protocol, integrations, ledger, morning report | One decision per candidate, reproducible paths and commands |
| Viewer agent | Camera transform, robust fit, explicit object orbit and reset, resize and disposal | Same-SPZ A/B shots and orbit recording at desktop and mobile widths |
| Pipeline agent | Orientation and size provenance, staged benchmark, profile options, replay checks | Exact input hashes, versioned configs, stage timings, job identity, isolated outputs |
| Evidence reviewer | Source stills, qualitative grading, holdout and stress comparisons | Actual image review and explicit failures, preferably blinded to config |
| Regression agent | Test matrix and independent build checks | Unit, marketplace, simulated scan, optional real-file replay and known limitations |

The coordinator holds one GPU lease. Mask generation on GPU, COLMAP/Brush, GPU filtering, and GPU rendering share it. CPU asset analysis, code edits in disjoint paths, reading, and review can run in parallel. If the harness supports fewer agents, combine roles while retaining a separate review pass. Maintain enough context in `status.json` to resume without relying on a conversation transcript.

## 2. Highest-leverage sequence

### A. Lock the comparison and repair the viewer

Start with the existing SPZs. Use Golden for tuning, the 10.03-second take as a stress case, and Repeat for confirmation once a candidate is frozen. Establish repeatable views from documented camera poses. If original camera matrices are available after a re-run, use approximate source-camera views to check appearance and an orbit to test inspection. Record how angles were chosen. Compare camera and asset changes separately.

1. Reproduce the local-to-world centering issue on a synthetic nonzero-center fixture, then on the real files. Correct the transform with the actual applied orientation. Confirm axis conventions and an upright look against the reference photos.
2. Evaluate a robust bounds diagnostic and a subject-specific center or region of interest. Global percentiles help identify distant splats and can still fit room geometry. Keep a stable fitted view, subject-centered orbit, reset, bounded zoom, and a view that survives resize and route changes. Keep comparison camera parameters constant when testing assets.
3. Evaluate an asset cleanup on copies. Export a no-op round trip and verify count, pose, and appearance. Compare conservative scale-based filtering, then an object-region or isolated-floater trial if clear evidence supports it. Render before and after with the same camera. Pay attention to the mesh behind the backrest, arm supports, chair legs and wheels, and any holes introduced by filtering.
4. Prepare three views for every candidate considered for promotion and an orbit sample for finalists. Compare outputs visually to the stills. A pass in the old screenshot harness means the asset loaded. Keep renderer readiness, visual usefulness, and physical-phone verification as separate evidence.

### B. Improve reconstruction only where the evidence points

1. Re-run the unchanged baseline on Golden if the camera dataset is missing or unusable. Retain the extracted frames and chosen sparse COLMAP model inside the isolated run before the worker's normal cleanup. Record frame count, actual written dimensions, rotation from the input when available, alignment version, and profile values. Use checksummed immutable dataset copies or read-only reuse for comparisons.
2. Run the `Q1` and `Q2` candidates from the matrix in evidence-driven order. Use fixed alignment for single-variable changes to Brush training steps or training masks. For optional segmentation, use an official project source and local inference. Verify the installed Brush mask convention and a small sample. Manually inspect masks on front, side and rear frames, including mesh gaps, arms, and wheel silhouettes before launching a full run.
3. Evaluate capture coverage and orientation when faster tests fail to recover shape. Inspect registered camera positions across the orbit, timestamps, frame sharpness, exposure, and duplication near the start and end. Try one approved change to sampling or orientation-aware resolution at a time and rerun calibration for resized frames. Compare actual written dimensions. Do not increase the input frame count solely to satisfy a count. Keep all existing acceptance thresholds during experiments.
4. Freeze the most promising profile and apply it to Repeat, then review the stress case independently. If Repeat fails, downgrade the candidate and identify why before picking another one. Keep candidates separately labeled. Continue exploring a later camera or mask candidate if there is enough time for independent validation.

### C. Optimize the winning quality result

Only enter this step after a visual gate pass on Golden and Repeat. Reuse alignment when measuring training changes. Try a lower real long-edge target or a lower training budget independently, holding other settings fixed. Keep the fastest profile that clears the same visual floor. Report wall-clock capture-to-first-usable-view separately from recorded worker-stage totals. Include upload and queue time for local replay and measure viewer transfer/decode separately. Compare medians from repeated fast timings when time allows. Keep 3D quality as the priority even if the final runtime is higher.

### D. Integrate an opt-in candidate and verify

Choose a minimal entry point that makes the preset easy to try locally while retaining the existing default. Prefer a server-side opt-in config or CLI argument for the experiment. Include the selected profile in local provenance so it is reproducible. Keep old jobs readable. Existing job records validate exact keys, so an audit sidecar is often simpler than replacing the stored schema. Preserve normal camera permission behavior and do not change the separate prepared Sora route.

When time allows, replay one existing original through the local upload, processing and same-site preview flow. Record the input hash, resulting job ID, output ID, time to first usable view, and reload behavior. Label it as a replay. Keep validation for the actual phone, browser recording, and HTTPS tunnel on the morning checklist. Run unit, build, targeted browser, marketplace and simulated scan suites where applicable. Report a named check as passed only when observed. If an experimental resize profile or viewer change misses the gate, preserve its finding and leave the validated path available.

## 3. Self-review and stopping rules

Suggested checkpoints are 30 minutes for setup, 90 minutes for viewer diagnosis, 210 minutes for quality experimentation, 320 minutes for confirmation and possible speed work, and 360 minutes for the final handoff. Move time between phases based on evidence. Use the final 40 minutes for regression, comparison, and a readable report.

After each candidate, write the hypothesis, baseline, exact one-variable change, input hash, command, wall time, outputs, and actual findings to `experiments.jsonl`. Save failures with the exact code and logs. Give the reviewer source images and matched views, ask what became clearer and what regressed, then change the next experiment accordingly. Two inconclusive runs using the same strategy are a reason to move to another hypothesis. Avoid arbitrary repeated improvements to a metric that failed to predict a visible chair. If work is blocked, record the missing dependency and continue independent tasks using existing SPZs.

For timeout, OOM, or an interruption, checkpoint first and stop only processes owned by the run. Restart with details from the ledger and a fresh isolated output path. Keep partial runs separate from completed candidates. Protect the best observed candidate and its artifacts before cleanup. Keep final images, timing rows, settings, log excerpts, and the exact commands needed to open the result. Build `MORNING.md` from the template even if quality never passes. Record run-specific decisions, checked results, and the remaining milestone in the local worktree's handoff notes as appropriate.

## Output layout

```
var/overnight/
  LATEST.txt
  <run-id>/
    MORNING.md
    status.json
    preflight.txt
    experiments.jsonl
    datasets/
    jobs/
    comparisons/
    best/
    qa/
    logs/
```

`MORNING.md` should name the opt-in profile and the exact command or local path to open the best result, the worktree and commit, and what data is required to reproduce it. Keep the baseline and selected candidate available together.
