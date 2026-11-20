import { ScanError } from "./scan-errors.mjs";

// The metadata travels in the upload query string so the clip body stays a
// plain stream: no multipart parser, no new server dependency.

export const ALLOWED_MEDIA = Object.freeze([
  "video/mp4",
  "video/webm",
  "video/quicktime",
]);

const MEDIA_EXTENSIONS = Object.freeze({
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
});

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function mediaExtension(contentType) {
  if (typeof contentType !== "string") return null;
  const base = contentType.split(";")[0].trim().toLowerCase();
  return MEDIA_EXTENSIONS[base] ?? null;
}

function fail() {
  throw new ScanError("bad_metadata", "Metadata pindai tidak valid.");
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function dimension(value) {
  const raw = text(value);
  if (!/^\d{1,4}(?:[.,]\d)?$/.test(raw)) fail();
  const number = Number(raw.replace(",", "."));
  if (!Number.isFinite(number) || number < 1 || number > 1000) fail();
  return number;
}

export function parseScanMeta(params) {
  if (!(params instanceof URLSearchParams)) fail();
  const title = text(params.get("title"));
  if (title.length < 2 || title.length > 80) fail();
  const conditionNote = text(params.get("note"));
  if (conditionNote.length > 200) fail();
  const device = text(params.get("device"));
  if (device.length > 120) fail();
  const rawClientId = text(params.get("cid"));
  if (rawClientId && !UUID_V4.test(rawClientId)) fail();
  return {
    title,
    widthCm: dimension(params.get("w")),
    depthCm: dimension(params.get("d")),
    heightCm: dimension(params.get("h")),
    conditionNote,
    device,
    clientId: rawClientId.toLowerCase(),
  };
}
