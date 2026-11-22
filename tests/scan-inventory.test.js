import test from "node:test";
import assert from "node:assert/strict";
import { classifyClip, frameTimes } from "../scripts/scan-inventory.mjs";

test("a 478x850 WhatsApp copy is compressed", () => {
  const result = classifyClip({ width: 478, height: 850, durationS: 25.35, bitRate: 1_860_550 });
  assert.equal(result.quality, "compressed");
  assert.match(result.warnings.join(" "), /478×850|Original/i);
});

test("a 1080x1920 original is accepted", () => {
  assert.deepEqual(
    classifyClip({ width: 1080, height: 1920, durationS: 25, bitRate: 20_000_000 }),
    { quality: "original", warnings: [] },
  );
});

test("the 3.3 s false start is flagged but stays original quality", () => {
  const result = classifyClip({ width: 1080, height: 1920, durationS: 3.33, bitRate: 20_000_000 });
  assert.equal(result.quality, "original");
  assert.match(result.warnings.join(" "), /minimal 8|terlalu singkat/i);
});

test("frameTimes samples start, middle and end", () => {
  assert.deepEqual(frameTimes(20), [2, 10, 18]);
});
