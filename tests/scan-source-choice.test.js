import test from "node:test";
import assert from "node:assert/strict";
import {
  detailRows,
  preferredSource,
  provenanceSummary,
  readSourceChoice,
  resolveSource,
  sourceChoiceKey,
  sourceOptions,
  writeSourceChoice,
} from "../src/scan-views.js";

// The saved chair result is the page a judge opens without spending a credit.
// These pin the three rules that page has to keep: photos open first, an
// explicit tab choice survives a reload, and the two short provenance lines
// stay honest about the mesh and the seller's dimensions.

const demo = {
  id: "demo-chair",
  stage: "ready",
  demo: true,
  mock: false,
  completedAt: "2026-11-23T11:19:22.111Z",
  source: {
    filename: "kursi-kayu-golden101.zip",
    bytes: 19386097,
    kind: "photos",
    photos: 101,
    dimensions: { length: 45, width: 50, height: 85, unit: "cm" },
  },
  input: { mode: "photo", source: "photos", photos: 101, modelQuality: 3 },
  artifact: {
    format: "glb",
    bytes: 1950948,
    triangles: 19246,
    url: "/demo/kursi/result.glb",
    refined: true,
    raw: { url: "/demo/kursi/raw.glb", bytes: 1932024, triangles: 19246 },
  },
  photos: Array.from({ length: 8 }, (_, index) => ({
    url: `/demo/kursi/photos/${index + 1}.jpg`,
  })),
  refine: {
    status: "applied",
    metrics: {
      trianglesBefore: 19246,
      trianglesAfter: 19246,
      coverage: { verdict: "berlubang", holeRatioAfter: 0.187566, worstAxis: "y" },
    },
  },
};

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
    dump: () => Object.fromEntries(data),
  };
}

test("a fresh visit opens the saved chair on its original photos", () => {
  assert.equal(preferredSource(demo), "photos");
  assert.equal(resolveSource(demo, null), "photos");
  assert.equal(resolveSource(demo, "nonsense"), "photos");
});

test("an explicit source choice is kept for that result only", () => {
  const storage = memoryStorage();
  assert.equal(readSourceChoice(storage, demo.id), null);
  assert.equal(writeSourceChoice(storage, demo.id, "refined"), true);
  assert.equal(storage.dump()[sourceChoiceKey(demo.id)], "refined");
  assert.equal(resolveSource(demo, readSourceChoice(storage, demo.id)), "refined");
  // Another result must not inherit the choice.
  assert.equal(readSourceChoice(storage, "other-job"), null);
});

test("a stored source that this job no longer offers falls back to the default", () => {
  const withoutRefined = {
    ...demo,
    artifact: { ...demo.artifact, refined: false, url: demo.artifact.raw.url },
    photos: demo.photos,
  };
  assert.deepEqual(
    sourceOptions(withoutRefined).map((option) => option.id),
    ["photos", "raw"],
  );
  assert.equal(resolveSource(withoutRefined, "refined"), "photos");
});

test("blocked storage never breaks the source switcher", () => {
  const blocked = {
    getItem() {
      throw new Error("denied");
    },
    setItem() {
      throw new Error("denied");
    },
  };
  assert.equal(readSourceChoice(blocked, demo.id), null);
  assert.equal(writeSourceChoice(blocked, demo.id, "raw"), false);
  assert.equal(resolveSource(demo, readSourceChoice(blocked, demo.id)), "photos");
});

test("the summary names the source, the photo count and the missing geometry", () => {
  const summary = provenanceSummary(demo);
  assert.match(summary.source, /KIRI Engine Photo Scan Ultra/);
  assert.match(summary.source, /101 foto dikirim/);
  const text = summary.limits.join(" ");
  assert.match(text, /18,8%/);
  assert.match(text, /jaring/);
  assert.match(text, /tidak ditambal/);
  assert.match(text, /45 × 50 × 85 cm/);
  assert.match(text, /berasal dari penjual, bukan hasil ukur model/);
  assert.match(text, /8 foto asli disimpan/);
});

test("a generic job gets the same honesty without the chair story", () => {
  const summary = provenanceSummary({
    ...demo,
    demo: false,
    source: { ...demo.source, filename: "kursi.mp4", dimensions: undefined },
    input: { mode: "splat", photos: 60 },
  });
  assert.match(summary.source, /KIRI Engine 3DGS video/);
  assert.doesNotMatch(summary.limits.join(" "), /jaring/);
  assert.doesNotMatch(summary.limits.join(" "), /berasal dari penjual/);
});

test("an unfinished job has no provenance to show yet", () => {
  assert.deepEqual(provenanceSummary({ stage: "processing" }), {
    source: "",
    limits: [],
  });
  assert.deepEqual(provenanceSummary(null), { source: "", limits: [] });
});

test("the technical rows hide the internal archive name and flag the dimensions", () => {
  const rows = detailRows(demo);
  const flat = rows.flat().join(" | ");
  assert.doesNotMatch(flat, /kursi-kayu-golden101/);
  assert.match(flat, /101 foto dari ponsel/);
  assert.match(flat, /bukan hasil ukur model/);
});
