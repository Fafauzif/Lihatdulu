import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_LIMITS,
  ERROR_COPY,
  STAGE_LABELS,
  STAGE_SEQUENCE,
  STORAGE_KEY,
  clearStoredJobId,
  errorCopy,
  formatBytes,
  formatDuration,
  isTerminalStage,
  nextPollDelay,
  readStoredJobId,
  stageIndex,
  storeJobId,
  validateVideoBasics,
  validateVideoFile,
} from "../src/scan-api.js";
import { detailRows, renderScanPreview, renderScanUpload } from "../src/scan-views.js";

function fakeStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
    dump: () => Object.fromEntries(data),
  };
}

test("a valid MP4 passes the KIRI limits", () => {
  const result = validateVideoFile({
    name: "kursi.mp4",
    type: "video/mp4",
    size: 10 * 1024 * 1024,
    durationS: 45,
    width: 1920,
    height: 1080,
  });
  assert.deepEqual(result, { ok: true, code: null, message: "" });
});

test("a portrait phone clip is the same Full HD budget and is accepted", () => {
  const result = validateVideoFile({
    name: "kursi-potret.mp4",
    type: "video/mp4",
    size: 61 * 1024 * 1024,
    durationS: 25.3,
    width: 1080,
    height: 1920,
  });
  assert.deepEqual(result, { ok: true, code: null, message: "" });
});

test("non-MP4 files are refused before upload", () => {
  const result = validateVideoFile({ name: "kursi.mov", type: "video/quicktime", size: 10, durationS: 5 });
  assert.equal(result.ok, false);
  assert.equal(result.code, "video_not_mp4");
});

test("the upload ceiling, duration and resolution come from KIRI's limits", () => {
  assert.equal(
    validateVideoFile({ name: "a.mp4", type: "video/mp4", size: DEFAULT_LIMITS.maxUploadBytes + 1, durationS: 5 }).code,
    "video_too_large",
  );
  assert.equal(
    validateVideoFile({ name: "a.mp4", type: "video/mp4", size: 10, durationS: 182 }).code,
    "video_too_long",
  );
  assert.equal(
    validateVideoFile({ name: "a.mp4", type: "video/mp4", size: 10, durationS: 5, width: 3840, height: 2160 }).code,
    "video_too_large_dimensions",
  );
  // Portrait 4K is refused too: rotating the frame must not bypass the ceiling.
  assert.equal(
    validateVideoFile({ name: "a.mp4", type: "video/mp4", size: 10, durationS: 5, width: 2160, height: 3840 }).code,
    "video_too_large_dimensions",
  );
});

test("the pre-metadata check accepts a plausible MP4 without a duration", () => {
  assert.deepEqual(
    validateVideoBasics({ name: "kursi.mp4", type: "video/mp4", size: 1024 }, DEFAULT_LIMITS),
    { ok: true, code: null, message: "" },
  );
  assert.equal(validateVideoBasics({ name: "kursi.mov", type: "video/quicktime", size: 1024 }).code, "video_not_mp4");
  assert.equal(validateVideoBasics({ name: "kursi.mp4", size: 0 }).code, "upload_empty");
  assert.equal(
    validateVideoBasics({ name: "kursi.mp4", size: DEFAULT_LIMITS.maxUploadBytes + 1 }).code,
    "video_too_large",
  );
});

test("a clip whose metadata cannot be read is refused", () => {
  assert.equal(validateVideoFile({ name: "a.mp4", size: 10, durationS: 0 }).code, "video_unreadable");
  assert.equal(validateVideoFile({ name: "a.mp4", size: 0, durationS: 5 }).code, "upload_empty");
});

test("three minutes plus container rounding is still accepted", () => {
  const result = validateVideoFile({ name: "a.mp4", size: 10, durationS: 180.4 });
  assert.equal(result.ok, true);
});

test("byte and duration formatting uses Indonesian decimals", () => {
  assert.equal(formatBytes(0), "0 MB");
  assert.equal(formatBytes(124_705), "122 KB");
  assert.equal(formatBytes(1_500_000), "1,4 MB");
  assert.equal(formatBytes(25 * 1024 * 1024), "25 MB");
  assert.equal(formatBytes(1024), "1 KB");
  assert.equal(formatDuration(18), "18 dtk");
  assert.equal(formatDuration(65), "1 mnt 05 dtk");
});

test("poll delays grow and then stay capped", () => {
  assert.deepEqual(
    [0, 1, 2, 3, 4, 9].map(nextPollDelay),
    [1500, 2000, 3000, 5000, 8000, 8000],
  );
});

test("stage helpers cover every stage and stop at terminal ones", () => {
  for (const stage of STAGE_SEQUENCE) assert.ok(STAGE_LABELS[stage]);
  assert.equal(STAGE_SEQUENCE.at(-1), "ready");
  assert.equal(stageIndex("processing"), 3);
  assert.equal(stageIndex("unknown"), 0);
  assert.equal(isTerminalStage("ready"), true);
  assert.equal(isTerminalStage("failed"), true);
  assert.equal(isTerminalStage("processing"), false);
});

test("error copy falls back to the server message and then to a default", () => {
  assert.match(errorCopy("kiri_no_credit"), /Kredit KIRI/);
  assert.equal(errorCopy("something_new", "Pesan server"), "Pesan server");
  assert.equal(errorCopy("something_new"), ERROR_COPY.default);
});

test("the stored job id is scoped, validated and removable", () => {
  const storage = fakeStorage();
  storeJobId(storage, "6bbc9bf5-e44b-4989-99cf-4fd7852634ff");
  assert.equal(storage.dump()[STORAGE_KEY], "6bbc9bf5-e44b-4989-99cf-4fd7852634ff");
  assert.equal(readStoredJobId(storage), "6bbc9bf5-e44b-4989-99cf-4fd7852634ff");
  storage.setItem(STORAGE_KEY, "../../etc/passwd");
  assert.equal(readStoredJobId(storage), null);
  clearStoredJobId(storage);
  assert.equal(readStoredJobId(storage), null);
  assert.equal(readStoredJobId(null), null);
});

test("the upload page asks for consent and never mentions a camera", () => {
  const html = renderScanUpload();
  assert.match(html, /Saya setuju video ini dikirim ke KIRI Engine/);
  assert.match(html, /data-scan-input[^>]*accept="video\/mp4"/);
  assert.match(html, /data-scan-consent/);
  assert.match(html, /data-scan-submit[^>]*disabled/);
  assert.match(html, /KIRI Engine/);
  assert.doesNotMatch(html, /getUserMedia|kamera belakang|Rekam video/i);
  assert.match(html, /data-scan-mode/);
});

test("the result page embeds the existing SPZ viewer and both actions", () => {
  const html = renderScanPreview();
  assert.match(html, /class="scan-viewer" data-scan-viewer/);
  assert.match(html, /data-scan-details/);
  assert.match(html, /href="\/jual\/pindai" data-nav/);
  assert.match(html, /href="\/beli" data-nav/);
  assert.match(html, /Tarik untuk memutar/);
});

test("result details label mock results honestly and hide long serials", () => {
  const rows = detailRows({
    mock: true,
    stage: "ready",
    source: { filename: "kursi.mp4", bytes: 1024 * 1024 },
    kiri: { serial: "abcdef1234567890abcdef1234567890" },
    artifact: { splatCount: 21_600, bytes: 1_200_000 },
    timings: { totalMs: 65_000 },
    completedAt: "2026-11-23T04:05:00.000Z",
  });
  const terms = rows.map(([term]) => term);
  assert.ok(terms.includes("Serial KIRI"));
  assert.ok(terms.includes("Jumlah splat"));
  assert.ok(terms.includes("Waktu total"));
  const serial = rows.find(([term]) => term === "Serial KIRI")[1];
  assert.equal(serial, "abcdef123456…");
  assert.equal(rows.find(([term]) => term === "Sumber")[1].startsWith("Mode simulasi"), true);
});
