import test from "node:test";
import assert from "node:assert/strict";
import {
  PREVIEW_COPY,
  formatArtifactSize,
  formatDimensions,
  formatDuration,
} from "../src/scan-api.js";

test("preview copy separates a new scan from the Sora example", () => {
  assert.equal(PREVIEW_COPY.badge, "Pindai baru");
  assert.match(PREVIEW_COPY.disclaimer, /bukan contoh Sora/);
  assert.equal(PREVIEW_COPY.retake, "Rekam barang lain");
  assert.equal(PREVIEW_COPY.catalog, "Lihat katalog");
});

test("formatDimensions uses Indonesian decimals and the L x D x T order", () => {
  assert.equal(
    formatDimensions({ widthCm: 58.5, depthCm: 63, heightCm: 84 }),
    "58,5 × 63 × 84 cm",
  );
});

test("formatArtifactSize and formatDuration stay readable", () => {
  assert.equal(formatArtifactSize(13_002_342), "12,4 MB");
  assert.equal(formatArtifactSize(0), "0 MB");
  assert.equal(formatDuration(65_000), "1 mnt 05 dtk");
  assert.equal(formatDuration(9_000), "9 dtk");
});
