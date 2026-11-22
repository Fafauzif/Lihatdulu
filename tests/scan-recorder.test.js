import test from "node:test";
import assert from "node:assert/strict";
import {
  CAPTURE_TIPS,
  GUIDANCE,
  MAX_SECONDS,
  MIN_SECONDS,
  MIME_PREFERENCE,
  cameraErrorCopy,
  guidanceAt,
  pickRecorderMime,
} from "../src/scan-recorder.js";

test("pickRecorderMime prefers mp4 then vp9 then vp8 then webm", () => {
  assert.equal(pickRecorderMime(() => true), "video/mp4;codecs=avc1.42E01E");
  assert.equal(
    pickRecorderMime((type) => type === "video/webm;codecs=vp9"),
    "video/webm;codecs=vp9",
  );
  assert.equal(
    pickRecorderMime((type) => type === "video/webm"),
    "video/webm",
  );
  assert.equal(pickRecorderMime(() => false), null);
  assert.equal(pickRecorderMime(null), null);
  assert.equal(MIME_PREFERENCE.at(-1), "video/webm");
});

test("cameraErrorCopy names every camera failure in Indonesian", () => {
  const named = (name) => Object.assign(new Error(name), { name });
  assert.match(
    cameraErrorCopy(named("NotAllowedError")),
    /Izin kamera ditolak/,
  );
  assert.match(
    cameraErrorCopy(named("NotFoundError")),
    /Kamera tidak ditemukan/,
  );
  assert.match(
    cameraErrorCopy(named("NotReadableError")),
    /Kamera sedang dipakai/,
  );
  assert.match(cameraErrorCopy({ insecure: true }), /HTTPS/);
  assert.match(cameraErrorCopy(named("WeirdError")), /Kamera belum bisa/);
});

test("guidance advances every seven seconds and stops at the last prompt", () => {
  assert.equal(MIN_SECONDS, 8);
  assert.equal(MAX_SECONDS, 45);
  assert.equal(GUIDANCE.length, 6);
  assert.equal(guidanceAt(0), GUIDANCE[0]);
  assert.equal(guidanceAt(7), GUIDANCE[1]);
  assert.equal(guidanceAt(60), GUIDANCE[5]);
  assert.equal(guidanceAt(-4), GUIDANCE[0]);
});

test("capture tips cover dark furniture and backlight", () => {
  assert.equal(CAPTURE_TIPS.length, 2);
  assert.match(CAPTURE_TIPS[0], /gelap.*samping/i);
  assert.match(CAPTURE_TIPS[1], /jendela.*belakang/i);
  assert.equal(GUIDANCE.length, 6);
});
