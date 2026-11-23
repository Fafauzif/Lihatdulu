import test from "node:test";
import assert from "node:assert/strict";
import {
  crc32,
  extractSplat,
  listZipEntries,
  pickSplatEntry,
  readZipEntry,
} from "../server/zip.mjs";
import { buildZip } from "./helpers/zip-fixture.mjs";

const PLY = Buffer.from("ply\nformat ascii 1.0\nelement vertex 1\nend_header\n");

test("crc32 matches the classic check value", () => {
  assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926);
});

test("stored and deflated entries both round-trip", () => {
  const zip = buildZip([
    { name: "point_cloud/iteration_1/point_cloud.ply", data: PLY, method: "deflate" },
    { name: "readme.txt", data: Buffer.from("halo"), method: "store" },
  ]);
  const entries = listZipEntries(zip);
  assert.equal(entries.length, 2);
  const ply = entries.find((entry) => entry.name.endsWith(".ply"));
  assert.deepEqual(readZipEntry(zip, ply), PLY);
});

test("the largest point_cloud PLY wins when a ZIP carries several", () => {
  const zip = buildZip([
    { name: "a/small.ply", data: Buffer.alloc(10) },
    { name: "point_cloud/big.ply", data: Buffer.alloc(500) },
    { name: "other/medium.ply", data: Buffer.alloc(200) },
  ]);
  const entry = pickSplatEntry(listZipEntries(zip));
  assert.equal(entry.name, "point_cloud/big.ply");
  const extracted = extractSplat(zip);
  assert.equal(extracted.name, "point_cloud/big.ply");
  assert.equal(extracted.data.length, 500);
});

test("a ZIP without a PLY is rejected", () => {
  const zip = buildZip([{ name: "model.obj", data: Buffer.from("v 0 0 0") }]);
  assert.throws(() => extractSplat(zip), (error) => error.code === "zip_invalid");
});

test("a CRC mismatch is rejected instead of serving corrupt splats", () => {
  const zip = buildZip([{ name: "point_cloud.ply", data: PLY }], { corruptCrc: true });
  assert.throws(() => extractSplat(zip), (error) => error.code === "zip_invalid");
});

test("zip-slip names are refused", () => {
  const zip = buildZip([{ name: "../evil.ply", data: PLY }]);
  assert.throws(() => listZipEntries(zip), (error) => error.code === "zip_invalid");
});

test("a truncated or empty ZIP reports zip_invalid", () => {
  assert.throws(() => listZipEntries(Buffer.alloc(4)), (error) => error.code === "zip_invalid");
  const zip = buildZip([{ name: "x.ply", data: PLY }]);
  assert.throws(
    () => extractSplat(zip.subarray(0, zip.length - 30)),
    (error) => error.code === "zip_invalid",
  );
});

test("an entry larger than the PLY ceiling is refused before inflating", () => {
  const zip = buildZip([{ name: "point_cloud.ply", data: Buffer.alloc(64) }]);
  assert.throws(
    () => extractSplat(zip, { maxBytes: 16 }),
    (error) => error.code === "artifact_too_large",
  );
});
