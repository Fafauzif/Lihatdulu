# LihatDulu

A secondhand-furniture marketplace in Indonesian: browse a catalogue with real
condition photos, inspect a product in 3D, place it in a room, and — for sellers
— record one slow lap around a piece of furniture and get a rotatable 3D result
back from [KIRI Engine](https://docs.kiriengine.app/).

The competition release is one judging walkthrough, one local dev setup, and one
runbook for the live scan host.

## Judge walkthrough (5 minutes, no account, no key)

1. **Buyer walkthrough — `/`** → the catalogue. Open `/barang/sora` for the prepared
   cabinet: original photos, condition notes, seller measurements, and the
   prepared Sora video walkthrough with room placement. **Putar 3D** and **Coba
   di ruang** sit beside **Gambar** and **Kondisi (3)**.
2. **Saved real scan — `/pindai/demo-chair`** → a real chair captured on a phone,
   scanned by KIRI, cleaned locally. It opens on **Foto asli** with the original
   photo directly under the tabs, because the mesh still sees through its mesh
   back (18,8 % of the silhouette). **Hasil halus** and **Pindaian asli** stay one
   tap away, and an explicit tab choice survives a reload of this result.
   Nothing here contacts KIRI.
3. **Your own scan — `/jual/pindai`** → record with the rear camera or pick a
   video. The page explains the cloud upload, asks for explicit consent, shows
   upload/queue/processing stages, and opens `/pindai/:id`. Refreshing resumes
   the same job instead of submitting again. On the static public site the page
   says **Demo statis** instead, disables sending, and leads with the saved chair.

Mock mode is labelled *Mode simulasi* on screen and spends no credits; live mode
is labelled by the reason line under the viewer. The offline chair explorer is
still at [`docs/handoff/explore/chair-explore.html`](docs/handoff/explore/chair-explore.html)
and opens by double-click.

## Local development

```bash
npm ci
npm run build          # dist/ is build output; it is committed for static hosts
npm run dev            # app on http://127.0.0.1:5173, /api proxied to :8787
npm run scan:serve     # scan backend (live KIRI when KIRI_API_KEY is set)
npm run scan:mock      # scan backend in labelled mock mode, no credits
```

Tests:

```bash
npm run test:unit      # node --test, app + server + refinement
npm run test:browser   # V8 marketplace acceptance in Chromium
npm run test:kiri      # scan API, transcode, recorder, upload rules
npm run test:kiri:browser  # /jual/pindai -> job -> /pindai/:id, mocks only
```

`npm run test:kiri:browser` starts its own mock server and Chromium; it never
touches the network or a credit balance.

## Running the scan host

The scan host is one Node process that serves the built app and the scan API on
the same origin, so `/jual/pindai` and `/pindai/:id` work on refresh:

```bash
npm run build
KIRI_API_KEY=... KIRI_SERVE_DIST=1 KIRI_HOST=0.0.0.0 KIRI_PORT=8787 \
  KIRI_JOBS_ROOT=var/kiri npm run scan:serve
```

FFmpeg must be on `PATH`: iPhone records MP4 and Android records WebM, and the
server converts WebM before it reaches KIRI (`server/kiri-transcode.mjs`). The
job store is plain JSON plus artifacts under `KIRI_JOBS_ROOT`; keep that
directory on a volume and out of Git.

For a container host (any platform that runs a Dockerfile):

```bash
docker build -t lihatdulu .
docker run -p 8787:8787 -e KIRI_API_KEY=... -v lihatdulu-jobs:/app/var/kiri lihatdulu
```

Judge phones need **HTTPS** for `getUserMedia`; plain `http://<lan-ip>` shows the
recording fallback instead of the live camera. `vercel.json` fixes deep links on
the static Vercel deployment (`/beli`, `/jual`, `/jual/pindai`, `/pindai/:id`
all reach the app), but that static host cannot run the scan backend — the
upload API needs a process with FFmpeg and disk.

## Layout

- `src/main.js`: navigation, shell, shared cards and controller.
- `src/discovery*.js`: filters, validation, taxonomy and prepared references.
- `src/product-views.js` / `product-media.js`: product, store and condition evidence.
- `src/buyer-records.js` / `buyer-views.js`: local drafts, immutable summaries and review.
- `src/market-state.js`: cart, seller edits, collections, stable fee groups.
- `src/inspection.js` / `engine.js`: retained models, motions and room geometry.
- `src/video-capture.js` / `video-state.js`: prepared Sora seller journey.
- `src/scan-*.js`: `/jual/pindai` recorder, upload states and `/pindai/:id` viewer.
- `server/kiri-*.mjs`: KIRI adapter, job store, transcode, refinement, HTTP surface.
- `public/`: retained models, media, demo scan and fonts.
- `docs/handoff/`: start here for provenance, decisions and the scan runbook.

## Docs

- [docs/handoff/START_HERE.md](docs/handoff/START_HERE.md) — current brief and workstreams.
- [docs/handoff/kiri-scan.md](docs/handoff/kiri-scan.md) — scan pipeline, routes, measurements.
- [docs/handoff/refinement.md](docs/handoff/refinement.md) — what the free cleanup stage fixes.
- [docs/handoff/kiri-release.md](docs/handoff/kiri-release.md) — this release's verification log and gates.
