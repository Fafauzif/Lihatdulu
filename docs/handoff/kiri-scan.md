# KIRI-backed scan prototype

**Status:** upload-only prototype, verified against a labelled mock. No real KIRI
job has been submitted and no credit has been spent. The single authorized live
test command is at the end of this page.

The old local FFmpeg → COLMAP → Brush → CUDA scanner has been removed from the
active tree. It remains documented for provenance in
[scan-toolchain.md](scan-toolchain.md); nothing in the new path calls it.

## Flow

`/jual/pindai`

1. Choose an existing MP4 and preview it locally. Nothing is uploaded while the
   seller is choosing.
2. The page states that the file goes to KIRI Engine for cloud processing and
   requires an explicit consent checkbox before **Kirim ke KIRI Engine** works.
3. Upload progress, queue, processing, download/conversion, success and failure
   are shown as separate stages in Indonesian.
4. **Buka hasil 3D** opens `/pindai/:id`, which polls the same job and lazy-loads
   the existing SparkJS splat viewer.

Reloading either page resumes the stored job (`localStorage` key
`lihatdulu:kiri-job`) instead of starting a new upload. The server also reuses a
job for the same video bytes (SHA-256), so a double tap cannot submit twice.

## Server

| File | Responsibility |
|---|---|
| `server/kiri-server.mjs` | HTTP routes, raw MP4 upload, static `dist` + SPA fallback, safe logs |
| `server/kiri-service.mjs` | submit → poll with exponential backoff → download → finalize; resume on boot |
| `server/kiri-client.mjs` | the only live KIRI adapter; key stays here |
| `server/kiri-mock.mjs` | labelled simulation; synthetic chair PLY, no network |
| `server/kiri-jobs.mjs` | one `jobs/<uuid>/job.json` per job, atomic writes, dedupe, prune |
| `server/kiri-artifact.mjs` | PLY property/stride validation, SPZ validation, pinned conversion |
| `server/zip.mjs` | central-directory reader with CRC and zip-slip checks |
| `server/kiri-config.mjs` | `.env` parsing, modes and limits |
| `server/kiri-errors.mjs` | error codes, Indonesian copy, redaction |

No COLMAP, Brush, CUDA or FFmpeg is needed. The only external process is the
pinned converter already in `node_modules`, invoked with a fixed argument array:

```sh
node node_modules/@playcanvas/splat-transform/bin/cli.mjs result.ply --filter-nan result.spz
```

The browser never sees the key. It talks only to same-origin `/api/kiri/*`.

### Routes

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/kiri/config` | mode, public limits, poll bounds; never the key |
| POST | `/api/kiri/jobs` | raw MP4 body, `x-file-name`, returns a job DTO |
| GET | `/api/kiri/jobs/:id` | current stage, provenance, artifact URL |
| POST | `/api/kiri/jobs/:id/retry` | re-download/convert a retryable failed job; never re-submits |
| GET/HEAD | `/api/kiri/jobs/:id/result.spz` | the stored splat |

### Job lifecycle

`uploading → submitting → queued → processing → downloading → converting → ready`

or `failed` / `expired`. Polling starts at `KIRI_POLL_MIN_MS` and doubles up to
`KIRI_POLL_MAX_MS`; eight consecutive poll errors fail the job honestly. On
success the server downloads the KIRI ZIP, finds the splat PLY, validates its
header and 14 Gaussian properties, converts it, validates the SPZ magic and splat
count, then keeps only `job.json` and `result.spz`. The uploaded video, ZIP and
PLY are deleted after use. Failed or expired jobs are never reused by dedupe.

## KIRI API contract used

Source of truth: <https://docs.kiriengine.app/>.

- Base `https://api.kiriengine.app/api`, auth `Authorization: Bearer <key>`.
- Submit `POST /v1/open/3dgs/video` (multipart `videoFile`, `isMesh=0`,
  `isMask=1`) → `data.serialize`.
- Status `GET /v1/open/model/getStatus?serialize=` → `-1` uploading, `0`
  processing, `1` failed, `2` successful, `3` queuing, `4` expired.
- ZIP `GET /v1/open/model/getModelZip?serialize=` → `data.modelUrl`, valid for
  60 minutes. KIRI retains assets for three days.
- Limits enforced in the browser: MP4 up to 200 MB, 3 minutes, 1920×1080. The
  server repeats the type/size checks and never probes with FFmpeg.

## Configuration

Copy `.env.example` to `.env` and fill the key locally. `.env` is git-ignored.

| Variable | Default | Notes |
|---|---|---|
| `KIRI_API_KEY` | — | required for live mode; never logged or served |
| `KIRI_MOCK` | off | `1` runs the labelled simulation, ignores the key |
| `KIRI_API_BASE` | `https://api.kiriengine.app/api` | override only for a proxy |
| `KIRI_JOBS_ROOT` | `var/kiri` | keep job data outside `public/` |
| `KIRI_PORT` / `KIRI_HOST` | `8787` / `127.0.0.1` | |
| `KIRI_SERVE_DIST` | on | serve the built site and SPA routes |
| `KIRI_POLL_MIN_MS` / `KIRI_POLL_MAX_MS` | 5000 / 30000 | backoff bounds |
| `KIRI_KEEP_JOBS` | 50 | terminal jobs kept; active jobs are never pruned |
| `KIRI_MAX_*_BYTES`, `KIRI_MAX_SPLATS` | see `kiri-config.mjs` | hard caps |
| `KIRI_MOCK_FAIL` | — | `submit`, `process` or `zip`, for the harness only |
| `KIRI_MOCK_FAIL_ONCE` | off | fail once, then succeed |

There is no `KIRI_MODE` switch: mock wins when set, live when a key exists,
otherwise `unconfigured` (upload answered with 503 `missing_key`, UI explains).

## Commands

```sh
npm ci
npm run build              # dist is tracked and served by scan:serve
npm run test:unit          # 194 pass / 0 fail
npm run test:kiri          # 58 tests, mock adapter and HTTP boundary
npm run test:browser       # 26/26 existing marketplace acceptance
npm run test:kiri:browser  # 16/16 mock browser checks, screenshots in var/kiri-qa
npm run scan:mock          # http://127.0.0.1:8787/jual/pindai
npm run scan:serve         # live if KIRI_API_KEY is set
node scripts/lihatdulu-doctor.mjs --scan
```

The browser harness starts its own server on a free port with a fresh jobs root,
uses the real built `dist`, the real ZIP/PLY/SPZ validation and the real
converter. It checks consent, preview, stages, viewer and orbit, reload resume,
upload-page restore, no camera calls, failure + resend after a server restart,
390×844 layout and touch orbit, the marketplace/catalogue/3D routes, the Sora
routes, unknown IDs, and zero page errors or external requests. Screenshots and
`report.json` are written to `var/kiri-qa/` (git-ignored).

## One authorized live test

Nothing has been sent to KIRI yet. After supplying a key, this spends **one
credit** and uploads one clip:

```sh
cd C:/Users/fauzi/OneDrive/Documents/GitHub/Lihatdulu-kiri-scan
printf 'KIRI_API_KEY=%s\n' 'PASTE_KEY_HERE' > .env
npm run build
KIRI_MOCK=0 npm run scan:serve
```

Open `http://127.0.0.1:8787/jual/pindai`, choose one MP4, confirm the cloud
notice, and wait for **Siap dilihat**. Then open `/pindai/:id` and drag to orbit.
Remove `.env` afterwards. Do not commit the key, the video, `var/kiri`, or any
downloaded ZIP/PLY.

## Not in scope yet

- In-browser camera capture (deferred until one real clip passes end-to-end).
- Turning a scan into a catalogue listing, accounts, multi-user ownership.
- Queueing across processes; one server process owns the pollers.
- ZIP64 and encrypted KIRI archives (refused with a clear error, not guessed).
- Backups: `var/kiri` is local and git-ignored.
