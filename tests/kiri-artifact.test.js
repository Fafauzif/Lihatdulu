import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildConvertArgs,
  convertPlyToSpz,
  parsePlyHeader,
  readGlbJson,
  validateGlb,
  validateSplatPly,
  validateSpz,
} from "../server/kiri-artifact.mjs";
import { syntheticChairPly } from "../server/kiri-mock.mjs";

const HEADER = [
  "ply",
  "format binary_little_endian 1.0",
  "element vertex 2",
  "property float x",
  "property float y",
  "property float z",
  "property float f_dc_0",
  "property float f_dc_1",
  "property float f_dc_2",
  "property float opacity",
  "property float scale_0",
  "property float scale_1",
  "property float scale_2",
  "property float rot_0",
  "property float rot_1",
  "property float rot_2",
  "property float rot_3",
  "end_header",
  "",
].join("\n");

function plyBuffer(vertices = 2, header = HEADER, padding = 0) {
  const text = header.replace("element vertex 2", `element vertex ${vertices}`);
  return Buffer.concat([
    Buffer.from(text, "latin1"),
    Buffer.alloc(vertices * 14 * 4 + padding),
  ]);
}

test("parsePlyHeader reads the vertex count and stride", () => {
  const header = parsePlyHeader(plyBuffer());
  assert.equal(header.count, 2);
  assert.equal(header.format, "binary_little_endian");
  assert.equal(header.stride, 14 * 4);
  assert.ok(header.properties.includes("f_dc_0"));
});

test("a valid gaussian PLY passes with its splat count", () => {
  const result = validateSplatPly(plyBuffer(3));
  assert.equal(result.splatCount, 3);
});

test("a point-cloud PLY without gaussian properties is refused", () => {
  const header = HEADER.replace("property float f_dc_0\n", "")
    .replace("property float opacity\n", "");
  assert.throws(() => validateSplatPly(plyBuffer(2, header)), (error) => {
    assert.equal(error.code, "ply_invalid");
    assert.match(error.detail, /f_dc_0/);
    assert.match(error.detail, /opacity/);
    return true;
  });
});

test("an empty or truncated PLY is refused with a distinct code", () => {
  assert.throws(() => validateSplatPly(Buffer.alloc(0)), (error) => error.code === "ply_empty");
  assert.throws(
    () => validateSplatPly(plyBuffer(200).subarray(0, 200)),
    (error) => error.code === "ply_invalid",
  );
});

test("a PLY above the splat ceiling is refused", () => {
  assert.throws(
    () => validateSplatPly(plyBuffer(10), { maxSplats: 4 }),
    (error) => error.code === "artifact_too_large",
  );
});

test("validateSpz reads magic, version and splat count", () => {
  const spz = Buffer.alloc(20);
  spz.write("NGSP", 0, "latin1");
  spz.writeUInt32LE(3, 4);
  spz.writeUInt32LE(1234, 8);
  assert.deepEqual(validateSpz(spz), { version: 3, splatCount: 1234, bytes: 20 });
  assert.throws(() => validateSpz(Buffer.alloc(20)), (error) => error.code === "spz_invalid");
});

test("buildConvertArgs keeps the pinned filter and output order", () => {
  assert.deepEqual(
    buildConvertArgs({ inputPly: "in.ply", outputSpz: "out.spz" }),
    ["in.ply", "--filter-nan", "out.spz"],
  );
});

test("a synthetic chair PLY converts to a readable SPZ", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "lihatdulu-convert-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const input = join(dir, "chair.ply");
  const output = join(dir, "chair.spz");
  await writeFile(input, syntheticChairPly());
  const timing = await convertPlyToSpz({ inputPath: input, outputPath: output, timeoutMs: 60_000 });
  assert.ok(timing.ms >= 0);
  const spz = await readFile(output);
  const artifact = validateSpz(spz);
  assert.equal(artifact.splatCount, 21600);
  assert.ok(artifact.bytes > 0);
});

test("validateGlb accepts KIRI's mesh shape and counts triangles", async () => {
  const { syntheticChairGlb } = await import("../server/kiri-mock.mjs");
  const glb = syntheticChairGlb();
  const artifact = validateGlb(glb);
  assert.equal(artifact.bytes, glb.length);
  // Six boxes: seat, backrest and four legs, twelve triangles each.
  assert.equal(artifact.triangles, 72);
  assert.equal(artifact.meshes, 1);
  assert.equal(artifact.generator, "LihatDulu mock");
});

test("validateGlb refuses a truncated or non-GLB artifact", async () => {
  const { syntheticChairGlb } = await import("../server/kiri-mock.mjs");
  const glb = syntheticChairGlb();
  assert.throws(
    () => validateGlb(glb.subarray(0, glb.length - 8)),
    (error) => error.code === "model_invalid",
  );
  assert.throws(
    () => validateGlb(Buffer.from("ply\nformat binary_little_endian 1.0\n")),
    (error) => error.code === "model_invalid",
  );
  assert.throws(
    () => validateGlb(Buffer.alloc(0)),
    (error) => error.code === "model_invalid",
  );
});

test("validateGlb caps the served mesh size", async () => {
  const { syntheticChairGlb } = await import("../server/kiri-mock.mjs");
  assert.throws(
    () => validateGlb(syntheticChairGlb(), { maxBytes: 32 }),
    (error) => error.code === "artifact_too_large",
  );
});
