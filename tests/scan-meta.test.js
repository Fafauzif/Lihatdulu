import test from "node:test";
import assert from "node:assert/strict";
import {
  ALLOWED_MEDIA,
  mediaExtension,
  parseScanMeta,
} from "../server/scan-meta.mjs";
import { ScanError } from "../server/scan-errors.mjs";

const valid = {
  title: "  Kursi Kayu  ",
  w: "58,5",
  d: "63",
  h: "84",
  note: " goresan ringan ",
  device: "Android",
};

test("parseScanMeta normalizes comma decimals and trims text", () => {
  const meta = parseScanMeta(new URLSearchParams(valid));
  assert.deepEqual(meta, {
    title: "Kursi Kayu",
    widthCm: 58.5,
    depthCm: 63,
    heightCm: 84,
    conditionNote: "goresan ringan",
    device: "Android",
    clientId: "",
  });
});

test("parseScanMeta rejects missing, out-of-range and overlong values with bad_metadata", () => {
  const bad = [
    new URLSearchParams({ title: "Kursi", w: "0", d: "63", h: "84" }),
    new URLSearchParams({ title: "", w: "58", d: "63", h: "84" }),
    new URLSearchParams({ title: "x".repeat(81), w: "58", d: "63", h: "84" }),
    new URLSearchParams({ ...valid, note: "x".repeat(201) }),
    new URLSearchParams({ ...valid, w: "1,25" }),
    new URLSearchParams({ ...valid, d: "1001" }),
  ];
  for (const params of bad)
    assert.throws(
      () => parseScanMeta(params),
      (error) =>
        error instanceof ScanError &&
        error.code === "bad_metadata" &&
        error.status === 400,
    );
});

test("parseScanMeta accepts a UUID client id and rejects a malformed one", () => {
  const cid = "6f1c2b7e-8a4d-4c3e-9f10-2b3c4d5e6f70";
  assert.equal(
    parseScanMeta(new URLSearchParams({ ...valid, cid })).clientId,
    cid,
  );
  assert.throws(
    () => parseScanMeta(new URLSearchParams({ ...valid, cid: "retry-1" })),
    (error) => error.code === "bad_metadata",
  );
});

test("mediaExtension accepts only the allowlist", () => {
  assert.deepEqual(ALLOWED_MEDIA, [
    "video/mp4",
    "video/webm",
    "video/quicktime",
  ]);
  assert.equal(mediaExtension("video/webm;codecs=vp9"), "webm");
  assert.equal(mediaExtension("VIDEO/MP4"), "mp4");
  assert.equal(mediaExtension("video/quicktime"), "mov");
  assert.equal(mediaExtension("text/html"), null);
  assert.equal(mediaExtension(null), null);
});
