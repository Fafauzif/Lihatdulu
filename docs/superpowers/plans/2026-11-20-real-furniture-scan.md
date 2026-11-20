# Real Furniture Scan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A seller films one real chair through `/jual/pindai` on a phone, the demo laptop reconstructs it with FFmpeg → COLMAP → Brush → SPZ while reporting honest stages, and the finished splat opens as a same-site buyer preview at `/pindai/:id` with provenance and stills.

**Architecture:** One Node process on the demo laptop serves the built Vite site, SPA routes and `/api/scans`, owns a disk-backed job store under `var/scans/`, and runs one in-process worker that shells out to pinned CLIs with fixed argument arrays. The frontend adds two lazy routes: a capture page with `getUserMedia` + `MediaRecorder`, and a preview page that polls the job and lazily mounts a SparkJS viewer. The prepared Sora journey is untouched and stays clearly labelled.

**Tech Stack:** Vite 8, plain ES-module JavaScript, Three.js 0.186, `@sparkjsdev/spark` 2.4.0, Node 24 `node:http` (no framework, no database), FFmpeg, COLMAP 4.2.1, Brush 0.3.0, `@playcanvas/splat-transform` 3.12.0 (worker-side conversion), Playwright.

**Spec:** [scan workstream](../../handoff/workstreams/scan.md) · [current brief](../../handoff/context/CURRENT.md) · [decisions](../../handoff/decisions.md)

## Decisions this plan fixes

| Area | Decision |
|---|---|
| Serving | `server/scan-server.mjs` serves `dist/` + SPA fallback + `/api/scans` on `127.0.0.1:8787`. Vite dev proxies `/api` to it. HTTPS for phones comes from `cloudflared tunnel --url http://127.0.0.1:8787`. |
| Upload | One `POST /api/scans?title=…&w=…&d=…&h=…&note=…&device=…&cid=…` with the video as the raw body (`Content-Type` allowlist, `Content-Length` required, 100 MB cap). `cid` is the client idempotency key for retries. No multipart parser, no new server dependency. |
| Job store | `var/scans/<uuidv4>/` with atomically written `job.json`, frames, logs, clip and `output/`. Keep 10 finished jobs; no database. |
| Worker | In-process single worker; queue max 3; one job runs at a time. CLIs spawned with fixed argument arrays, no shell, per-stage timeouts. |
| Artifact | Brush PLY → `splat-transform … --filter-nan … .spz`; cap 60 MB and 2.5 M splats. Result served same-origin from the job folder. |
| Routes | `/jual/pindai` (bare capture page) and `/pindai/:id` (buyer preview inside the site shell). `/jual` gets one new entry card; Sora routes unchanged. |
| Viewer | SparkJS 2.4.0 in its own lazy module with its own `WebGLRenderer`; never mixed with the GLB inspection viewer. |
| Truth | Dimensions are seller-measured and labelled as such. "Condition photos" are frames extracted from the same clip, labelled "Bingkai dari rekaman". Provenance always states it is a new scan, not the prepared Sora example. |
| Tests | Fake pipeline + fake camera in automated tests; no test needs a GPU or a real clip. The physical phone run stays a manual, required gate. |
| Deploy | Do not commit rebuilt `dist/` in this work; the demo laptop builds it. Route HTML regeneration for the public deploy remains a separate release step. |

## Global Constraints

- Node `24.19.0` on the demo laptop; repo floor is `^20.19.0 || >=22.12.0`. Do not downgrade.
- Keep Vite, plain JavaScript, CSS and Three.js. No server framework, no ORM, no database, no auth service, no cloud API at runtime.
- All user-facing copy is natural Indonesian. Do not introduce English UI strings.
- Do not change catalogue IDs, prices, dimensions, media provenance, buyer/seller contracts or the prepared Sora flow.
- Upload cap `104857600` bytes; clip `8–45 s` (server accepts `7–50 s`); at least 60 extracted frames; at least 20 registered frames and 30 % registration.
- Queue `3`; retention `10`; min free disk `5 GiB`; artifact cap `62914560` bytes / `2500000` splats.
- Tool timeouts: ffprobe 15 s, ffmpeg 180 s, COLMAP feature 600 s, matcher 900 s, mapper 1 800 s, Brush 3 600 s, convert 600 s.
- Stage vocabulary is exactly `queued, validating, extracting, aligning, reconstructing, finalizing, ready, failed`.
- Job IDs are UUIDv4 and are the capability. No job list endpoint, no absolute paths in responses, no `..` path joins, `Cache-Control: no-store` on API responses.
- Camera is requested only after an explicit tap on `/jual/pindai`, only when `window.isSecureContext`; all tracks stop on stop, retake, route exit and `pagehide`.
- `var/` stays out of git. Tests and QA artifacts stay outside `dist/`.

## Review Focus

1. **Camera permission is denied, dismissed, or the page is opened over plain HTTP on a phone.** The page must explain what to do in Indonesian, keep the retake path visible, and never leave a spinner or request camera on mount. Pinned in Task 8 (`cameraErrorCopy`) and Task 12 (denied context).
2. **The browser cannot record (no `MediaRecorder`, unsupported MIME, zero-byte blob).** Upload must be disabled with an honest reason, no job may be created, and the seller must still be able to retake. Pinned in Task 8 (`pickRecorderMime`) and Task 12.
3. **Upload is interrupted (tunnel drop, laptop sleep, user leaves).** The finished clip and typed metadata survive in-session, retry uploads once without creating a second ready job, and no job stays non-terminal forever. Pinned in Tasks 4, 7 and 9, exercised in Task 12.
4. **Footage is unusable (too short, blurry, object never circled).** The worker fails with a specific reason and retake guidance instead of shipping a broken splat. Pinned in Task 6 threshold tests, exercised in Task 12 fake-failure path.
5. **The splat is too heavy or WebGL2 is unavailable on the phone.** The preview must keep provenance, stills and navigation usable, with a retry, instead of a blank canvas. Pinned in Task 11 and asserted in Task 12.

## Out of scope

- Creating a catalogue listing from a scan; scans stay a separate preview.
- Multiple workers, GPU service, queue persistence across restarts, accounts, ownership or public sharing.
- Changing the prepared Sora clip, its evidence flow or its labels.
- Committing a rebuilt `dist/` or changing the public deploy pipeline.

---

### Task 1: Prove reconstruction on the Helios

Human-run on the Acer Predator Helios Neo 16 with a real chair. The agent may assist by reading commands and recording results, but must not fake this gate.

**Files:**
- Create: `docs/handoff/scan-toolchain.md`
- Modify: `.gitignore` (add `var/`)

**Interfaces:**
- Produces: the recorded commands, versions, timings and artifact numbers that Tasks 5, 6 and 13 consume. Task 5's `BRUSH_ARGS_TEMPLATE` and analyzer line are copied from this file.

- [ ] **Step 1: Install the pinned tools on the Helios**

```powershell
winget install --id Gyan.FFmpeg -e
winget install --id Cloudflare.cloudflared -e
# COLMAP 4.2.1 CUDA build and Brush 0.3.0 Windows build:
# https://github.com/colmap/colmap/releases/download/4.2.1/colmap-x64-windows-cuda.zip
# https://github.com/ArthurBrussee/brush/releases/download/v0.3.0/brush-app-x86_64-pc-windows-msvc.zip
# Extract to C:\tools\colmap and C:\tools\brush, add both folders to PATH.
```

Expected: `ffmpeg -version`, `ffprobe -version`, `colmap -h`, `brush --help` and `nvidia-smi` all run in a normal terminal.

- [ ] **Step 2: Inventory in a normal terminal, not inside an agent sandbox**

Run: `node scripts/lihatdulu-doctor.mjs --scan`
Expected: `ffmpeg`, `ffprobe`, `colmap`, `brush`, `nvidia-smi` and `cloudflared` report `OK` or `exit 0` with a version line. If a tool reports `EPERM`, the shell is sandboxed; rerun outside it.

- [ ] **Step 3: Record the exact Brush help output**

Run: `brush --help`
Expected: paste the full output into a fenced block in `docs/handoff/scan-toolchain.md`, then extract the train command, dataset argument position, export-path flag, step/iteration cap and splat cap.

- [ ] **Step 4: Capture one real clip**

Film one stationary matte chair or stool with texture, rear camera, one lens, 1080p: slow orbit at two heights, overlap every view, object fills the frame, 30–45 s, no blur, moving parts closed. Save privately as `var/spike/chair.mp4` (never committed).

- [ ] **Step 5: Extract frames and record the count**

```powershell
ffmpeg -hide_banner -loglevel error -i var\spike\chair.mp4 -vf "fps=3,scale=1280:-2" -q:v 2 var\spike\frames\%04d.jpg
(Get-ChildItem var\spike\frames\*.jpg).Count
```

Expected: roughly 90–135 frames. Record the exact filter string that worked in PowerShell.

- [ ] **Step 6: Run sparse COLMAP and record registration**

```powershell
colmap feature_extractor --database_path var\spike\db.db --image_path var\spike\frames --ImageReader.single_camera 1 --ImageReader.camera_model OPENCV
colmap sequential_matcher --database_path var\spike\db.db --SequentialMatching.overlap 10 --SequentialMatching.loop_detection 0
colmap mapper --database_path var\spike\db.db --image_path var\spike\frames --output_path var\spike\sparse
colmap model_analyzer --path var\spike\sparse\0
```

Expected: a non-empty `sparse\0` and an analyzer line reporting registered images. Record the exact analyzer line verbatim; Task 6 parses it.

- [ ] **Step 7: Train and export with Brush**

Run the train command recorded in Step 3 against `var\spike` (images + `sparse\0`), with the fastest settings that still produce a recognizable chair. Record wall-clock time, output path, PLY size and the splat count printed by Brush. If the export needs a working directory, record the `cwd` used. Record whether the whole clip-to-preview run fits a 10-minute demo window; if it does not, reduce Brush steps, splat count or frame rate until it does, and record the quality trade-off.

- [ ] **Step 8: Convert to a web artifact and measure**

```powershell
npx --yes @playcanvas/splat-transform@3.12.0 var\spike\scan.ply --filter-nan var\spike\scan.spz
Get-Item var\spike\scan.spz | Select-Object Length
```

Expected: `scan.spz` exists. If it exceeds 60 MB or 2.5 M splats, run the decimation form and record it:

```powershell
npx --yes @playcanvas/splat-transform@3.12.0 var\spike\scan.ply --decimate 2000000 var\spike\scan-small.ply
npx --yes @playcanvas/splat-transform@3.12.0 var\spike\scan-small.ply --filter-nan var\spike\scan.spz
```

- [ ] **Step 9: Look at the result and judge it**

Open `scan.spz` in SuperSplat (<https://superspl.at/editor>) or the SparkJS demo on the Helios. Inspect the rear, legs, top and any crop, and compare it side by side with the source clip. Save a screenshot outside the repo (for example `C:\Users\fauzi\qa-scan\first-splat.png`). Write a go/no-go verdict and the capture change that would fix the biggest defect. Then repeat Steps 4–8 once as `chair-2.mp4` with that change and record whether the registered ratio stays within ±20 % and the artifact stays in the same size class; if it does not, the pipeline is not repeatable enough to build on.

- [ ] **Step 10: Fill the document and commit**

`docs/handoff/scan-toolchain.md` must contain: versions table; full `brush --help`; exact commands for frames, the three COLMAP stages, analyzer, Brush and conversion; timings per stage; total runtime; frame count; registered/total; PLY and SPZ sizes; splat count; the analyzer line; the go/no-go verdict. Add `var/` to `.gitignore`.

```bash
git add docs/handoff/scan-toolchain.md .gitignore
git commit -m "docs(scan): record Helios reconstruction spike"
```

If the verdict is no-go, stop and revise capture guidance before any further task. Do not build the app around an unproven pipeline.

---

### Task 2: Job store and state machine

**Files:**
- Create: `server/scan-jobs.mjs`
- Test: `tests/scan-jobs.test.js`

**Interfaces:**
- Produces: `STAGES`, `TERMINAL_STAGES`, `isJobId(value)`, `validateJob(record)`, `createJob(root, meta)`, `readJob(root, id)`, `writeJob(root, record)`, `updateJob(root, id, patch)`, `listJobs(root)`, `pruneJobs(root, keep = 10)`, `jobPaths(root, id)`.
- Record shape: `{schema:1, id, clientId, createdAt, updatedAt, stage, meta:{title,widthCm,depthCm,heightCm,conditionNote,device}, media:{contentType,bytes,durationS,width,height}, provenance:null, artifact:null, error:null}`. `clientId` is the client's idempotency key, `''` when absent.
- `artifact` shape: `{format:"spz"|"ply", bytes, splatCount, file, stills:[string]}`. `error` shape: `{code, message}`.
- Consumed by: Tasks 3, 4, 6, 7.

- [ ] **Step 1: Write the failing tests**

```js
const meta = { title: 'Kursi', widthCm: 58, depthCm: 63, heightCm: 84, conditionNote: '', device: 'Android', clientId: '' };
let root, job;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'scan-jobs-')); job = await createJob(root, meta); });

test('createJob writes a queued record under the root', async () => {
  assert.match(job.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(job.stage, 'queued');
  assert.equal(job.clientId, '');
  assert.equal(job.provenance, null);
  assert.ok((await readJob(root, job.id)).id === job.id);
});

test('validateJob rejects an unknown stage and a bad id', () => {
  assert.throws(() => validateJob({ ...job, stage: 'uploading' }), /Tahap/);
  assert.throws(() => validateJob({ ...job, id: '../x' }), /ID/);
  assert.equal(validateJob(job).id, job.id);
});
test('updateJob refuses to leave a terminal stage and bumps updatedAt', async () => {
  const ready = await updateJob(root, job.id, { stage: 'ready' });
  assert.ok(ready.updatedAt >= job.updatedAt);
  await assert.rejects(() => updateJob(root, job.id, { stage: 'extracting' }), /selesai/);
});
test('readJob returns null for traversal, missing and malformed ids', async () => {
  assert.equal(await readJob(root, '../package.json'), null);
  assert.equal(await readJob(root, '00000000-0000-4000-8000-000000000000'), null);
  assert.equal(await readJob(root, 'not-a-uuid'), null);
});
test('pruneJobs keeps 10 newest terminal jobs and never removes a live job', async () => {
  for (let i = 0; i < 12; i++) {
    const j = await createJob(root, meta);
    await writeJob(root, { ...j, stage: 'ready', updatedAt: new Date(Date.now() + i).toISOString() });
  }
  const live = await createJob(root, meta);
  await pruneJobs(root, 10);
  const jobs = await listJobs(root);
  assert.equal(jobs.filter((j) => TERMINAL_STAGES.includes(j.stage)).length, 10);
  assert.ok(await readJob(root, live.id));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/scan-jobs.test.js`
Expected: FAIL with `Cannot find module ... scan-jobs.mjs`.

- [ ] **Step 3: Implement the store**

Use `node:fs/promises`, `node:path`, `node:crypto`. `createJob` copies `clientId` from the parsed meta into the top-level field and omits it from `meta`. `writeJob` writes `${job.json}.tmp` then `rename` so readers never see a partial file. `readJob` returns `null` unless `isJobId(id)` and the file exists and validates. `updateJob` throws `Error('Pekerjaan sudah selesai.')` when the stored stage is terminal. Validation messages contain `Tahap` for an unknown stage and `ID` for a bad id. `pruneJobs` sorts terminal jobs by `updatedAt` descending, keeps the newest `keep`, removes the rest; never removes `queued`, `validating`, `extracting`, `aligning`, `reconstructing` or `finalizing`. `jobPaths(root, id)` returns `{dir, job, clip, frames, work, logs, output, result}` with `path.join(root, id, …)` and refuses ids that fail `isJobId`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/scan-jobs.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add server/scan-jobs.mjs tests/scan-jobs.test.js
git commit -m "feat(scan): add disk-backed job store"
```

---

### Task 3: Metadata and media validation

**Files:**
- Create: `server/scan-errors.mjs`, `server/scan-meta.mjs`
- Test: `tests/scan-meta.test.js`

**Interfaces:**
- `ScanError` extends `Error` with `code` and `status`; `ERROR_STATUS` maps codes to HTTP status.
- `parseScanMeta(searchParams) -> {title, widthCm, depthCm, heightCm, conditionNote, device, clientId}`; throws `ScanError('bad_metadata')`.
- `ALLOWED_MEDIA` = `['video/mp4', 'video/webm', 'video/quicktime']`; `mediaExtension(contentType) -> 'mp4'|'webm'|'mov'`, lowercasing and stripping parameters such as `;codecs=vp9`.
- Consumed by: Task 4.

- [ ] **Step 1: Write the failing tests**

```js
test('parseScanMeta normalizes comma decimals and trims text', () => {
  const meta = parseScanMeta(new URLSearchParams({ title: '  Kursi Kayu  ', w: '58,5', d: '63', h: '84', note: ' goresan ringan ', device: 'Android' }));
  assert.deepEqual(meta, { title: 'Kursi Kayu', widthCm: 58.5, depthCm: 63, heightCm: 84, conditionNote: 'goresan ringan', device: 'Android', clientId: '' });
});
test('parseScanMeta rejects missing, out-of-range and overlong values with bad_metadata', () => {
  const bad = [
    new URLSearchParams({ title: 'Kursi', w: '0', d: '63', h: '84' }),
    new URLSearchParams({ title: '', w: '58', d: '63', h: '84' }),
    new URLSearchParams({ title: 'x'.repeat(81), w: '58', d: '63', h: '84' }),
  ];
  for (const q of bad) assert.throws(() => parseScanMeta(q), (e) => e.code === 'bad_metadata' && e.status === 400);
});
test('mediaExtension accepts only the allowlist', () => {
  assert.equal(mediaExtension('video/webm;codecs=vp9'), 'webm');
  assert.equal(mediaExtension('VIDEO/MP4'), 'mp4');
  assert.equal(mediaExtension('text/html'), null);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/scan-meta.test.js`
Expected: FAIL with `Cannot find module`.

- [ ] **Step 3: Implement**

Title: trimmed 2–80 characters. Dimensions: numbers 1–1000, at most one decimal, reject `NaN`/empty/negative. Condition note: optional, trimmed, ≤200; default `''`. Device: optional, trimmed, ≤120; default `''`. `cid`: optional; if present it must be a UUIDv4, default `''`, otherwise `bad_metadata`. Unknown params ignored. `bad_metadata` → 400. `unsupported_media` → 415, `too_large` → 413, `not_found` → 404, `not_ready` → 409, `queue_full` → 429, everything else → 500.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/scan-meta.test.js`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add server/scan-errors.mjs server/scan-meta.mjs tests/scan-meta.test.js
git commit -m "feat(scan): validate scan metadata and media types"
```

---

### Task 4: HTTP API, static serving and fake pipeline

**Files:**
- Create: `server/scan-server.mjs`, `server/scan-fake.mjs`
- Create: `vite.config.js`
- Modify: `package.json` (scripts), `.gitignore` (`var/` if Task 1 did not)
- Test: `tests/scan-server.test.js`

**Interfaces:**
- `createScanServer({root, pipeline, host = '127.0.0.1', port = 0}) -> Promise<{server, url, close}>`.
- Pipeline contract: `pipeline(record, {root, updateStage}) -> Promise<{media, provenance, artifact}>`; calls `updateStage(stage, patch?)` for non-terminal stages only; throws `ScanError` on failure.
- `runFakePipeline(record, ctx)` writes stage transitions with ~20 ms delays, emits a 64-Gaussian fixture PLY, 3 SVG stills and provenance.
- `toScanDto(record) -> {id, stage, createdAt, updatedAt, meta, media, provenance, artifact: {format, bytes, splatCount, url, stills}, error}`; all URLs are relative to the same origin.
- `MAX_UPLOAD_BYTES = 104857600`, `MAX_QUEUE = 3`, `SCAN_KEEP = 10`.
- Routes: `POST /api/scans`, `GET /api/scans/:id`, `GET /api/scans/:id/result/:file`, `GET /api/scans/:id/frame/:index`; everything else under `/api` returns JSON 404. The result path keeps the artifact extension so SparkJS can detect the format from the URL.
- Consumed by: Tasks 7, 9, 10, 12.

- [ ] **Step 1: Write the failing API test**

```js
// before(): root = await mkdtemp(...); ({ url, close } = await createScanServer({ root, pipeline: runFakePipeline }));
// after(): await close();
// Keep the first job's id in a module-scope let so later tests can use it.
const created = await fetch(`${url}/api/scans?title=Kursi&w=58&d=63&h=84`, { method: 'POST', headers: { 'content-type': 'video/webm', 'content-length': String(clip.length) }, body: clip });
assert.equal(created.status, 201);
const { id } = await created.json();
let dto;
for (let i = 0; i < 100; i++) { dto = await (await fetch(`${url}/api/scans/${id}`)).json(); if (dto.stage === 'ready') break; await delay(25); }
const result = await fetch(url + dto.artifact.url);
assert.equal(result.status, 200);
assert.match(await result.text(), /^ply\r?\n/);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/scan-server.test.js`
Expected: FAIL with `Cannot find module ... scan-server.mjs`.

- [ ] **Step 3: Implement the server and fake pipeline**

- Reject non-allowlisted `Content-Type` (415), missing `Content-Length` (411), body over cap (413 before reading), bad metadata (400), queue full (429). Create the job only after those checks pass, then stream the body to `clip.<ext>` counting bytes, abort and mark failed on overflow.
- Queue: `active` plus `queue`; `enqueue(id)` starts the pipeline when idle and pumps on completion. On success set `stage:'ready'` with `media/provenance/artifact`; on `ScanError` set `stage:'failed'` with `{code,message}`; on unexpected error use `{code:'internal', message:'Pemrosesan gagal.'}`.
- Idempotency: when the created record's `clientId` is non-empty and a job with the same `clientId` was created in the last hour, return `200 {id}` for that job instead of creating a second one. A retried upload after a lost response must not start a duplicate reconstruction.
- `GET` DTO must never include absolute paths, the clip path or the job root. Map `record.artifact.file` to `url: '/api/scans/<id>/result/<artifact.file>'` and each still file name to `/api/scans/<id>/frame/<index>`.
- Result: 409 unless `stage === 'ready'`; 404 when `:file` is not exactly `record.artifact.file`; stream `output/<artifact.file>` with `Content-Type: application/octet-stream`, `Content-Length`, `Cache-Control: no-store`. Frame: integer index within `artifact.stills`, content type from extension.
- Static: serve `dist/` with a MIME map; non-file GETs fall back to `dist/index.html`; path containment via `path.resolve` + `startsWith`; 404 for files outside `dist`.
- Fake fixture: `writeFixtureSplat(file)` writes an ASCII PLY with 64 vertices and standard 3DGS columns (`x y z nx ny nz f_dc_0..2 f_rest_0..44 opacity scale_0..2 rot_0..3`), small scales, opacity `5`, rotation `1 0 0 0`. Stills are 320×200 SVG placeholders with a caption. `SCAN_FAKE_DELAY_MS` slows each stage (default 20) so tests can observe intermediate states. When `process.env.SCAN_FAKE_FAIL === '1'`, throw `new ScanError('alignment_failed', 'Uji kegagalan.')` after `reconstructing`.
- Add `vite.config.js` with `server.proxy['/api'] = 'http://127.0.0.1:8787'`. Add scripts `scan:api`, `scan:serve`, `scan:fake`; the `--fake`, `--api-only`, `--port` and `--host` parsing itself lands in Task 7. Add `var/` to `.gitignore`.

- [ ] **Step 4: Add limit and safety tests**

```js
test('rejects wrong media type, missing length, oversize body, bad metadata, queue full', async () => {
  const meta = 'title=Kursi&w=58&d=63&h=84';
  assert.equal((await post(`/api/scans?${meta}`, { type: 'text/html', length: 10 })).status, 415);
  assert.equal((await post(`/api/scans?${meta}`, { type: 'video/webm', length: null })).status, 411);
  assert.equal((await post(`/api/scans?${meta}`, { type: 'video/webm', length: MAX_UPLOAD_BYTES + 1, body: Buffer.alloc(1) })).status, 413);
  assert.equal((await post('/api/scans?title=&w=58&d=63&h=84', { type: 'video/webm', length: 10 })).status, 400);
});
test('never serves the source clip and never lists jobs', async () => {
  assert.equal((await fetch(`${url}/api/scans`)).status, 404);
  assert.equal((await fetch(`${url}/api/scans/${id}/clip`)).status, 404);
});
test('result and frames are 409 until ready and 404 for unknown ids', async () => {
  const gated = await post(`${url}/api/scans?title=Kursi&w=58&d=63&h=84`, { type: 'video/webm', length: 10, body: Buffer.alloc(10) });
  assert.equal((await fetch(`${url}/api/scans/${gated.id}/result/scan.spz`)).status, 409);
  assert.equal((await fetch(`${url}/api/scans/${gated.id}/frame/0`)).status, 409);
  assert.equal((await fetch(`${url}/api/scans/00000000-0000-4000-8000-000000000000`)).status, 404);
});
test('SPA fallback serves index.html and /api stays JSON', async () => {
  const page = await fetch(`${url}/beli`);
  assert.match(await page.text(), /<div id="app">/);
  const api = await fetch(`${url}/api/nope`);
  assert.match(api.headers.get('content-type'), /application\/json/);
});
test('traversal ids and encoded paths never escape root', async () => {
  for (const path of ['/api/scans/..%2F..%2Fpackage.json', '/api/scans/%2e%2e%2f%2e%2e%2fpackage.json', '/..%2fpackage.json'])
    assert.equal((await fetch(url + path)).status, 404);
});
test('duplicate clientId returns the same job without creating a second one', async () => {
  const cid = '6f1c2b7e-8a4d-4c3e-9f10-2b3c4d5e6f70';
  const query = `title=Kursi&w=58&d=63&h=84&cid=${cid}`;
  const first = await post(`/api/scans?${query}`, { type: 'video/webm', length: 10, body: Buffer.alloc(10) });
  const second = await post(`/api/scans?${query}`, { type: 'video/webm', length: 10, body: Buffer.alloc(10) });
  assert.equal(first.status, 201);
  assert.equal(second.status, 200);
  assert.equal((await second.json()).id, (await first.json()).id);
});
```

Add a `post(routeOrUrl, {type, length, body})` helper to the test file. To observe the 409 state, gate the fake pipeline behind a deferred promise that the test releases before asserting `ready`. On an idempotent hit, drain the request (`req.resume()`) before sending `200` so the client can finish its body.

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test tests/scan-server.test.js`
Expected: PASS, 7 tests. Run `node server/scan-server.mjs --fake --port 8788` in one terminal and `curl http://127.0.0.1:8788/api/scans` in another; expect a JSON 404/405, not an HTML page.

- [ ] **Step 6: Commit**

```bash
git add server/scan-server.mjs server/scan-fake.mjs vite.config.js package.json .gitignore tests/scan-server.test.js
git commit -m "feat(scan): add scan API with fake pipeline"
```

---

### Task 5: Tool runner and exact command builders

**Files:**
- Create: `server/scan-tools.mjs`, `server/scan-pipeline.mjs`
- Modify: `package.json`, `package-lock.json` (`@playcanvas/splat-transform` devDependency)
- Test: `tests/scan-pipeline.test.js`

**Interfaces:**
- `TOOL_NAMES = ['ffprobe','ffmpeg','colmap','brush','splatTransform']`.
- `resolveTool(name) -> {command, prefix: string[]}`; env overrides `SCAN_FFPROBE`, `SCAN_FFMPEG`, `SCAN_COLMAP`, `SCAN_BRUSH`, `SCAN_SPLAT_TRANSFORM`; throws `ScanError('tool_missing', '<install hint>')`. `splatTransform` defaults to `{command: process.execPath, prefix: [<repo>/node_modules/@playcanvas/splat-transform/bin/cli.mjs]}` so it works with `shell:false` on Windows; an env override returns `{command: <path>, prefix: []}`.
- `runTool(name, args, {cwd, timeoutMs, logPath, signal}) -> Promise<{ms}>`; appends stdout+stderr to `logPath`; throws `tool_timeout` / `tool_failed` with the last 20 log lines; kills the child on timeout or abort.
- `FRAME_FILTER` (exact string recorded in Task 1), `buildFfprobeArgs({clip})`, `buildExtractArgs({clip, framesDir})`, `buildFeatureArgs({database, images})`, `buildMatchArgs({database})`, `buildMapperArgs({database, images, sparse})`, `buildAnalyzeArgs({model})`, `buildBrushArgs({datasetDir, outputPly, workDir})`, `buildConvertArgs({inputPly, outputSpz})`, `buildDecimateArgs({inputPly, outputPly})`, `BRUSH_ARGS_TEMPLATE`.
- Consumed by: Task 6.

- [ ] **Step 1: Write the failing tests**

```js
test('buildExtractArgs uses the recorded filter and numbered output', () => {
  assert.deepEqual(buildExtractArgs({ clip: 'C:\\a\\clip.mp4', framesDir: 'C:\\a\\frames' }),
    ['-hide_banner','-loglevel','error','-i','C:\\a\\clip.mp4','-vf',FRAME_FILTER,'-q:v','2','C:\\a\\frames\\%04d.jpg']);
});
test('BRUSH_ARGS_TEMPLATE substitutes dataset and output placeholders', () => {
  const args = buildBrushArgs({ datasetDir: 'D:\\ds', outputPly: 'D:\\o.ply', workDir: 'D:\\w' });
  assert.ok(args.includes('D:\\ds'));
  assert.ok(!args.some(a => a.includes('{dataset}') || a.includes('{output}')));
});
test('runTool reports tool_missing for an unknown binary', async () => {
  process.env.SCAN_FFMPEG = 'definitely-not-a-real-binary';
  await assert.rejects(() => runTool('ffmpeg', ['-version'], { timeoutMs: 1000 }), (e) => e.code === 'tool_missing');
});
test('runTool maps a timeout to tool_timeout and appends the log', async () => {
  const logPath = join(await mkdtemp(join(tmpdir(), 'scan-tool-')), 'tool.log');
  process.env.SCAN_FFMPEG = process.execPath;
  await assert.rejects(
    () => runTool('ffmpeg', ['-e', 'setTimeout(() => {}, 5000)'], { timeoutMs: 50, logPath }),
    (e) => e.code === 'tool_timeout',
  );
  assert.equal((await stat(logPath)).isFile(), true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/scan-pipeline.test.js`
Expected: FAIL with `Cannot find module`.

- [ ] **Step 3: Implement the runner and builders**

`runTool` resolves the tool on every call, then uses `spawn(tool.command, [...tool.prefix, ...args], {cwd, windowsHide: true, shell: false})`, pipes chunks to the log file with `appendFile`, and resolves on `close`. Do not cache `process.env` at import time. Map a spawn `ENOENT` to `ScanError('tool_missing', …)`. Timeout: `setTimeout(() => child.kill(), timeoutMs)`, then reject `tool_timeout`. Signal: `signal.addEventListener('abort', () => child.kill())`. Install the converter once with `npm install --save-dev @playcanvas/splat-transform@3.12.0`; do not call `npx` at runtime.

Builders: fill the COLMAP flags from Task 1's recorded commands (starting point: `feature_extractor` with `--ImageReader.single_camera 1 --ImageReader.camera_model OPENCV`, `sequential_matcher` with `--SequentialMatching.overlap 10`, `mapper`, `model_analyzer --path <sparse>/0`). `BRUSH_ARGS_TEMPLATE` is copied verbatim from `scan-toolchain.md`, with `{dataset}` and `{output}` placeholders; `buildBrushArgs` substitutes them and returns the array. If Brush writes its export implicitly, the template has no `{output}` and the function appends nothing; Task 6 finds the single new `.ply`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/scan-pipeline.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add server/scan-tools.mjs server/scan-pipeline.mjs tests/scan-pipeline.test.js
git commit -m "feat(scan): add pinned tool runner and command builders"
```

---

### Task 6: Orchestration, provenance and thresholds

**Files:**
- Modify: `server/scan-pipeline.mjs`
- Create: `server/scan-provenance.mjs`
- Test: `tests/scan-pipeline.test.js`, `tests/scan-provenance.test.js`

**Interfaces:**
- `runRealPipeline(record, {root, updateStage, runTool = defaultRunTool, diskFree = defaultDiskFree}) -> Promise<{media, provenance, artifact}>`; `defaultRunTool` is `runTool` imported from `server/scan-tools.mjs`; `defaultDiskFree` is `async () => (await statfs(root)).bavail * (await statfs(root)).bsize`.
- `parseFfprobe(jsonText) -> {durationS, width, height, bytes}`; `parseRegisteredImages(text) -> number`; `parseSplatCount(text) -> number`; `findBrushOutput(workDir) -> string`.
- `buildProvenance({createdAt, media, frames, registered, timings, artifact, tools}) -> object`.
- Constants: `MIN_FRAMES = 60`, `MIN_REGISTERED = 20`, `MIN_REGISTERED_RATIO = 0.3`, `MIN_FREE_BYTES = 5 * 1024 ** 3`, `MAX_ARTIFACT_BYTES = 60 * 1024 ** 2`, `MAX_SPLATS = 2_500_000`, `TIMEOUTS`.
- Consumed by: Task 7, Task 10 (DTO provenance).

- [ ] **Step 1: Write the failing tests**

```js
test('runRealPipeline reports stages in order and returns provenance', async () => {
  const stages = [];
  const framesDir = join(root, 'frames');
  const calls = [];
  const record = await createJob(root, meta);
  const result = await runRealPipeline(record, {
    root,
    updateStage: async (stage) => { stages.push(stage); },
    diskFree: async () => MIN_FREE_BYTES,
    runTool: async (name, args) => {
      calls.push([name, args]);
      // Side effects so the pipeline's filesystem checks run for real:
      if (name === 'ffmpeg') for (let i = 1; i <= 90; i++) await writeFile(join(framesDir, `${String(i).padStart(4, '0')}.jpg`), 'x');
      if (name === 'colmap' && args[0] === 'model_analyzer') return { ms: 1, stdout: recordedAnalyzerLine };
      return { ms: 1, stdout: name === 'ffprobe' ? recordedFfprobeJson : 'Splats: 100000' };
    },
  });
  assert.deepEqual(stages, ['validating', 'extracting', 'aligning', 'reconstructing', 'finalizing']);
  assert.equal(result.provenance.frames.extracted, 90);
});
test('short footage fails with footage_short before COLMAP', async () => {
  // stub writes 40 frames; assert rejects with code footage_short and no colmap call
  await assert.rejects(() => runRealPipeline(record, ctxWithFrames(40)), (e) => e.code === 'footage_short');
  assert.ok(!calls.some(([name]) => name === 'colmap'));
});
test('poor registration fails with alignment_failed', async () => {
  // analyzer reports 5 of 90 registered
  await assert.rejects(() => runRealPipeline(record, ctxWithAnalyzer('5 of 90')), (e) => e.code === 'alignment_failed');
});
test('parseRegisteredImages reads the recorded analyzer line', () => {
  assert.equal(parseRegisteredImages(recordedAnalyzerLine), 78);
});
test('artifact over the size cap is decimated once then converted', async () => {
  // info reports 4000000 splats
  await runRealPipeline(record, ctxWithSplatCount(4_000_000));
  assert.equal(calls.filter(([name, args]) => name === 'splatTransform' && args.includes('--decimate')).length, 1);
  assert.equal(calls.filter(([name, args]) => name === 'splatTransform' && args.at(-1).endsWith('.spz')).length, 1);
});
test('buildProvenance never exceeds the DTO shape', () => {
  assert.deepEqual(Object.keys(buildProvenance({ createdAt: 'x', media, frames: { extracted: 90, registered: 78 }, timings, artifact, tools: {} })).sort(),
    ['artifact', 'frames', 'source', 'timings', 'tools']);
});
```

Replace `recordedAnalyzerLine` and `recordedFfprobeJson` with the real strings from `scan-toolchain.md`; the expected registered count `78` is whatever that line says. Implement `ctxWithFrames(n)`, `ctxWithAnalyzer(line)` and `ctxWithSplatCount(n)` as small helpers around the same stubbed `runTool`. The stub must create the frame files, `sparse/0` and one `.ply` so the pipeline's real filesystem checks are exercised.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/scan-pipeline.test.js tests/scan-provenance.test.js`
Expected: FAIL with `runRealPipeline is not a function`.

- [ ] **Step 3: Implement orchestration**

Order: `statfs` free-space check → `ffprobe` (7–50 s, video stream) → `extracting` + ffmpeg → count frames (< 60 → `footage_short`) → `aligning` + feature/match/mapper/analyzer → registered checks → build `work/dataset/` (copy `frames/` to `work/dataset/images` and `work/sparse/0` to `work/dataset/sparse/0`) → `reconstructing` + Brush with `cwd: work/dataset` → `findBrushOutput` → `splat-transform --info json` for count → decimate once if over `MAX_SPLATS` → convert to SPZ → size check → `finalizing` + copy stills (first, middle, last, largest) to `stills/000.jpg…` → select the poster (middle) → return `{media, provenance, artifact}` with `artifact.file = 'scan.spz'`. Remove `work/` after success; keep `clip`, `frames`, `logs`, `stills`, `output`.

Provenance shape:

```js
{ source: { clipSeconds, device }, frames: { extracted, registered, ratio }, timings: { extractMs, alignMs, trainMs, convertMs, totalMs }, artifact: { format, bytes, splatCount }, tools: { ffmpeg, colmap, brush, splatTransform } }
```

`device` comes from `record.meta.device`. Tool versions are read once with `ffmpeg -version`, `colmap -h`, `brush --version` (or `--help` if needed) and cached in-process; failures produce empty strings, never a failed job.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/scan-pipeline.test.js tests/scan-provenance.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/scan-pipeline.mjs server/scan-provenance.mjs tests/scan-pipeline.test.js tests/scan-provenance.test.js
git commit -m "feat(scan): orchestrate reconstruction with honest thresholds"
```

---

### Task 7: Real pipeline wiring and server operations

**Files:**
- Modify: `server/scan-server.mjs`, `package.json`
- Test: `tests/scan-server-ops.test.js`

**Interfaces:**
- `selectPipeline()` returns `runFakePipeline` when `process.env.SCAN_PIPELINE === 'fake'` or `--fake` is passed, otherwise `runRealPipeline`.
- CLI: `node server/scan-server.mjs [--fake] [--api-only] [--port 8787] [--host 127.0.0.1]`.
- Consumed by: Tasks 9, 12, 13.

- [ ] **Step 1: Write the failing tests**

```js
test('serve mode exits 1 with a build hint when dist/index.html is missing', async () => {
  const result = await runCli(['--port', '0'], { cwd: tmpWithoutDist });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /npm run build/);
});
test('api-only mode starts without dist', async () => {
  const child = spawn(process.execPath, ['server/scan-server.mjs', '--api-only', '--fake', '--port', '8791'], { cwd: repo });
  const res = await pollUntil(() => fetch('http://127.0.0.1:8791/api/nope'));
  assert.match(res.headers.get('content-type'), /application\/json/);
  child.kill('SIGTERM');
  assert.equal((await once(child, 'exit'))[0], 0);
});
test('a job failing with tool_missing becomes failed without crashing the server', async () => {
  const { url, close } = await createScanServer({ root, pipeline: async () => { throw new ScanError('tool_missing', 'Pasang Brush.'); } });
  const id = await uploadOne(url);
  const dto = await waitForStage(url, id, 'failed');
  assert.equal(dto.error.code, 'tool_missing');
  assert.equal((await fetch(`${url}/api/nope`)).status, 404);
  await close();
});
test('startup marks a stranded job failed with server_stopped', async () => {
  const stranded = await createJob(root, meta);
  await updateJob(root, stranded.id, { stage: 'aligning' });
  const { close } = await createScanServer({ root, pipeline: runFakePipeline });
  assert.equal((await readJob(root, stranded.id)).error.code, 'server_stopped');
  await close();
});
test('finished jobs are pruned to SCAN_KEEP after a run', async () => {
  process.env.SCAN_KEEP = '1';
  for (let i = 0; i < 2; i++) {
    const j = await createJob(root, meta);
    await writeJob(root, { ...j, stage: 'ready' });
  }
  const { close } = await createScanServer({ root, pipeline: runFakePipeline });
  assert.equal((await listJobs(root)).length, 1);
  await close();
  delete process.env.SCAN_KEEP;
});
test('SIGTERM exits 0 and resolves the active job as server_stopped', async () => {
  const child = spawn(process.execPath, ['server/scan-server.mjs', '--fake', '--port', '8792'], { cwd: repo, env: { ...process.env, SCAN_FAKE_DELAY_MS: '500' } });
  const id = await uploadOne('http://127.0.0.1:8792');
  child.kill('SIGTERM');
  const [code] = await once(child, 'exit');
  assert.equal(code, 0);
  assert.equal((await readJob(root, id)).error.code, 'server_stopped');
});
```

Add small helpers `runCli(args, opts)`, `pollUntil(fn)`, `uploadOne(baseUrl)`, `waitForStage(baseUrl, id, stage)`; keep `root` (temp scan root) and `repo` at module scope, and use the valid `meta` fixture from Task 3. `tmpWithoutDist` is a temp directory with no `dist/index.html`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/scan-server-ops.test.js`
Expected: FAIL because the CLI ignores the flags.

- [ ] **Step 3: Implement**

`serve` mode: `existsSync(dist/index.html)` else print `Jalankan npm run build dulu.` and `process.exit(1)`. `--api-only` skips that check. `SCAN_ROOT` (default `path.resolve(root, 'var/scans')`), `SCAN_KEEP`, `SCAN_PORT`, `SCAN_HOST` env overrides. On startup call `pruneJobs(root, keep)`; after each job finishes call it again. On startup also mark every non-terminal job `failed` with `{code:'server_stopped', message:'Server demo berhenti sebelum pemrosesan selesai.'}` so a crash cannot leave a client polling forever. Before the first real job, `resolveTool` all five tools; missing tools fail that job with `tool_missing` and the install hint, not a server exit. On `SIGINT`/`SIGTERM`: abort the active pipeline via `AbortController`, mark it failed `server_stopped`, stop accepting connections, `close()` the HTTP server, exit 0. Set `process.env.SCAN_PIPELINE` when `--fake` is passed.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/scan-server-ops.test.js`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add server/scan-server.mjs package.json tests/scan-server-ops.test.js
git commit -m "feat(scan): operate the real pipeline behind one server"
```

---

### Task 8: Capture page, camera and recorder lifecycle

**Files:**
- Create: `src/scan-recorder.js`, `src/scan-capture.js`, `src/scan-capture.css`
- Modify: `src/main.js` (route branch, title, dispose)
- Test: `tests/scan-recorder.test.js`

**Interfaces:**
- `MIN_SECONDS = 8`, `MAX_SECONDS = 45`, `GUIDANCE` (6 Indonesian prompts), `pickRecorderMime(isTypeSupported) -> string|null`, `cameraErrorCopy(error) -> string`.
- `renderScanCapture() -> string`; `mountScanCapture(root, {onNavigate, onToast}) -> () => void`.
- Consumed by: Tasks 9, 10, 12.

- [ ] **Step 1: Write the failing tests**

```js
test('pickRecorderMime prefers mp4 then vp9 then vp8 then webm', () => {
  const all = () => true;
  assert.equal(pickRecorderMime(all), 'video/mp4;codecs=avc1.42E01E');
  assert.equal(pickRecorderMime(t => t === 'video/webm;codecs=vp9'), 'video/webm;codecs=vp9');
  assert.equal(pickRecorderMime(() => false), null);
});
test('cameraErrorCopy maps NotAllowedError, NotFoundError, NotReadableError and insecure context', () => {
  const named = (name) => Object.assign(new Error(name), { name });
  assert.match(cameraErrorCopy(named('NotAllowedError')), /Izin kamera ditolak/);
  assert.match(cameraErrorCopy(named('NotFoundError')), /Kamera tidak ditemukan/);
  assert.match(cameraErrorCopy(named('NotReadableError')), /Kamera sedang dipakai/);
  assert.match(cameraErrorCopy({ insecure: true }), /HTTPS/);
  assert.match(cameraErrorCopy(named('WeirdError')), /Kamera belum bisa dinyalakan/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/scan-recorder.test.js`
Expected: FAIL with `Cannot find module`.

- [ ] **Step 3: Implement the capture page**

Markup: page title **Pindai furniturmu.**, intro **Rekam satu putaran pelan. Pembeli bisa memutar hasilnya dari setiap sisi.**; a dark stage with `<video data-scan-video playsinline muted autoplay>`; live timer and a 6-step guidance list; buttons **Nyalakan kamera**, **Mulai merekam**, **Hentikan**, **Gunakan rekaman**, **Rekam ulang**; a review `<video controls>`; a details form (`Judul barang`, `Lebar`, `Kedalaman`, `Tinggi`, `Catatan kondisi`); a status line; a link back to `/jual`.

Behaviour: on **Nyalakan kamera** only, call `getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}},audio:false})`. If `!window.isSecureContext`, show **Kamera perlu sambungan aman (HTTPS). Buka tautan demo dari laptop.** and do not call media. If `MediaRecorder` is undefined or `pickRecorderMime` returns null, show **Browser ini belum bisa merekam video. Coba Chrome atau Safari terbaru.** Start recording with `videoBitsPerSecond: 8_000_000`, `mimeType` from the picker. Auto-stop at 45 s; **Hentikan** before 8 s shows **Rekam minimal 8 detik.**; between 8 and 45 s produces a Blob. If the blob is empty, show **Rekaman kosong. Coba rekam lagi.** and keep upload disabled. Stop tracks and revoke object URLs on retake, route exit and `pagehide`. Keep the last completed `{blob, mime, meta}` in module scope so returning to `/jual/pindai` offers **Gunakan rekaman terakhir**.

`main.js`: add `else if (path === "/jual/pindai")` that renders `<main id="main" tabindex="-1"><p class="scan-loading" role="status">Menyiapkan kamera…</p></main>`, then dynamic-imports the module, replaces the content with `renderScanCapture()` and stores the mount cleanup in `dispose` with a `cancelled` guard. Add `titles["/jual/pindai"] = "Pindai furnitur"`.

- [ ] **Step 4: Run tests and build**

Run: `node --test tests/scan-recorder.test.js`
Expected: PASS, 2 tests.
Run: `npm run build`
Expected: build succeeds and the new capture chunk is emitted.

- [ ] **Step 5: Commit**

```bash
git add src/scan-recorder.js src/scan-capture.js src/scan-capture.css src/main.js tests/scan-recorder.test.js
git commit -m "feat(scan): add rear-camera capture page"
```

---

### Task 9: Upload, metadata and retry

**Files:**
- Create: `src/scan-api.js`
- Modify: `src/scan-capture.js`
- Test: `tests/scan-api.test.js`

**Interfaces:**
- `buildMetaQuery(meta) -> string` (URL-encoded, comma decimals converted to dots, `cid` included when `meta.clientId` is set).
- `uploadScan(meta, blob, onProgress) -> {promise: Promise<{id}>, abort(): void}` using `XMLHttpRequest`, `responseType = 'json'`, `Content-Type` from the blob, progress `0–100`.
- `getScan(id, {signal} = {}) -> Promise<dto>`; throws `ScanApiError` with `code` and `status`.
- `STAGE_LABELS`, `STAGE_SEQUENCE`, `ERROR_COPY`, `nextPollDelay(attempt)`.
- `src/scan-api.js` must not touch `window`/`document` at import time, so Node tests can import its pure exports.
- Consumed by: Task 10.

- [ ] **Step 1: Write the failing tests**

```js
test('buildMetaQuery converts comma decimals and encodes Indonesian text', () => {
  const q = buildMetaQuery({ title: 'Kursi Kayu', widthCm: 58.5, depthCm: 63, heightCm: 84, conditionNote: 'goresan ringan', device: 'Android', clientId: '6f1c2b7e-8a4d-4c3e-9f10-2b3c4d5e6f70' });
  assert.match(q, /w=58\.5/);
  assert.match(q, /note=goresan\+ringan/);
  assert.match(q, /cid=6f1c2b7e-8a4d-4c3e-9f10-2b3c4d5e6f70/);
});
test('every server stage and error code has Indonesian copy', () => {
  for (const stage of STAGE_SEQUENCE) assert.ok(STAGE_LABELS[stage]);
  for (const code of ['footage_short','alignment_failed','tool_missing','queue_full','not_found']) assert.ok(ERROR_COPY[code]);
});
test('nextPollDelay backs off and caps at 8 seconds', () => {
  assert.deepEqual([0,1,2,3,9].map(nextPollDelay), [2000,3000,5000,8000,8000]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/scan-api.test.js`
Expected: FAIL with `Cannot find module`.

- [ ] **Step 3: Implement upload and wire the form**

`uploadScan` opens `POST /api/scans?` + `buildMetaQuery(meta)`, sets `Content-Type` to the blob's base MIME (`blob.type.split(';')[0] || 'video/webm'`), reports `upload.onprogress`, resolves `xhr.response` on 201, rejects `ScanApiError` otherwise. `abort()` calls `xhr.abort()`.

On each completed recording, generate `clientId = crypto.randomUUID()` once and keep it with the clip; every retry of that clip reuses it, so the server returns the same job. A retake discards the old clip and generates a new `clientId`.

Capture form: validate title 2–80, each dimension 1–1000 with at most one decimal, note ≤200; put the first invalid field in focus with an inline Indonesian message. **Kirim ke laptop** disables while uploading, shows a determinate progress bar and **Batalkan**. On success `onNavigate('/pindai/' + id)`. On failure show `ERROR_COPY[code] ?? ERROR_COPY.default`, keep the clip and typed values, and offer **Coba kirim lagi** and **Rekam ulang**. Never auto-retry.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/scan-api.test.js`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/scan-api.js src/scan-capture.js tests/scan-api.test.js
git commit -m "feat(scan): upload clips with metadata and retry"
```

---

### Task 10: Preview and status page

**Files:**
- Create: `src/scan-preview.js`, `src/scan-preview.css`
- Modify: `src/scan-api.js` (add `PREVIEW_COPY`), `src/main.js`, `src/video-capture.js`
- Test: `tests/scan-preview.test.js`

**Interfaces:**
- `PREVIEW_COPY = { badge: 'Pindai baru', disclaimer: 'Model ini dibuat dari rekaman kamera, bukan contoh Sora.', retake: 'Rekam barang lain' }` exported from `src/scan-api.js`.
- `renderScanPreview(id) -> string`; `mountScanPreview(root, {id, onNavigate, onToast}) -> () => void`.
- Consumed by: Task 11, Task 12.

- [ ] **Step 1: Write the failing test**

```js
import { PREVIEW_COPY } from '../src/scan-api.js';

test('preview copy separates a new scan from the Sora example', () => {
  assert.equal(PREVIEW_COPY.badge, 'Pindai baru');
  assert.match(PREVIEW_COPY.disclaimer, /bukan contoh Sora/);
  assert.equal(PREVIEW_COPY.retake, 'Rekam barang lain');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/scan-preview.test.js`
Expected: FAIL with `Cannot find module`.

- [ ] **Step 3: Implement the page**

Layout inside `shell(..., 'scan-page')`: badge **Pindai baru**, title from `meta.title`, dimensions `L × D × T` in cm, condition note, and the sentence **Model ini dibuat dari rekaman kamera, bukan contoh Sora.** Status card lists `STAGE_SEQUENCE` with the active stage, a progress indicator, and the honest note **Proses berjalan di laptop demo. Jangan tutup laptop atau tab ini.** On `ready`: provenance card (clip seconds, device, extracted/registered frames with ratio, per-stage timings, artifact size and splat count), stills strip labelled **Bingkai dari rekaman**, viewer host, and actions **Rekam barang lain** → `/jual/pindai`, **Lihat katalog** → `/beli`. On `failed`: `ERROR_COPY[code]`, **Rekam ulang**, **Coba lagi** (reload status once), and keep stills if any. On 404: **Hasil pindai tidak ditemukan.** plus the two actions.

Poll with `setTimeout(nextPollDelay(attempt))`, stop on terminal stage, dispose, or `document.hidden` (re-check on `visibilitychange`). Abort in-flight fetches on dispose.

`main.js`: add a `/pindai/` branch that dynamic-imports the module, sets `shell(renderScanPreview(id), 'scan-page')`, mounts, and disposes; add `titles["/pindai"] = "Hasil pindai"` and a body class `scan-page`. `video-capture.js`: add one entry section after `tools()` in `renderVideoWorkspace` — **Pindai furnitur baru** with **Kamera ponsel · satu barang, satu rekaman** linking `/jual/pindai`, and a quiet line **Contoh Sora di bawah memakai video siap, bukan kamera.** Do not change the rest of the workspace.

- [ ] **Step 4: Run tests and build**

Run: `node --test tests/scan-preview.test.js`
Expected: PASS, 1 test.
Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/scan-preview.js src/scan-preview.css src/main.js src/video-capture.js tests/scan-preview.test.js
git commit -m "feat(scan): add job status and buyer preview page"
```

---

### Task 11: SparkJS splat viewer

**Files:**
- Create: `src/scan-viewer.js`, `src/scan-viewer.css`
- Modify: `src/scan-preview.js`, `package.json` (dependency)
- Test: build + browser check in Task 12

**Interfaces:**
- `renderScanViewer({title}) -> string`; `mountScanViewer(root, {url, poster, onStatus}) -> () => void`.
- Consumed by: Task 10, Task 12.

- [ ] **Step 1: Add the dependency and write the viewer**

```powershell
npm install @sparkjsdev/spark@2.4.0
```

`mountScanViewer`: create its own `THREE.WebGLRenderer({antialias:false, alpha:true})`, `setPixelRatio(Math.min(devicePixelRatio, 2))`; add `new SparkRenderer({renderer})`; create `new SplatMesh({url, onProgress})`; `await splat.initialized`; fit the camera from `splat.getBoundingBox(true)` using vertical and horizontal FOV; add `new SparkControls({canvas: renderer.domElement})`; `renderer.setAnimationLoop`; `ResizeObserver` re-fit; disable auto-rotation under `prefers-reduced-motion`. Show the poster until initialized. On error or when `WebGL2RenderingContext` is unavailable, replace the canvas with **Pratinjau 3D belum bisa dibuka di perangkat ini.**, the poster, a **Coba lagi** button and the stills. Dispose stops the loop, disposes controls, mesh, renderer and canvas, and disconnects the observer.

Import `SparkRenderer`, `SplatMesh` and `SparkControls` from `@sparkjsdev/spark` only in this module so Vite emits a separate chunk. In `scan-preview.js`, `await import('./scan-viewer.js')` only when the job reaches `ready`, mount it, and unmount on retry/dispose. The status page must not download the viewer chunk while the job is still processing.

- [ ] **Step 2: Verify the build and chunk**

Run: `npm run build`
Expected: success; the build emits a separate lazy chunk for the viewer (record its file name and gzip size). It must not be imported by the initial `index-*.js`.

- [ ] **Step 3: Verify the fixture loads**

Run the fake server and open `/pindai/<ready-id>`; the canvas must not be blank and the console must be free of errors. If Spark rejects the fixture PLY, correct the fixture columns in `server/scan-fake.mjs` rather than weakening the viewer.

- [ ] **Step 4: Commit**

```bash
git add src/scan-viewer.js src/scan-viewer.css src/scan-preview.js package.json package-lock.json
git commit -m "feat(scan): load the finished splat with SparkJS"
```

---

### Task 12: Browser end-to-end and regression

**Files:**
- Create: `scripts/verify-scan.mjs`
- Modify: `package.json` (`test:scan`)
- Test: `scripts/verify-scan.mjs`

**Interfaces:**
- Starts `createScanServer({root, pipeline: runFakePipeline})`; Chromium flags `--use-fake-device-for-media-stream`, `--use-fake-ui-for-media-stream`, `--autoplay-policy=no-user-gesture-required`; `context.grantPermissions(['camera'])`; writes screenshots and `report.json` to `QA_OUTPUT`.
- Adds `"test:scan": "node --test tests/scan-*.test.js && node scripts/verify-scan.mjs"` to `package.json`.

- [ ] **Step 1: Write the checks**

1. `/jual/pindai` does not call `getUserMedia` before the tap (count via `addInitScript` wrapper).
2. **Nyalakan kamera** starts a live video (`readyState >= 2`) and a live track.
3. Record 8.5 s, stop, review appears; **Gunakan rekaman** enables the form.
4. Fill metadata, upload, observe progress, land on `/pindai/<uuid>`; assert `Pindai baru`, the stage list, then `Siap dilihat`.
5. Ready page has a non-blank canvas, 3 still images returning 200, provenance numbers, and no console errors.
6. Reload the deep link; it is still ready and the viewer mounts.
7. Deep-link an unknown id; assert the Indonesian not-found state and both actions.
8. A context whose `getUserMedia` rejects `NotAllowedError` shows the permission copy and never uploads.
9. `window.MediaRecorder = undefined` shows the unsupported-browser copy and disables upload.
10. Fake failure (`SCAN_FAKE_FAIL=1`) shows the failed stage, the mapped reason and **Rekam ulang**.
11. Intercept the first upload and abort it; assert the error copy, then **Coba kirim lagi** succeeds with one new job.
12. `/jual/sora/rekam` still calls no device media; `/jual` shows the new scan entry and the prepared Sora label.
13. At 390 and 320 px, both new routes have no horizontal overflow and visible primary actions.

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run build; node scripts/verify-scan.mjs`
Expected: FAIL on the first missing selector or 404.

- [ ] **Step 3: Fix the app, not the assertions**

Keep the asserts above. Only adjust selectors to stable `data-*` hooks. Add the hooks in the owning modules if missing.

- [ ] **Step 4: Run the full verification**

```powershell
npm run test:unit
npm run build
$env:QA_OUTPUT="$env:TEMP\lihatdulu-scan"; node scripts/verify-scan.mjs
node scripts/verify-v8.mjs
```

Expected: unit tests all pass; build succeeds; `verify-scan` all checks pass; `verify-v8` stays at its existing 26 passing checks. Restore tracked `dist/` afterwards with `git checkout -- dist`.

- [ ] **Step 5: Commit**

```bash
git add scripts/verify-scan.mjs package.json
git commit -m "test(scan): cover capture, upload, status and viewer"
```

---

### Task 13: Physical phone proof and handoff

**Files:**
- Create: `docs/handoff/scan-proof.md`
- Modify: `docs/handoff/session-log.md`, `docs/handoff/decisions.md`, `docs/handoff/workstreams/scan.md`

- [ ] **Step 1: Run the demo stack on the Helios**

```powershell
npm run build
npm run scan:serve
# second terminal
cloudflared tunnel --url http://127.0.0.1:8787
```

Expected: an `https://…trycloudflare.com` URL that opens the site on the phone with a secure context. Treat the URL as private to the tester; do not paste it into a public place, and stop the tunnel when the run ends.

- [ ] **Step 2: Execute the physical checklist**

On the actual phone: fresh rear-camera scan of the same chair, no file transfer by hand; record clip length, upload time, every stage transition, total time to `Siap dilihat`, artifact size, splat count and phone load time. Then: retake; permission denied; airplane mode during upload then retry; second job while one runs (queued); reload `/pindai/:id`; leave mid-recording and confirm the camera indicator turns off; open `/jual/sora/rekam` and confirm no camera prompt. Confirm one earlier scan of the same chair is already loaded and labelled as an earlier scan, and bring the original detail photo. Repeat the run once on the venue or fallback network with the laptop on battery, then once on mains power, and record both. Save screenshots and timings outside the repo.

- [ ] **Step 3: Record the evidence**

`docs/handoff/scan-proof.md`: date, phone model/browser/OS, laptop versions, network, tunnel URL pattern, exact timings, registered/total frames, artifact numbers, screenshot paths, defects found, and a clear statement of what a judge sees versus what is prepared. Label any earlier scan used as a fallback.

- [ ] **Step 4: Update the handoff**

Add a session-log entry (date, branch, commit, before/after, commands, results, evidence paths, next unfinished step). Add a decisions row: real scan runs on one laptop process and one worker, artifact cap 60 MB, opaque job IDs, no listing integration. Mark the scan workstream acceptance items that are actually proven, and nothing that is not.

- [ ] **Step 5: Final verification and commit**

```powershell
git status --short
npm run test:unit
npm run build
git checkout -- dist
```

```bash
git add docs/handoff/scan-proof.md docs/handoff/session-log.md docs/handoff/decisions.md docs/handoff/workstreams/scan.md
git commit -m "docs(scan): record physical phone proof and decisions"
```

If any physical check fails, record it as an open defect with reproduction and evidence instead of marking the workstream done.
