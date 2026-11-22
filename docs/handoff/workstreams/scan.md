# Scan workstream — KIRI Engine prototype

## Current direction

LihatDulu does not reconstruct on a laptop anymore. The server samples a few
dozen stills from the seller's clip, sends them to
[KIRI Engine](https://docs.kiriengine.app/), validates the returned artifact and
serves it from storage we control. Two artifacts are supported: an SPZ splat
cloud from the 3DGS routes, and a GLB mesh from the featureless-object route
(`KIRI_INPUT=mesh`), which is the one that produced a recognizable chair. The
browser flow is **upload-only** for now: choose an existing MP4, preview it,
confirm the cloud send, watch the stages, then orbit the saved result.
In-browser camera capture comes only after one real clip has passed end-to-end.

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
- `/pindai/:id` resumable result page: SparkJS for SPZ, `GLTFLoader` +
  `OrbitControls` for a GLB mesh.
- `server/kiri-*` adapter (live + labelled mock), ZIP/PLY/GLB validation, pinned
  conversion for splats, disk-backed jobs, dedupe and retry.
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

Proven against the real KIRI API (one paid job, 22 November 2026):

- One 25.3 s portrait chair clip was accepted, uploaded (282 s), processed
  (~29 min) and returned a 281 000-splat SPZ (4.84 MB).
- The server downloaded the 53 MB ZIP, validated the PLY and converted it; the
  result page loads it, orbits on desktop and touch, and a reload resumes the
  same job without resubmitting.
- Total submit → ready was 37 min 54 s. Evidence: `var/kiri-live/report.json`.

Proven against the real KIRI API (overnight matrix, 22–23 November 2026, seven
of eight credits):

- **`KIRI_INPUT=mesh` produces a usable chair** from 101 stills of the golden
  clip: 815 094 triangles, one texture, 36 min, serial
  `b3217f601ab1485591c33bbea6951f3c`. Contact sheet:
  `docs/handoff/assets/kiri-mesh-chair.png`.
- The same clip through the 3DGS video and photo routes does not: room soup at
  9.5–11 m, or a melted blob.

Still unproven:

- The mesh is room-scale, so the room shell frames the result and the front view
  is a lit wall. A mesh-side subject crop is not implemented.
- Whether the mesh profile generalises to a second clip, and what it costs on a
  longer capture.
- KIRI key handling on the actual demo host, credit budget and retention.
- Phone/browser and network behaviour for a real seller.
- The in-browser camera path, deliberately deferred.

## Next step

One credit is left. Spend it on the mesh profile with a second clip
(`KIRI_MOCK=0 KIRI_INPUT=mesh npm run scan:serve`) to see whether the chair
result generalises, then decide between a mesh subject crop and capture
guidance. The repeat command and recorded numbers are in
[kiri-scan.md](../kiri-scan.md#repeating-the-live-test). Keep the camera deferred
until a second mesh model visibly passes.
