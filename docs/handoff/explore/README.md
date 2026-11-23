# Chair explorer (single file)

`chair-explore.html` is a self-contained viewer for the best KIRI result: the
saved `photo-ultra-mask-clean.glb` (21 769 triangles, Photo Scan Ultra, masking
on, 101 stills from `golden-chair.mp4`). Three.js, `GLTFLoader`, `OrbitControls`
and the GLB itself are inlined as base64, so the file opens by double-click with
**no server, no network and no API key**.

What it does:

- orbit with mouse drag or touch, zoom with the wheel or a pinch
- **Normal** view (`MeshNormalMaterial`) — the backrest hole stays a hole, which
  is how the missing surface was proven not to be a shading artifact
- **Wireframe**, **Putar otomatis**, exposure slider, reset, and **Unduh PNG**
- reports the measured triangle count and model height

## Rebuilding

The bundle is built with the rolldown binary that ships with Vite, then inlined
by `build-explore.mjs`. From the repository root:

```sh
./node_modules/.bin/rolldown docs/handoff/explore/entry.js \
  --format iife --minify --file var/kiri-overnight/explore/bundle.js
node docs/handoff/explore/build-explore.mjs \
  var/kiri-overnight/photo/photo-ultra-mask-clean.glb \
  var/kiri-overnight/explore/chair-explore.html
```

The GLB is a local, git-ignored artefact from the live KIRI run; only the built
HTML is committed.

## Checked

Opened from `file:///` in Chromium (SwiftShader), 1280×820 at 2× and 390×844:

- `__explore.ready` true, 21 769 triangles, height 0.89 m
- drag changed the azimuth 32.6° → 113.8°; auto-rotate reached 146.3°; reset
  returned 32.5°
- texture, normals, wireframe and exposure all render; no page or console errors
- no network requests at all (the only non-`file:` URL is a `blob:` the browser
  creates itself)
- phone layout: `scrollWidth === clientWidth === 390`, stage 56vh

The defects are real and stay visible in every view: a hole in the backrest, a
gas-lift column reduced to a thin skin, and melted chrome on the base.
