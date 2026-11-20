import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";

// Usage from the repo root: node docs/handoff/design/check-marketplace-study.mjs [output] [--baseline]
const root = fileURLToPath(new URL("../../../", import.meta.url));
const args = process.argv.slice(2);
const baseline = args.includes("--baseline");
const output = resolve(args.find((arg) => arg !== "--baseline") ?? resolve(tmpdir(), "lihatdulu-marketplace-study"));
const { preview } = await import("vite");
const { chromium } = await import("@playwright/test");
const { testBrowserPath } = await import(pathToFileURL(resolve(root, "scripts/test-browser.js")));

await mkdir(output, { recursive: true });
const port = baseline ? 5338 : 5337;
const server = await preview({ root, preview: { host: "127.0.0.1", port, strictPort: true } });
let browser;
const results = [];
const pageErrors = [];
const cases = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 900, height: 768 },
  { width: 899, height: 768 },
  { width: 768, height: 768 },
  { width: 430, height: 932 },
  { width: 390, height: 844 },
  { width: 320, height: 568 },
];

try {
  browser = await chromium.launch({
    executablePath: await testBrowserPath(),
    args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
  const page = await browser.newPage();
  page.on("pageerror", (error) => pageErrors.push(error.message));

  for (const { width, height } of cases) {
    await page.setViewportSize({ width, height });
    await page.goto(`http://127.0.0.1:${port}/beli`, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    const rail = page.getByRole("complementary", { name: "Filter katalog" });
    const trigger = page.getByRole("button", { name: /^Filter, / });
    const hasRail = width >= (baseline ? 1051 : 900);
    assert.equal(await rail.isVisible(), hasRail, `${width} px rail`);
    assert.equal(await trigger.isVisible(), !hasRail, `${width} px filter trigger`);
    assert.equal(await page.locator("[data-result-count]").textContent(), "10 furnitur ditemukan");
    const viewport = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      background: getComputedStyle(document.body).backgroundColor,
    }));
    assert.ok(viewport.scrollWidth <= width + 1, `${width} px overflow`);
    if (!baseline) assert.equal(viewport.background, "rgb(255, 255, 255)");
    const firstCard = await page.locator(".catalogue-results [data-listing]").first().boundingBox();
    assert.ok(firstCard.y < height, `${width} px first item`);

    await page.screenshot({ path: resolve(output, `catalogue-${width}.png`) });
    if (!hasRail) await trigger.click();
    const form = (hasRail ? rail : page.locator("dialog[open]")).locator("[data-filters]");
    const apply = form.locator("button[type=submit]");
    const initialApply = await apply.boundingBox();
    if (!baseline) assert.ok(initialApply.y >= 0 && initialApply.y + initialApply.height <= height, `${width} px Apply above fold`);
    await form.locator('[name="max"]').fill("1500000");
    if (!baseline && width === 390) await page.screenshot({ path: resolve(output, "filter-390.png") });
    await apply.click();
    await page.waitForURL((url) => url.searchParams.get("max") === "1500000");
    assert.equal(await page.locator("[data-result-count]").textContent(), "4 furnitur ditemukan");
    await page.getByRole("button", { name: /^Hapus.*1\.500\.000/i }).click();
    await page.waitForURL((url) => !url.searchParams.has("max"));
    assert.equal(await page.locator("[data-result-count]").textContent(), "10 furnitur ditemukan");
    results.push({ width, height, rail: hasRail, firstCardY: Math.round(firstCard.y), applyY: Math.round(initialApply.y), ...viewport, verifiedPriceFilter: true });
  }
  assert.deepEqual(pageErrors, []);
} finally {
  await writeFile(resolve(output, "checks.json"), JSON.stringify({ baseline, results, pageErrors }, null, 2) + "\n");
  await browser?.close();
  await new Promise((done) => server.httpServer.close(done));
}
console.log(`Verified ${results.length} viewport cases. Evidence: ${output}`);
