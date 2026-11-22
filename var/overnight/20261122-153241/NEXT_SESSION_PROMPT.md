# Next-session prompt — LihatDulu scan-quality continuation

> **Status: consumed.** This was the prompt that started the continuation session (2026-11-22
> 16:40–19:40 +07:00). That session is closed as *best diagnostic result*; read the
> "Continuation session" section of `HANDOFF.md` and `MORNING.md` instead of re-running this prompt.
> The state it describes (HEAD `6363101`, `dist` baseline) is now seven commits and HEAD `d001013`.

Copy everything between the lines into a fresh DeepSeek Harness session opened in
`C:\Users\fauzi\OneDrive\Documents\GitHub\Lihatdulu` (the original checkout). The previous run was paused
early; this prompt is self-contained.

---

Read `AGENTS.md`, then `overnight-scan/START_HERE.md`, `AUDIT.md`, `RUNBOOK.md`, `EXPERIMENTS.json`,
`ACCEPTANCE.md`, `MORNING_TEMPLATE.md`. Then read the paused-run handoff:
`var\overnight\20261122-153241\HANDOFF.md`, `var\overnight\20261122-153241\MORNING.md`,
`var\overnight\20261122-153241\analysis\DIAGNOSTICS.md`, and the experiment ledger
`var\overnight\20261122-153241\experiments.jsonl`. Continue that run — do not start over, and do not redo
work already recorded as done.

State to inherit:
- Original checkout `C:\Users\fauzi\OneDrive\Documents\GitHub\Lihatdulu` must stay read-only for this work
  (current branch `feat/scan-video-study`, HEAD `c4b3192`, only `overnight-scan/` untracked).
- Implementation worktree `C:\Users\fauzi\OneDrive\Documents\GitHub\Lihatdulu-overnight-20261122-153241`,
  branch `work/scan-quality-overnight-20261122-153241`, base `a26d952`, one local commit `6363101`
  (viewer transform/orbit/reset/pose-API fix + `scripts/qa-scan-views.mjs` + 9 tests). `node_modules` is
  installed; `dist/` is currently the committed baseline, so run `npm run build` before any preview.
- Pinned evidence worktree `C:\Users\fauzi\OneDrive\Documents\GitHub\Lihatdulu-evidence-cbf69f0` @ `cbf69f0`.
- Run directory `C:\Users\fauzi\OneDrive\Documents\GitHub\Lihatdulu\var\overnight\20261122-153241`
  (registered in `var\overnight\LATEST.txt`). It contains preserved aligned Golden dataset, Brush PLYs,
  candidate SPZs/jobs, reference stills, viewer before/after evidence, stats and helper scripts.
- Best result so far: `golden-q2-6000-sph20` = 6000-step Brush on Golden + subject-sphere cleanup of the
  PLY (centre from COLMAP camera-ray intersection `3.412,2.309,2.149`, radius 2.0; 5 958 splats, 124 705 B).
  Job fixture `6bbc9bf5-e44b-4989-99cf-4fd7852634ff`, copied under
  `var\overnight\20261122-153241\best\open`. Renders: `best\chair-candidates-sheet.jpg`,
  `best\04-az210-el015-d1000-viewer.png`, `comparisons\candidate-matrix.jpg`.
- Key finding: percentile-only framing does not isolate the chair (scans are room-scale). The cleanup that
  works is a PLY-side sphere around the aligned camera-axis intersection, filtered with
  `var\overnight\20261122-153241\tools\filter_splat_ply.py` (do NOT use splat-transform `--filter-sphere`;
  it maps the centre through an internal transform and is unreliable). `--filter-value` scale/opacity
  thresholds are linear.
- Constraints: one GPU lease (no concurrent Brush/COLMAP/WebGPU; run SwiftShader renders serially), keep the
  primary checkout, original clips and existing `var/scans` jobs untouched, never serve the primary
  `var/scans` (use the run-local `jobs` root, `SCAN_KEEP` high enough), keep changes on the local branch,
  evidence local. Skip photo-only fallback work; keep the prepared Sora flow separate.

Do next, quality first:
1. Verify the committed viewer fix end-to-end: rebuild, run the matched-pose harness and complete
   `--orbit-proof` (desktop drag + touch reset), 390×844, resize and route re-entry; run
   `npm run test:unit` (expect 206/206), `npm run test:browser`, `node scripts/verify-scan.mjs` and record
   actual results.
2. Tune the subject cleanup on Golden's existing 6000-step PLY: sweep sphere radius ~1.8–2.6 (CPU only),
   optionally add a small opacity floor/scale cap, render the same four poses, compare against
   `comparisons\reference\ref-golden*.jpg`, and check thin arms, backrest mesh and wheel base. Freeze a
   candidate config only when it improves multiple angles with no lost chair detail.
3. Confirm on Repeat (clip `VID_20261121_184349140.mp4`): reuse its retained worker frames from
   `var\scans\a3e551df-7e05-4d0c-8146-d2a686a8d30a\frames`, align with COLMAP, compute its own ray target,
   Brush 6000, sphere-clean, render and grade. Then give the 10.03 s stress take
   (`VID_20261121_184212135.mp4`, job `f4755525-…`) its own verdict. Only after Golden+Repeat pass, promote
   the frozen config.
4. Integrate the validated cleanup as an opt-in pipeline profile (e.g. `SCAN_PROFILE=chair` in
   `server/scan-pipeline.mjs`): after alignment compute the subject centre from camera axes, filter the
   Brush PLY with the sphere (+ optional safe caps), convert to SPZ, and record the profile in provenance.
   Keep the existing default and job schema compatible; add unit tests.
5. Run the full regression set in the worktree, keep matched before/after and orbit evidence, and finish
   with `MORNING.md` per the template: best result and exact open command first, matched renders, measured
   timings, branch/commit, test results, and the remaining physical-phone checks. If no candidate clears the
   visual gate, present the strongest diagnostic result and state exactly what still fails.

Timebox this continuation to what remains of the six-hour budget (or a fresh six hours if the owner
confirms); reserve the last 40 minutes for independent review, verification and handoff. Save a checkpoint
after each meaningful experiment and continue around blockers using the existing SPZs/jobs. Begin now.

---

## Optional short version

> Continue the paused LihatDulu scan-quality run. Read `overnight-scan/` docs, then
> `var/overnight/20261122-153241/HANDOFF.md` and `MORNING.md`; inherit the worktree
> `../Lihatdulu-overnight-20261122-153241` (branch `work/scan-quality-overnight-20261122-153241`, commit
> `6363101`). Verify the viewer fix, tune the Golden sphere-cleanup (best so far: 6000-step Golden +
> sphere 2.0 at camera-ray centre), confirm on Repeat, verdict the 10.03 s stress take, integrate the
> cleanup as an opt-in pipeline profile, run regressions and finish `MORNING.md`. Keep the primary checkout,
> clips and scan jobs untouched, one GPU lease, evidence local.
