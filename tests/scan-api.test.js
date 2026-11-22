import test from "node:test";
import assert from "node:assert/strict";
import {
  ERROR_COPY,
  PREVIEW_COPY,
  STAGE_LABELS,
  STAGE_SEQUENCE,
  buildMetaQuery,
  nextPollDelay,
} from "../src/scan-api.js";

test("buildMetaQuery converts comma decimals and encodes Indonesian text", () => {
  const query = buildMetaQuery({
    title: "Kursi Kayu",
    widthCm: 58.5,
    depthCm: 63,
    heightCm: 84,
    conditionNote: "goresan ringan",
    device: "Android",
    clientId: "6f1c2b7e-8a4d-4c3e-9f10-2b3c4d5e6f70",
  });
  const params = new URLSearchParams(query);
  assert.equal(params.get("title"), "Kursi Kayu");
  assert.equal(params.get("w"), "58.5");
  assert.equal(params.get("d"), "63");
  assert.equal(params.get("h"), "84");
  assert.equal(params.get("note"), "goresan ringan");
  assert.equal(params.get("device"), "Android");
  assert.equal(params.get("cid"), "6f1c2b7e-8a4d-4c3e-9f10-2b3c4d5e6f70");
  assert.equal(params.get("note").includes("+"), false);
});

test("every server stage and error code has Indonesian copy", () => {
  for (const stage of STAGE_SEQUENCE) assert.ok(STAGE_LABELS[stage], stage);
  for (const code of [
    "footage_short",
    "alignment_failed",
    "tool_missing",
    "queue_full",
    "not_found",
    "too_large",
    "unsupported_media",
    "server_stopped",
    "network",
    "aborted",
  ])
    assert.ok(ERROR_COPY[code], code);
  assert.equal(STAGE_LABELS.failed, "Gagal");
  assert.match(ERROR_COPY.footage_short, /Rekam 30–45 detik/);
  assert.equal(PREVIEW_COPY.badge, "Pindai baru");
  assert.match(PREVIEW_COPY.disclaimer, /bukan contoh Sora/);
});

test("nextPollDelay backs off and caps at 8 seconds", () => {
  assert.deepEqual([0, 1, 2, 3, 9].map(nextPollDelay), [2000, 3000, 5000, 8000, 8000]);
});

test("alignment copy names the dark-object fix", () => {
  assert.match(ERROR_COPY.alignment_failed, /gelap.*samping/i);
});
