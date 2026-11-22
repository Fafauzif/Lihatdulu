# LihatDulu overnight scan quality run

**Goal:** Wake up to the best inspectable 3D chair the existing footage can support, with evidence of what improved. Optimize speed after choosing a quality winner. An integrated winner is opt-in.

## Start on the Helios

1. Extract the ZIP into the LihatDulu checkout that contains `package.json` and `AGENTS.md`. The expected location is `C:\Users\fauzi\OneDrive\Documents\GitHub\Lihatdulu\`. The archive adds the single folder `overnight-scan\`.
2. Open DeepSeek Harness in that checkout. Select **DeepSeek V4.1 Flash 1017** and **max effort**. Paste the contents of [PASTE_INTO_DSH.md](PASTE_INTO_DSH.md) as one message. Give DSH access to the project workspace and pinned local tools. For the six-hour run, leave the laptop plugged in and awake.
3. In the morning, open `var\overnight\LATEST.txt` in the original checkout and then `MORNING.md` in the run directory it names. The report links to the comparison images, viewer or local command, Git branch, and actual winning result when one passes.

## What comes with the run

| File | Use |
|---|---|
| [AUDIT.md](AUDIT.md) | Findings from the existing scans and code, including measured failure modes and diagnostic renders |
| [RUNBOOK.md](RUNBOOK.md) | Execution order, budgets, branch isolation, recovery, review, and integration |
| [EXPERIMENTS.json](EXPERIMENTS.json) | Ordered experiment candidates and single-variable comparisons |
| [ACCEPTANCE.md](ACCEPTANCE.md) | Evidence and conditions required for a usable result |
| [MORNING_TEMPLATE.md](MORNING_TEMPLATE.md) | Handoff structure |
| [evidence/lock.json](evidence/lock.json) | Pinned evidence commit and per-take files and digests |
| [tools/preflight.mjs](tools/preflight.mjs) | Read-only check for inputs, Git refs, tool candidates, and free space |

The run uses the existing chair recordings when present. The physical phone test remains a later step. The study evidence can be fetched separately and the original recordings and outputs stay local.
