# Scan workstream — KIRI Engine prototype

## Current direction

LihatDulu does not reconstruct on a laptop anymore. The server submits a video to
[KIRI Engine](https://docs.kiriengine.app/), gets a 3DGS result back, validates
and converts it, and serves the SPZ from storage we control. The browser flow is
**upload-only** for now: choose an existing MP4, preview it, confirm the cloud
send, watch the stages, then orbit the saved result. In-browser camera capture
comes only after one real clip has passed end-to-end.

Detailed architecture, configuration and the live-test command:
[kiri-scan.md](../kiri-scan.md).

## Why the reset

The previous `feat/scan-video-study` work proved that FFmpeg → COLMAP 4.2.1 →
Brush 0.3.0 could reconstruct real chair clips on the Helios, but it required a
CUDA GPU, pinned local tools and minutes of processing per clip. The owner
replaced that experiment with a KIRI-backed prototype so the demo does not
depend on the laptop GPU or a local tool installation. The old evidence remains
in [scan-toolchain.md](../scan-toolchain.md), marked historical.

## What is in the tree

- `/jual/pindai` upload + preview + consent + stages.
- `/pindai/:id` resumable result page with the existing SparkJS viewer.
- `server/kiri-*` adapter (live + labelled mock), ZIP/PLY validation, pinned
  conversion, disk-backed jobs, dedupe and retry.
- `npm run scan:serve`, `npm run scan:mock`, `npm run test:kiri`,
  `npm run test:kiri:browser`.
- No COLMAP, Brush, CUDA or FFmpeg references in the active path.

## Acceptance

Proven in mock mode on this branch:

- Full flow from MP4 selection to orbitable `/pindai/:id`, including reload
  resume without a second job.
- Failure + explicit resend after a server restart, one job per attempt.
- 390×844 layout, touch orbit, no camera request anywhere.
- Marketplace, catalogue, authored 3D and Sora routes unchanged: 26/26 existing
  browser checks.
- No page errors, failed app responses or external requests in the mock run.

Still unproven:

- One authorized live KIRI job with a real chair clip; quality, turnaround and
  SPZ size are unknown.
- KIRI key handling on the actual demo host, credit budget and retention.
- Phone/browser and network behaviour for a real seller.
- The in-browser camera path, deliberately deferred.

## Next step

Run the single authorized live test in
[kiri-scan.md](../kiri-scan.md#one-authorized-live-test). Record the clip, the
KIRI serial, stage timings, the resulting SPZ size and a viewer screenshot at
1440 and 390 px. Only then decide whether to add the camera.
