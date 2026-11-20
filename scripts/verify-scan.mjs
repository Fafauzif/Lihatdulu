import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { chromium } from "@playwright/test";
import { testBrowserPath } from "./test-browser.js";
import { createScanServer } from "../server/scan-server.mjs";
import { runFakePipeline } from "../server/scan-fake.mjs";
import { listJobs } from "../server/scan-jobs.mjs";

// End-to-end scan journey against the production bundle: fake camera, fake
// pipeline, real upload/status/viewer code. Evidence stays outside the repo.

const rootDir = fileURLToPath(new URL("../", import.meta.url));
const output = process.env.QA_OUTPUT || path.resolve(rootDir, "../../qa-scan");
await fs.mkdir(output, { recursive: true });
const jobRoot = await mkdtemp(path.join(tmpdir(), "lihatdulu-scan-"));
process.env.SCAN_FAKE_DELAY_MS = "200";
const { url, close } = await createScanServer({
  root: jobRoot,
  pipeline: runFakePipeline,
  distDir: path.join(rootDir, "dist"),
});
const browser = await chromium.launch({
  executablePath: await testBrowserPath(),
  headless: true,
  args: [
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
const report = {
  started: new Date().toISOString(),
  checks: [],
  screenshots: [],
  pageErrors: [],
  consoleErrors: [],
};
const shots = new Set();
async function persist() {
  await fs.writeFile(
    path.join(output, "report.json"),
    JSON.stringify(report, null, 2),
  );
}
async function check(name, run) {
  try {
    const evidence = await run();
    report.checks.push({ name, pass: true, evidence });
    console.log("PASS", name);
  } catch (error) {
    report.checks.push({ name, pass: false, error: error.stack || error.message });
    console.error("FAIL", name, error.message);
  }
  await persist();
}
function watch(page) {
  page.on("pageerror", (error) =>
    report.pageErrors.push({ url: page.url(), message: error.message }),
  );
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    if (/Failed to load resource|net::ERR_FAILED|status of 404/.test(message.text()))
      return;
    report.consoleErrors.push({ url: page.url(), message: message.text() });
  });
}
async function shot(page, name) {
  const file = path.join(output, name);
  await page.screenshot({ path: file, fullPage: false });
  if (!shots.has(file)) {
    shots.add(file);
    report.screenshots.push(file);
  }
}
async function openCapture(context) {
  const page = await context.newPage();
  watch(page);
  await page.goto(`${url}/jual/pindai`, { waitUntil: "domcontentloaded" });
  await page.locator("[data-scan-capture]").waitFor();
  return page;
}
async function startCamera(page) {
  await page.locator("[data-scan-camera]").click();
  await page.waitForFunction(
    () => document.querySelector("[data-scan-video]")?.readyState >= 2,
    { timeout: 20000 },
  );
}
async function record(page, seconds = 8.5) {
  await startCamera(page);
  await page.locator("[data-scan-start]").click();
  await page.waitForTimeout(seconds * 1000);
  await page.locator("[data-scan-stop]").click();
  await page.locator("[data-scan-review]:not([hidden])").waitFor({
    timeout: 10000,
  });
  await page.locator("[data-scan-use]").click();
  await page.locator("[data-scan-form]:not([hidden])").waitFor();
}
async function fillDetails(page, title) {
  await page.fill('[name="title"]', title);
  await page.fill('[name="widthCm"]', "58,5");
  await page.fill('[name="depthCm"]', "63");
  await page.fill('[name="heightCm"]', "84");
  await page.fill('[name="conditionNote"]', "Goresan ringan di sisi kiri.");
}
async function waitReady(id) {
  for (let i = 0; i < 200; i++) {
    const dto = await (await fetch(`${url}/api/scans/${id}`)).json();
    if (dto.stage === "ready") return dto;
    if (dto.stage === "failed") throw new Error("job failed");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("job did not become ready");
}

let mainId = null;
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    permissions: ["camera"],
  });
  const page = await context.newPage();
  watch(page);
  await page.addInitScript(() => {
    window.__mediaCalls = 0;
    const original = navigator.mediaDevices?.getUserMedia?.bind(
      navigator.mediaDevices,
    );
    if (navigator.mediaDevices && original) {
      navigator.mediaDevices.getUserMedia = (constraints) => {
        window.__mediaCalls += 1;
        return original(constraints);
      };
    }
  });

  await check("capture route does not request camera on load", async () => {
    await page.goto(`${url}/jual/pindai`, { waitUntil: "domcontentloaded" });
    await page.locator("[data-scan-capture]").waitFor();
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => window.__mediaCalls), 0);
  });

  await check("camera starts only after the tap", async () => {
    await startCamera(page);
    assert.equal(await page.evaluate(() => window.__mediaCalls), 1);
    assert.equal(
      await page.evaluate(
        () => document.querySelector("[data-scan-video]").videoWidth > 0,
      ),
      true,
    );
  });

  await check("record, review and use a clip", async () => {
    await page.locator("[data-scan-start]").click();
    await page.waitForTimeout(8600);
    await page.locator("[data-scan-stop]").click();
    await page.locator("[data-scan-review]:not([hidden])").waitFor({
      timeout: 10000,
    });
    assert.equal(
      await page.evaluate(() =>
        document.querySelector("[data-scan-review]").src.startsWith("blob:"),
      ),
      true,
    );
    await page.locator("[data-scan-use]").click();
    await page.locator("[data-scan-form]:not([hidden])").waitFor();
  });

  await check("upload navigates to the status page and reaches ready", async () => {
    await fillDetails(page, "Kursi Jati");
    await page.locator("[data-scan-send]").click();
    await page.waitForURL(/\/pindai\/[0-9a-f-]{36}$/, { timeout: 20000 });
    mainId = new URL(page.url()).pathname.split("/").pop();
    assert.match(await page.locator(".scan-preview-badge").innerText(), /Pindai baru/i);
    await page.locator("[data-scan-stage-list]").waitFor();
    await page.waitForFunction(() => document.querySelector("[data-scan-viewer]")?.dataset.state === "ready", { timeout: 30000 }); await page.waitForTimeout(700);
    const dto = await waitReady(mainId);
    assert.equal(dto.meta.title, "Kursi Jati");
    assert.equal(dto.provenance.frames.registered, 78);
  });

  await check("ready preview shows a rendered splat, stills and provenance", async () => {
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    const viewer = page.locator("[data-scan-viewer]");
    assert.equal(
      await page.evaluate(
        () => document.querySelector("[data-scan-viewer]")?.dataset.splats,
      ),
      "4096",
    );
    await page.waitForTimeout(500);
    const bytes = await viewer.screenshot();
    const file = path.join(output, "viewer-390.png");
    await fs.writeFile(file, bytes);
    report.screenshots.push(file);
    shots.add(file);
    assert.ok(bytes.length > 15000, `viewer screenshot only ${bytes.length} bytes`);
    assert.equal(await page.locator("[data-scan-stills-row] img").count(), 3);
    const sources = await page
      .locator("[data-scan-stills-row] img")
      .evaluateAll((images) => images.map((image) => image.src));
    for (const source of sources) {
      const response = await page.request.get(source);
      assert.equal(response.status(), 200);
    }
    assert.match(
      await page.locator("[data-scan-provenance]").innerText(),
      /78 terdaftar/,
    );
    assert.equal(await page.locator("[data-scan-viewer-placeholder]").isVisible(), false);
    assert.equal(await page.locator("[data-scan-viewer-hint]").isVisible(), true);
  });

  await check("deep link reload restores the ready viewer", async () => {
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.querySelector("[data-scan-viewer]")?.dataset.state === "ready", { timeout: 30000 }); await page.waitForTimeout(700);
    assert.match(await page.locator("[data-scan-title]").innerText(), /Kursi Jati/);
  });

  await check("unknown job shows the Indonesian not-found state", async () => {
    await page.goto(`${url}/pindai/not-a-uuid`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() =>
      document
        .querySelector("[data-scan-title]")
        ?.textContent.includes("tidak ditemukan"),
    );
    assert.ok((await page.locator('a[href="/jual/pindai"]').count()) >= 1);
    assert.ok((await page.locator('a[href="/beli"]').count()) >= 1);
  });

  await check("upload abort shows the network copy and retry creates one job", async () => {
    await page.goto(`${url}/jual/pindai`, { waitUntil: "domcontentloaded" });
    await page.locator("[data-scan-capture]").waitFor();
    await record(page);
    await fillDetails(page, "Kursi Ulang");
    await page.route(/\/api\/scans\?/, (route) => route.abort("failed"));
    await page.locator("[data-scan-send]").click();
    await page.waitForFunction(() =>
      document
        .querySelector("[data-scan-status]")
        ?.textContent.includes("Sambungan terputus"),
    );
    assert.match(
      await page.locator("[data-scan-send]").innerText(),
      /Coba kirim lagi/,
    );
    await page.unroute(/\/api\/scans\?/);
    await page.locator("[data-scan-send]").click();
    await page.waitForURL(/\/pindai\/[0-9a-f-]{36}$/, { timeout: 20000 });
    const retryId = new URL(page.url()).pathname.split("/").pop();
    await waitReady(retryId);
    const jobs = await listJobs(jobRoot);
    assert.equal(
      jobs.filter((job) => job.meta.title === "Kursi Ulang").length,
      1,
    );
  });

  await check("prepared Sora route still never requests device media", async () => {
    const sora = await context.newPage();
    watch(sora);
    await sora.addInitScript(() => {
      window.__mediaCalls = 0;
      if (navigator.mediaDevices) {
        const original = navigator.mediaDevices.getUserMedia?.bind(
          navigator.mediaDevices,
        );
        navigator.mediaDevices.getUserMedia = (constraints) => {
          window.__mediaCalls += 1;
          return original ? original(constraints) : Promise.reject(new Error("no"));
        };
      }
    });
    await sora.goto(`${url}/jual/sora/rekam`, { waitUntil: "domcontentloaded" });
    await sora.locator("[data-video-player]").waitFor();
    await sora.waitForTimeout(400);
    assert.equal(await sora.evaluate(() => window.__mediaCalls), 0);
    await sora.close();
  });

  await check("seller workspace shows the new scan entry and the Sora label", async () => {
    await page.goto(`${url}/jual`, { waitUntil: "domcontentloaded" });
    await page.locator(".vj-scan-entry").waitFor();
    assert.match(await page.locator(".vj-scan-entry").innerText(), /Pindai furnitur baru/);
    assert.match(await page.locator(".vj-topline").innerText(), /Contoh: Lemari Sora/);
    assert.ok((await page.locator('a[href="/jual/pindai"]').count()) >= 1);
  });

  await check("390 px has no horizontal overflow on capture and preview", async () => {
    await page.goto(`${url}/jual/pindai`, { waitUntil: "domcontentloaded" });
    await page.locator("[data-scan-capture]").waitFor();
    let overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    assert.ok(overflow <= 1, `capture overflow ${overflow}`);
    await shot(page, "capture-390.png");
    await page.goto(`${url}/pindai/${mainId}`, { waitUntil: "domcontentloaded" });
    await page.locator("[data-scan-viewer]").waitFor();
    overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    assert.ok(overflow <= 1, `preview overflow ${overflow}`);
    await shot(page, "preview-390.png");
  });

  await check("320 px keeps the primary actions visible", async () => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto(`${url}/jual/pindai`, { waitUntil: "domcontentloaded" });
    await page.locator("[data-scan-camera]").waitFor();
    assert.equal(await page.locator("[data-scan-camera]").isVisible(), true);
    let overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    assert.ok(overflow <= 1, `capture overflow ${overflow}`);
    await page.goto(`${url}/pindai/${mainId}`, { waitUntil: "domcontentloaded" });
    await page.locator(".scan-preview-actions").waitFor();
    assert.equal(
      await page.locator('.scan-preview-actions a[href="/jual/pindai"]').isVisible(),
      true,
    );
    overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    assert.ok(overflow <= 1, `preview overflow ${overflow}`);
  });

  await check("denied camera permission explains the fix", async () => {
    const denied = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    const blocked = await denied.newPage();
    watch(blocked);
    await blocked.addInitScript(() => {
      if (navigator.mediaDevices)
        navigator.mediaDevices.getUserMedia = async () => {
          const error = new Error("denied");
          error.name = "NotAllowedError";
          throw error;
        };
    });
    await blocked.goto(`${url}/jual/pindai`, { waitUntil: "domcontentloaded" });
    await blocked.locator("[data-scan-capture]").waitFor();
    await blocked.locator("[data-scan-camera]").click();
    await blocked.waitForFunction(() =>
      document
        .querySelector("[data-scan-status]")
        ?.textContent.includes("Izin kamera ditolak"),
    );
    assert.equal(
      await blocked.locator("[data-scan-form]").isVisible(),
      false,
    );
    await shot(blocked, "denied-390.png");
    await denied.close();
  });

  await check("unsupported recorder explains the browser limit", async () => {
    const legacy = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    const noRecord = await legacy.newPage();
    watch(noRecord);
    await noRecord.addInitScript(() => {
      window.MediaRecorder = undefined;
    });
    await noRecord.goto(`${url}/jual/pindai`, { waitUntil: "domcontentloaded" });
    await noRecord.locator("[data-scan-capture]").waitFor();
    await noRecord.locator("[data-scan-camera]").click();
    await noRecord.waitForFunction(() =>
      document
        .querySelector("[data-scan-status]")
        ?.textContent.includes("belum bisa merekam video"),
    );
    await legacy.close();
  });

  await check("failed reconstruction names the reason and offers a retake", async () => {
    process.env.SCAN_FAKE_FAIL = "1";
    const created = await fetch(
      `${url}/api/scans?title=Kursi%20Gagal&w=58&d=63&h=84`,
      {
        method: "POST",
        headers: { "content-type": "video/webm" },
        body: Buffer.from("fake-webm-body"),
      },
    );
    const { id } = await created.json();
    let dto = null;
    for (let i = 0; i < 200; i++) {
      dto = await (await fetch(`${url}/api/scans/${id}`)).json();
      if (dto.stage === "failed") break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    delete process.env.SCAN_FAKE_FAIL;
    assert.equal(dto.stage, "failed");
    await page.goto(`${url}/pindai/${id}`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() =>
      document
        .querySelector("[data-scan-error]")
        ?.textContent.includes("mengenali"),
    );
    assert.match(
      await page.locator("[data-scan-retry]").innerText(),
      /Rekam barang lain/,
    );
    await shot(page, "failed-390.png");
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${url}/pindai/${mainId}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelector("[data-scan-viewer]")?.dataset.state === "ready", { timeout: 30000 }); await page.waitForTimeout(700);
  await shot(page, "preview-1440.png");
  await context.close();

  assert.deepEqual(report.pageErrors, []);
  assert.deepEqual(report.consoleErrors, []);
} finally {
  await browser.close();
  await close();
}
const failed = report.checks.filter((entry) => !entry.pass);
console.log(`RESULT ${report.checks.length - failed.length}/${report.checks.length}`);
console.log(`REPORT ${path.join(output, "report.json")}`);
if (failed.length) process.exitCode = 1;

