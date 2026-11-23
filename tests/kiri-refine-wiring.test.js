import test from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readKiriConfig, refineSettings } from "../server/kiri-config.mjs";
import { createMockClient } from "../server/kiri-mock.mjs";
import { createKiriService } from "../server/kiri-service.mjs";
import { createKiriServer, parseDimensions } from "../server/kiri-server.mjs";
import { listJobs, toJobDto } from "../server/kiri-jobs.mjs";
import { crc32 } from "../server/zip.mjs";
import { holeShare, refineNote, sourceOptions } from "../src/scan-views.js";

// The refinement stage and the photoset input, at the HTTP boundary. These run
// against the mock adapters, so no key and no credit is involved: what is under
// test is the wiring (ZIP in, stills kept, raw GLB kept, refined GLB beside it,
// retryable refine) rather than KIRI itself.

function zipOf(entries) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const compressed = deflateRawSync(data);
    const crc = crc32(data);
    const nameBuffer = Buffer.from(name, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    locals.push(local, nameBuffer, compressed);
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0x0800, 8);
    header.writeUInt16LE(8, 10);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(compressed.length, 20);
    header.writeUInt32LE(data.length, 24);
    header.writeUInt16LE(nameBuffer.length, 28);
    header.writeUInt32LE(offset, 42);
    central.push(header, nameBuffer);
    offset += local.length + nameBuffer.length + compressed.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

// A JPEG header plus payload: enough for the entry filter and the size checks.
function jpeg(size = 256, seed = 1) {
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(size, seed)]);
}

// KIRI documents 20-300 images for Photo Scan, so a valid set starts at 20.
function photoSet(count = 20) {
  return zipOf(
    Array.from({ length: count }, (_, index) => [
      `view-${String(index + 1).padStart(2, "0")}.jpg`,
      jpeg(200 + index, index + 1),
    ]),
  );
}

async function start(t, overrides = {}) {
  const root = await mkdtemp(join(tmpdir(), "lihatdulu-refine-"));
  await mkdir(join(root, "jobs"), { recursive: true });
  t.after(() => rm(root, { recursive: true, force: true }));
  const config = readKiriConfig(
    {
      KIRI_MOCK: "1",
      KIRI_JOBS_ROOT: root,
      KIRI_MOCK_LATENCY_MS: "60",
      KIRI_POLL_MIN_MS: "20",
      KIRI_POLL_MAX_MS: "60",
      KIRI_SERVE_DIST: "0",
      ...(overrides.env ?? {}),
    },
    process.cwd(),
  );
  const logs = [];
  const log = (entry) => logs.push(entry);
  const client = createMockClient({
    jobsRoot: root,
    latencyMs: config.mockLatencyMs,
    failMode: config.mockFail,
    failOnce: config.mockFailOnce,
  });
  const service = createKiriService({ config, client, log });
  const server = createKiriServer({ config, service, log });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  t.after(
    () =>
      new Promise((done) => {
        service.stop();
        server.close(done);
      }),
  );
  return { root, config, service, base: `http://127.0.0.1:${server.address().port}`, logs };
}

async function postPhotos(base, body, { name = "foto.zip", dimensions = null } = {}) {
  const headers = { "content-type": "application/zip", "x-file-name": encodeURIComponent(name) };
  if (dimensions) headers["x-dimensions"] = dimensions;
  const response = await fetch(`${base}/api/kiri/jobs/photos`, { method: "POST", headers, body });
  return { status: response.status, body: await response.json() };
}

async function waitFor(base, id, stages, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const response = await fetch(`${base}/api/kiri/jobs/${id}`);
    last = await response.json();
    if (stages.includes(last.stage)) return last;
    await new Promise((done) => setTimeout(done, 60));
  }
  return last;
}

test("a photoset ZIP becomes a job with the stills kept and served", async (t) => {
  const { base, root } = await start(t);
  const created = await postPhotos(base, photoSet(21), { name: "kursi-foto.zip" });
  assert.equal(created.status, 201);
  assert.equal(created.body.input.source, "photos");
  assert.equal(created.body.input.photos, 21);
  const ready = await waitFor(base, created.body.id, ["ready", "failed"]);
  assert.equal(ready.stage, "ready");
  assert.equal(ready.artifact.format, "glb");
  assert.equal(ready.photos.length, 21);
  assert.equal(ready.source.kind, "photos");
  assert.equal(ready.source.photos, 21);

  const photo = await fetch(`${base}${ready.photos[0].url}`);
  assert.equal(photo.status, 200);
  assert.equal(photo.headers.get("content-type"), "image/jpeg");
  const bytes = Buffer.from(await photo.arrayBuffer());
  assert.equal(bytes[0], 0xff);
  assert.equal(bytes[1], 0xd8);

  const missing = await fetch(`${base}/api/kiri/jobs/${created.body.id}/photos/99`);
  assert.equal(missing.status, 404);
  assert.equal((await listJobs(root)).length, 1);
});

test("a photoset smaller than the minimum is refused before any job exists", async (t) => {
  const { base, root } = await start(t);
  const refused = await postPhotos(base, photoSet(3));
  assert.equal(refused.status, 400);
  assert.equal(refused.body.error.code, "photos_too_few");
  assert.equal((await listJobs(root)).length, 0);
});

test("a ZIP of something other than photos is refused", async (t) => {
  const { base } = await start(t);
  const refused = await postPhotos(
    base,
    zipOf([["notes.txt", Buffer.from("bukan foto")]]),
  );
  assert.equal(refused.status, 415);
  assert.equal(refused.body.error.code, "photos_invalid");
});

test("seller measurements ride along and stay labelled as theirs", async (t) => {
  const { base } = await start(t);
  const created = await postPhotos(base, photoSet(20), { dimensions: "62,48,92" });
  assert.deepEqual(created.body.source.dimensions, {
    length: 62,
    width: 48,
    height: 92,
    unit: "cm",
  });
});

test("parseDimensions only trusts plausible centimetres", () => {
  assert.deepEqual(parseDimensions("120x48x92"), {
    length: 120,
    width: 48,
    height: 92,
    unit: "cm",
  });
  assert.equal(parseDimensions("0,48,92"), null);
  assert.equal(parseDimensions("62,48"), null);
  assert.equal(parseDimensions("62,48,9999"), null);
  assert.equal(parseDimensions(""), null);
});

test("the balance probe answers a number and never the key", async (t) => {
  const { base } = await start(t);
  const response = await fetch(`${base}/api/kiri/balance`);
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.deepEqual(JSON.parse(body), { mode: "mock", balance: 200 });
  assert.ok(!/kiri_[A-Za-z0-9_-]{20,}/.test(body), "no key-shaped string in the body");
});

test("an empty balance refuses the photoset before the upload", async (t) => {
  const { root } = await start(t);
  const service = createKiriService({
    config: readKiriConfig({ KIRI_MOCK: "1", KIRI_JOBS_ROOT: root }, process.cwd()),
    client: {
      provider: "kiri",
      async getBalance() {
        return { balance: 0 };
      },
      async submitPhotoImages() {
        throw new Error("KIRI must not be called on an empty balance");
      },
    },
    log: () => {},
  });
  const server = createKiriServer({
    config: readKiriConfig({ KIRI_MOCK: "1", KIRI_JOBS_ROOT: root }, process.cwd()),
    service,
    log: () => {},
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  t.after(
    () =>
      new Promise((done) => {
        service.stop();
        server.close(done);
      }),
  );
  const local = `http://127.0.0.1:${server.address().port}`;
  const refused = await postPhotos(local, photoSet(21));
  assert.equal(refused.status, 402);
  assert.equal(refused.body.error.code, "kiri_no_credit");
  assert.equal((await listJobs(root)).length, 0);
});

test("the raw scan and the refined preview are different files and URLs", async (t) => {
  const { base } = await start(t);
  const created = await postPhotos(base, photoSet(20));
  const ready = await waitFor(base, created.body.id, ["ready", "failed"]);
  assert.equal(ready.stage, "ready");
  assert.ok(ready.artifact.raw, "a GLB job always keeps the raw file");
  assert.match(ready.artifact.raw.url, /\/raw\.glb$/);
  assert.match(ready.artifact.url, /\/result\.glb$/);

  const raw = await fetch(`${base}${ready.artifact.raw.url}`);
  assert.equal(raw.status, 200);
  assert.equal(raw.headers.get("x-scan-artifact"), "raw");
  const rawBytes = Buffer.from(await raw.arrayBuffer());
  assert.equal(rawBytes.toString("latin1", 0, 4), "glTF");

  const served = await fetch(`${base}${ready.artifact.url}`);
  assert.equal(served.status, 200);
  const servedArtifact = served.headers.get("x-scan-artifact");
  const servedBytes = Buffer.from(await served.arrayBuffer());
  if (ready.refine?.status === "applied") {
    assert.equal(servedArtifact, "refined");
    assert.notEqual(servedBytes.length, rawBytes.length);
    assert.notDeepEqual(servedBytes, rawBytes);
    assert.equal(servedBytes.length, ready.artifact.bytes);
  } else {
    assert.equal(servedArtifact, "raw");
    assert.equal(ready.artifact.refined, false);
  }
});

test("refinement is retryable from the saved GLB without a new submission", async (t) => {
  const { base, root } = await start(t);
  const created = await postPhotos(base, photoSet(20));
  const ready = await waitFor(base, created.body.id, ["ready", "failed"]);
  const serial = ready.kiri.serial;
  const refine = await fetch(`${base}/api/kiri/jobs/${created.body.id}/refine`, {
    method: "POST",
  });
  assert.equal(refine.status, 200);
  const body = await refine.json();
  assert.ok(["applied", "skipped", "failed"].includes(body.refine.status));
  assert.equal(body.kiri.serial, serial, "refining never resubmits to KIRI");
  assert.equal((await listJobs(root)).length, 1);
  // A second pass is allowed and stays free.
  const again = await fetch(`${base}/api/kiri/jobs/${created.body.id}/refine`, {
    method: "POST",
  });
  assert.equal(again.status, 200);
});

test("refine on a job without a mesh is a conflict", async (t) => {
  const { base } = await start(t);
  const missing = await fetch(
    `${base}/api/kiri/jobs/00000000-0000-4000-8000-000000000000/refine`,
    { method: "POST" },
  );
  assert.equal(missing.status, 404);
});

test("the source tabs put the refined preview first and the photos last", () => {
  const base = {
    stage: "ready",
    artifact: {
      format: "glb",
      url: "/api/kiri/jobs/x/result.glb",
      refined: true,
      raw: { url: "/api/kiri/jobs/x/raw.glb" },
    },
    photos: [{ url: "/api/kiri/jobs/x/photos/1" }],
  };
  const ids = sourceOptions(base).map((option) => option.id);
  assert.deepEqual(ids, ["refined", "raw", "photos"]);
  assert.equal(
    sourceOptions(base)[0].caveat,
    "Pratinjau 3D perkiraan. Cek foto asli untuk kondisi barang.",
  );

  const unrefined = {
    ...base,
    artifact: { ...base.artifact, refined: false },
  };
  assert.deepEqual(
    sourceOptions(unrefined).map((option) => option.id),
    ["raw", "photos"],
  );

  // Photos alone are still a usable result page.
  assert.deepEqual(
    sourceOptions({ stage: "ready", artifact: null, photos: base.photos }).map(
      (option) => option.id,
    ),
    ["photos"],
  );
  assert.deepEqual(sourceOptions({ stage: "processing" }), []);
});

test("the refine line explains each state without inventing a failure", () => {
  assert.match(
    refineNote({
      refine: {
        status: "applied",
        metrics: { trianglesBefore: 1000, trianglesAfter: 900, fragmentsRemoved: 3, gapsFilled: 1 },
      },
    }),
    /3 pecahan dibuang, 1 celah kecil ditutup/,
  );
  assert.match(refineNote({ refine: { status: "skipped" } }), /dilewati/);
  assert.match(refineNote({ refine: { status: "failed" } }), /gagal/);
  assert.equal(refineNote(null), "");
});

test("the refine line admits a see-through silhouette instead of implying a closed mesh", () => {
  const perforated = refineNote({
    refine: {
      status: "applied",
      metrics: {
        trianglesBefore: 19246,
        trianglesAfter: 19246,
        coverage: { verdict: "berlubang", holeRatioAfter: 0.187566, worstAxis: "y" },
      },
    },
  });
  assert.match(perforated, /Masih 18,8% siluet yang tembus pandang/);
  assert.match(perforated, /tidak ditambal/);

  const clean = refineNote({
    refine: {
      status: "applied",
      metrics: {
        trianglesBefore: 20000,
        trianglesAfter: 19900,
        gapsFilled: 2,
        coverage: { verdict: "bersih", holeRatioAfter: 0.004 },
      },
    },
  });
  assert.match(clean, /2 celah kecil ditutup/);
  assert.doesNotMatch(clean, /tembus pandang/);
});

test("holeShare formats a ratio the way the page reads it", () => {
  assert.equal(holeShare(0.187566), "18,8%");
  assert.equal(holeShare(1), "100%");
  assert.equal(holeShare(0), "");
  assert.equal(holeShare(undefined), "");
  assert.equal(holeShare("nope"), "");
});

test("refinement settings are overridable and default to the shipped profile", () => {
  const defaults = refineSettings({});
  assert.equal(defaults.enabled, true);
  assert.ok(defaults.gapMaxRatio > 0 && defaults.gapMaxRatio < 1);
  assert.ok(defaults.minFragmentRatio > 0 && defaults.minFragmentRatio < 1);
  const custom = refineSettings({
    KIRI_REFINE: "off",
    KIRI_REFINE_GAP_MAX_RATIO: "0.02",
    KIRI_REFINE_TARGET_SIZE: "2",
  });
  assert.equal(custom.enabled, false);
  assert.equal(custom.gapMaxRatio, 0.02);
  assert.equal(custom.targetSize, 2);
});

test("the DTO keeps local paths, the hash and the key out of the browser", () => {
  const dto = toJobDto({
    id: "11111111-1111-4111-8111-111111111111",
    stage: "ready",
    provider: "kiri",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    videoHash: "abc123",
    source: { filename: "kursi.mp4", bytes: 10, kind: "video", dimensions: null },
    artifact: { format: "glb", bytes: 100, triangles: 12 },
    refined: { bytes: 90, triangles: 10 },
    refine: { status: "applied", metrics: { trianglesBefore: 12, trianglesAfter: 10 } },
    photos: [{ file: "photo-1.jpg", bytes: 5 }],
    kiri: { serial: "abcdefghijklmnop", status: 2 },
  });
  assert.equal(dto.artifact.refined, true);
  assert.equal(dto.artifact.bytes, 90);
  assert.equal(dto.artifact.triangles, 10);
  assert.equal(dto.artifact.raw.bytes, 100);
  assert.equal(dto.photos.length, 1);
  assert.equal(dto.refine.status, "applied");
  const text = JSON.stringify(dto);
  assert.ok(!text.includes("abc123"));
  assert.ok(!text.includes("photo-1.jpg"));
  assert.ok(!text.includes("C:"));
});
