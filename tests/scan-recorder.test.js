import test from "node:test";
import assert from "node:assert/strict";
import {
  GUIDANCE,
  MAX_SECONDS,
  MIN_SECONDS,
  cameraErrorCopy,
  clipName,
  extensionForMime,
  guidanceAt,
  pickRecorderMime,
  recorderErrorCopy,
  timeLabel,
} from "../src/scan-recorder.js";

// The recorder is the first thing a judge touches on a phone. These tests pin
// the format choice and the recovery sentence for every way it can fail.

test("MP4 is preferred, WebM is the accepted fallback, nothing else is invented", () => {
  assert.equal(
    pickRecorderMime((type) => type.startsWith("video/mp4")),
    "video/mp4;codecs=avc1.42E01E",
  );
  assert.equal(
    pickRecorderMime((type) => type.includes("webm")),
    "video/webm;codecs=vp9",
  );
  assert.equal(pickRecorderMime(() => false), null);
  assert.equal(pickRecorderMime(null), null);
  // Safari throws for codec strings it does not know instead of returning false.
  assert.equal(
    pickRecorderMime((type) => {
      if (type.includes("codecs")) throw new Error("bad type");
      return type === "video/webm";
    }),
    "video/webm",
  );
});

test("the clip keeps an extension the server can trust", () => {
  assert.equal(extensionForMime("video/mp4;codecs=avc1"), "mp4");
  assert.equal(extensionForMime("video/webm;codecs=vp8"), "webm");
  assert.equal(clipName("video/webm", 1700000000000), "rekaman-1700000000000.webm");
  assert.equal(clipName("video/mp4", 42), "rekaman-42.mp4");
});

test("guidance advances with the recording and stops on the last step", () => {
  assert.equal(guidanceAt(0), GUIDANCE[0]);
  assert.equal(guidanceAt(6.9), GUIDANCE[0]);
  assert.equal(guidanceAt(7), GUIDANCE[1]);
  assert.equal(guidanceAt(1000), GUIDANCE.at(-1));
  assert.equal(guidanceAt(undefined), GUIDANCE[0]);
  assert.equal(GUIDANCE.length, 6);
  assert.ok(MIN_SECONDS >= 8 && MIN_SECONDS < MAX_SECONDS);
});

test("every camera failure names a next action", () => {
  assert.match(cameraErrorCopy({ insecure: true }), /HTTPS/);
  assert.match(cameraErrorCopy({ name: "NotAllowedError" }), /Izinkan kamera/);
  assert.match(cameraErrorCopy({ name: "SecurityError" }), /Izinkan kamera/);
  assert.match(cameraErrorCopy({ name: "NotFoundError" }), /tidak ditemukan/);
  assert.match(cameraErrorCopy({ name: "NotReadableError" }), /dipakai aplikasi lain/);
  for (const copy of [
    cameraErrorCopy({ insecure: true }),
    cameraErrorCopy({ name: "NotAllowedError" }),
    cameraErrorCopy({ name: "NotFoundError" }),
    cameraErrorCopy({ name: "NotReadableError" }),
    cameraErrorCopy({ name: "WeirdError" }),
  ])
    assert.match(copy, /kamera/i);
  assert.match(cameraErrorCopy({ name: "NotAllowedError" }), /rekam lewat aplikasi kamera/i);
});

test("recorder failures distinguish empty, short and unsupported", () => {
  assert.match(recorderErrorCopy({ unsupported: true }), /aplikasi kamera/);
  assert.match(recorderErrorCopy({ empty: true }), /kosong/);
  assert.match(recorderErrorCopy({ short: true }), /minimal 8 detik/);
  assert.match(recorderErrorCopy({}), /Coba rekam lagi/);
});

test("the timer is a clock, not a raw second count", () => {
  assert.equal(timeLabel(0), "0:00");
  assert.equal(timeLabel(9.7), "0:09");
  assert.equal(timeLabel(65), "1:05");
  assert.equal(timeLabel(undefined), "0:00");
});
