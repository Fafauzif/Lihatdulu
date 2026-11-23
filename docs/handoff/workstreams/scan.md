# Scan workstream — KIRI Engine prototype

## Current direction

LihatDulu does not reconstruct on a laptop anymore. The server samples a few
dozen stills from the seller's clip, sends them to
[KIRI Engine](https://docs.kiriengine.app/), validates the returned artifact and
serves it from storage we control. Two artifacts are supported: an SPZ splat
cloud from the 3DGS routes, and a GLB mesh. The shipped default is **Photo Scan
with automatic masking** (`KIRI_INPUT=photo`, Ultra), because it is the only
route that returns the chair alone — one credit, two to four minutes. The
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

Proven against the real KIRI API (overnight matrix and follow-ups, 22–23
November 2026; six credits spent on the current key, four left):

- **Photo Scan with masking on is the route that returns the chair alone.** 101
  stills from the golden clip, `modelQuality=3` (Ultra), `textureQuality=0` (4K),
  `isMask=1` → 2 136 020 B GLB, 1 m 2 s upload, 2 m 15 s KIRI, 3 m 42 s total,
  serial `2156501db4bf49ca9de872f929188431`. No crop, no cleanup heuristic. The
  same stills with `isMask=0` return 7.4 MB of room.
- **Every other route fails on this subject.** 3DGS video and 3DGS stills return
  room-scale soups (4.6–11 m extents), the featureless mesh returns a room shell
  around the chair, a second clip returns a bubble enclosing the chair, and a
  sharp-frame subset inflates the backrest. Table of serials and sizes in
  [kiri-scan.md](../kiri-scan.md).
- **The remaining defect is the capture, not the pipeline.** The backrest is a
  translucent knit net: KIRI's mesh is topologically closed, so the missing patch
  has no boundary to fill, and the 3DGS route that could carry it will not
  isolate the subject. `/jual/pindai` now states the four capture rules this
  produced, and the result page states the caveat under the viewer.

Still unproven:

- A capture of a matte, solid chair: no route was tried on one, so the defect
  may simply not occur there. This is the next honest experiment.
- Whether Photo Scan generalises beyond two clips, and what a longer capture
  costs in upload time.
- KIRI key handling on the actual demo host, credit budget and retention.
- Phone/browser and network behaviour for a real seller.
- The in-browser camera path, deliberately deferred.

## Next step

Four credits are left. The cheapest decisive experiment is a **matte, solid
upholstered chair** through the shipped default (`KIRI_MOCK=0 npm run scan:serve`)
— same command, one credit, and it tests the diagnosis rather than repeating the
net-back chair. Judge it on the four matched poses before spending a second
credit. Keep the camera deferred until one capture visibly passes.
