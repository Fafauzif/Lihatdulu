import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { testBrowserPath } from "./test-browser.js";

// Mock-mode browser proof for the KIRI scan prototype. It runs the real server,
// the real ZIP/PLY/SPZ validation and the real splat-transform conversion; only
// the KIRI network calls are simulated. No credits, no external requests.

const root = fileURLToPath(new URL("../", import.meta.url));
const runDir = path.join(root, "var", "kiri-qa");
const jobsRoot = path.join(runDir, "jobs");
const clip = path.join(root, "public", "videos", "sora-walkthrough.mp4");
const distDir = path.join(root, "dist");

const report = {
  started: new Date().toISOString(),
  mode: "mock",
  checks: [],
  screenshots: [],
  pageErrors: [],
  consoleErrors: [],
  failedResponses: [],
  externalRequests: [],
  mediaCalls: [],
  serverLogs: [],
};

await fs.rm(runDir, { recursive: true, force: true });
await fs.mkdir(runDir, { recursive: true });
// A byte-different copy of the same clip, so the failure/retry phase is not
// deduplicated into the successful job from the first phase.
const variantClip = path.join(runDir, "sora-walkthrough-variant.mp4");
await fs.copyFile(clip, variantClip);
await fs.appendFile(variantClip, Buffer.from("\nLihatDulu mock failure variant\n"));
// A third distinct copy for the mesh phase. The jobs root survives the server
// restart, so re-uploading the same bytes would dedupe into the ready SPZ job
// instead of exercising the GLB path.
const meshClip = path.join(runDir, "sora-walkthrough-mesh.mp4");
await fs.copyFile(clip, meshClip);
await fs.appendFile(meshClip, Buffer.from("\nLihatDulu mock mesh variant\n"));
for (const file of ["index.html"]) {
  await fs.access(path.join(distDir, file)).catch(() => {
    throw new Error("dist is missing. Run npm run build before this check.");
  });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

const port = Number(process.env.KIRI_QA_PORT || 0) || (await freePort());
const base = `http://127.0.0.1:${port}`;

let serverProcess = null;
let serverLog = "";

function spawnServer({ fail = "", input = "video" } = {}) {
  const child = spawn(process.execPath, [path.join(root, "server", "kiri-server.mjs")], {
    cwd: root,
    env: {
      ...process.env,
      KIRI_MOCK: "1",
      KIRI_API_KEY: "",
      KIRI_JOBS_ROOT: jobsRoot,
      KIRI_PORT: String(port),
      KIRI_SERVE_DIST: "1",
      KIRI_DIST_DIR: distDir,
      KIRI_MOCK_LATENCY_MS: "1200",
      KIRI_POLL_MIN_MS: "250",
      KIRI_POLL_MAX_MS: "900",
      KIRI_MOCK_FAIL: fail,
      KIRI_INPUT: input,
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdout.on("data", (chunk) => {
    serverLog += chunk.toString("utf8");
  });
  child.stderr.on("data", (chunk) => {
    serverLog += chunk.toString("utf8");
  });
  return child;
}

async function waitForServer() {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${base}/api/kiri/config`);
      if (response.ok) return response.json();
    } catch {
      // server still starting
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`scan server did not start:\n${serverLog}`);
}

async function startServer(options) {
  serverProcess = spawnServer(options);
  const config = await waitForServer();
  report.serverLogs.push({ event: "start", fail: options?.fail ?? "", mode: config.mode });
  return config;
}

async function stopServer() {
  if (!serverProcess) return;
  const child = serverProcess;
  serverProcess = null;
  child.kill();
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 4000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function jobCount() {
  const entries = await fs.readdir(path.join(jobsRoot, "jobs")).catch(() => []);
  return entries.length;
}

const browser = await chromium.launch({
  executablePath: await testBrowserPath(),
  headless: true,
  args: [
    "--no-sandbox",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--disable-dev-shm-usage",
    // A fake rear camera so the release recorder can be exercised without a
    // phone. The recorder itself is real: getUserMedia, MediaRecorder, review.
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
  ],
});

await startServer();

async function newPage(options = {}) {
  // Most checks prove the page never reaches for the camera by itself; the
  // recorder check opts out and uses the fake device instead.
  const { blockCamera = true, ...contextOptions } = options;
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    ...contextOptions,
  });
  if (blockCamera)
    await context.addInitScript(() => {
      window.__kiriMediaCalls = 0;
      if (navigator.mediaDevices)
        for (const method of ["getUserMedia", "getDisplayMedia"])
          navigator.mediaDevices[method] = async () => {
            window.__kiriMediaCalls += 1;
            throw new Error("the page must not open a camera before the seller asks");
          };
    });
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  page.on("pageerror", (error) =>
    report.pageErrors.push({ url: page.url(), message: error.message }),
  );
  page.on("console", (message) => {
    if (message.type() === "error")
      report.consoleErrors.push({ url: page.url(), message: message.text() });
  });
  page.on("response", (response) => {
    if (response.status() < 400) return;
    // The unknown-id check deliberately asks for a job that does not exist.
    if (response.url().includes("/api/kiri/jobs/00000000-0000-4000-8000-000000000000")) return;
    report.failedResponses.push({ url: response.url(), status: response.status() });
  });
  page.on("request", (request) => {
    const url = request.url();
    if (!url.startsWith(base) && !/^(?:data|blob):/.test(url))
      report.externalRequests.push(url);
  });
  return { context, page };
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
  await fs.writeFile(path.join(runDir, "report.json"), JSON.stringify(report, null, 2));
}

async function open(page, route) {
  await page.goto(base + route, { waitUntil: "networkidle" });
  await page.locator("#main").waitFor();
}

async function shot(page, name, options = {}) {
  const file = path.join(runDir, `${name}.png`);
  await page.screenshot({ path: file, ...options });
  report.screenshots.push(file);
  return file;
}

async function pickClip(page, file = clip) {
  await page.locator("[data-scan-input]").setInputFiles(file);
  await page.locator("[data-scan-media]:not([hidden]) video").waitFor();
  await page
    .locator("[data-scan-facts]")
    .filter({ hasText: path.basename(file) })
    .waitFor();
}

async function submitClip(page) {
  await page.locator("[data-scan-consent]").check();
  await page.locator("[data-scan-submit]").click();
  await page.locator("[data-scan-job]:not([hidden])").waitFor();
}

async function waitForJobEnd(page, timeout = 90_000) {
  const deadline = Date.now() + timeout;
  const seen = new Set();
  while (Date.now() < deadline) {
    const state = await page.evaluate(() => {
      const active = document.querySelector("[data-scan-stage].is-active");
      const badge = document.querySelector("[data-scan-job-badge]");
      const error = document.querySelector("[data-scan-job-error]");
      return {
        stage: active?.textContent?.trim() ?? null,
        badge: badge?.textContent?.trim() ?? null,
        error: error && !error.hidden ? error.textContent.trim() : null,
      };
    });
    if (state.stage) seen.add(state.stage);
    if (state.badge === "Siap dilihat") return { ...state, seen: [...seen] };
    if (state.error) return { ...state, seen: [...seen] };
    await page.waitForTimeout(150);
  }
  throw new Error(`job did not settle; stages seen: ${[...seen].join(", ")}`);
}

async function waitForViewer(page) {
  await page.locator("[data-scan-viewer][data-state='ready']").waitFor({ timeout: 60_000 });
  await page.waitForTimeout(350);
}

async function orbitProof(page, name) {
  const viewer = page.locator("[data-scan-viewer]");
  const box = await viewer.boundingBox();
  assert.ok(box && box.width > 200 && box.height > 150, "viewer has a usable box");
  const before = await page.screenshot({ clip: box });
  await page.mouse.move(box.x + box.width * 0.32, box.y + box.height * 0.58);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.72, box.y + box.height * 0.42, { steps: 14 });
  await page.mouse.up();
  await page.waitForTimeout(600);
  const after = await page.screenshot({ clip: box });
  assert.ok(!before.equals(after), "dragging must rotate the splat");
  await fs.writeFile(path.join(runDir, `${name}-before.png`), before);
  await fs.writeFile(path.join(runDir, `${name}-after.png`), after);
  return { width: Math.round(box.width), height: Math.round(box.height) };
}

async function layoutFacts(page) {
  return page.evaluate(() => {
    const visible = (element) => {
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return box.width > 0 && box.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    const clipped = [...document.querySelectorAll("#main a,#main button,#main input")]
      .filter(visible)
      .map((element) => ({
        label: element.getAttribute("data-scan-submit") !== null ? "submit" : element.textContent.trim().slice(0, 40),
        box: element.getBoundingClientRect().toJSON(),
      }))
      .filter((item) => item.box.left < -1 || item.box.right > innerWidth + 1);
    const small = [...document.querySelectorAll("[data-scan-choose],[data-scan-submit],[data-scan-open]")]
      .filter(visible)
      .map((element) => ({
        label: element.textContent.trim().slice(0, 30) || "consent",
        height: Math.round(element.getBoundingClientRect().height),
      }))
      .filter((item) => item.height < 40);
    const consentLabel = document.querySelector("[data-scan-consent]")?.closest("label");
    const consentHeight = consentLabel ? Math.round(consentLabel.getBoundingClientRect().height) : 0;
    return {
      width: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      clipped,
      small,
      consentHeight,
      mediaCalls: window.__kiriMediaCalls ?? 0,
    };
  });
}

// 1. Upload page, copy and consent gate.
{
  const { context, page } = await newPage();
  await check("upload page explains KIRI and gates the send behind consent", async () => {
    await open(page, "/jual/pindai");
    await page.locator("[data-scan-upload]").waitFor();
    const heading = await page.locator("[data-scan-upload] h1").textContent();
    assert.match(heading, /Pindai furniturmu/);
    const mode = await page.locator("[data-scan-mode]").textContent();
    assert.match(mode, /Mode simulasi/);
    assert.match(mode, /tidak ada kredit/);
    assert.equal(await page.locator("[data-scan-submit]").isDisabled(), true);
    assert.equal(await page.locator("[data-scan-consent]").isChecked(), false);
    // The release entry point is the camera; an existing file is the fallback.
    assert.equal(await page.locator("[data-scan-open-camera]").isVisible(), true);
    assert.equal(await page.locator("[data-scan-choose]").isVisible(), true);
    assert.equal(
      await page
        .locator('[data-scan-upload] .scan-example-link a[href="/pindai/demo-chair"]')
        .isVisible(),
      true,
    );
    await shot(page, "01-upload-empty");
    return { heading: heading.trim(), mode: mode.trim() };
  });

  await check("a chosen MP4 is previewed before anything is sent", async () => {
    await pickClip(page);
    const facts = await page.locator("[data-scan-facts]").textContent();
    assert.match(facts, /sora-walkthrough\.mp4/);
    assert.match(facts, /\d+ dtk/);
    const video = page.locator("[data-scan-media] video");
    assert.ok((await video.getAttribute("src")).startsWith("blob:"));
    assert.equal(await page.locator("[data-scan-submit]").isDisabled(), true);
    await shot(page, "02-upload-preview");
    return { facts: facts.trim() };
  });

  await check("one confirm sends one job and reports queued/processing stages", async () => {
    await submitClip(page);
    const result = await waitForJobEnd(page);
    assert.equal(result.error, null);
    assert.ok(result.seen.length >= 2, `expected several stages, saw ${result.seen}`);
    assert.equal(await jobCount(), 1);
    await shot(page, "03-upload-ready");
    return { stages: result.seen, jobs: await jobCount() };
  });

  await check("the finished job opens the existing SPZ viewer", async () => {
    await page.locator("[data-scan-open]").click();
    await page.waitForURL(/\/pindai\/[0-9a-f-]{36}$/);
    await waitForViewer(page);
    const splats = await page.locator("[data-scan-viewer]").getAttribute("data-splats");
    assert.equal(Number(splats), 21600);
    const details = await page.locator("[data-scan-details]").textContent();
    assert.match(details, /Jumlah splat/);
    assert.match(details, /21\.600/);
    assert.match(details, /Mode simulasi/);
    await shot(page, "04-result-ready");
    return { splats: Number(splats), url: page.url() };
  });

  await check("dragging the result rotates the splat", async () => {
    const result = await orbitProof(page, "05-result-orbit");
    return result;
  });

  await check("a reload resumes the same job without a second upload", async () => {
    const before = await jobCount();
    await page.reload({ waitUntil: "networkidle" });
    await waitForViewer(page);
    assert.equal(await jobCount(), before);
    assert.match(page.url(), /\/pindai\/[0-9a-f-]{36}$/);
    return { jobs: before };
  });

  await check("the upload page restores the stored job after reload", async () => {
    await open(page, "/jual/pindai");
    await page.locator("[data-scan-job]:not([hidden])").waitFor();
    const badge = await page.locator("[data-scan-job-badge]").textContent();
    assert.equal(badge.trim(), "Siap dilihat");
    assert.equal(await page.locator("[data-scan-picker]").isVisible(), false);
    assert.equal(await page.locator("[data-scan-open]").isVisible(), true);
    return { badge: badge.trim() };
  });

  await check("opening the upload page never starts a camera by itself", async () => {
    const calls = await page.evaluate(() => window.__kiriMediaCalls ?? 0);
    assert.equal(calls, 0);
    return { mediaCalls: calls };
  });

  await context.close();
}

// 2. Failure, then retry after the server recovers.
{
  const baseJobs = await jobCount();
  await stopServer();
  await startServer({ fail: "submit" });
  const { context, page } = await newPage();
  await check("a failed submission is explained and offers an explicit resend", async () => {
    await open(page, "/jual/pindai");
    await pickClip(page, variantClip);
    await submitClip(page);
    const state = await waitForJobEnd(page);
    assert.ok(state.error, "failure copy is visible");
    assert.match(state.error, /tidak bisa dihubungi/);
    assert.equal(await page.locator("[data-scan-resend]").isVisible(), true);
    assert.equal(await jobCount(), baseJobs + 1);
    await shot(page, "06-upload-failed");
    return { error: state.error, jobs: baseJobs + 1 };
  });

  await check("resend after recovery finishes without duplicating the failed job", async () => {
    await stopServer();
    await startServer();
    await page.locator("[data-scan-resend]").click();
    const state = await waitForJobEnd(page);
    assert.equal(state.error, null);
    assert.equal(await jobCount(), baseJobs + 2);
    await shot(page, "07-upload-retried");
    return { stages: state.seen, jobs: baseJobs + 2 };
  });
  await context.close();
}

// 3. Mobile layout and touch orbit.
{
  const { context, page } = await newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  await check("the mobile upload page fits 390px and keeps tap targets usable", async () => {
    await open(page, "/jual/pindai");
    await pickClip(page);
    const facts = await layoutFacts(page);
    assert.ok(facts.scrollWidth <= facts.width + 1, `overflow ${facts.scrollWidth} > ${facts.width}`);
    assert.deepEqual(facts.clipped, []);
    assert.deepEqual(facts.small, []);
    assert.ok(facts.consentHeight >= 40, `consent label is ${facts.consentHeight}px tall`);
    await shot(page, "08-mobile-upload", { fullPage: true });
    return facts;
  });

  await check("the mobile flow reaches a ready, orbitable result", async () => {
    await submitClip(page);
    const state = await waitForJobEnd(page);
    assert.equal(state.error, null);
    await page.locator("[data-scan-open]").click();
    await waitForViewer(page);
    const facts = await layoutFacts(page);
    assert.ok(facts.scrollWidth <= facts.width + 1);
    await orbitProof(page, "09-mobile-orbit");
    await shot(page, "10-mobile-result");
    return { stages: state.seen, width: facts.width };
  });
  await context.close();
}

// 4. The rest of the site is untouched.
{
  const { context, page } = await newPage();
  await check("the marketplace, catalogue and authored 3D still render", async () => {
    await open(page, "/");
    const homeCards = await page.locator(".product-grid a").count();
    assert.ok(homeCards >= 4);
    await open(page, "/beli");
    const listings = await page.locator("[data-listing]").count();
    assert.ok(listings >= 10, `catalogue shows ${listings} listings`);
    await open(page, "/barang/sora?tab=model");
    await page.locator(".inspection").waitFor();
    assert.ok((await page.locator(".inspection").textContent()).length > 20);
    return { homeCards, listings };
  });

  await check("the prepared Sora walkthrough and its routes still work", async () => {
    await open(page, "/jual");
    // Two clearly separate seller routes: the prepared walkthrough and a scan.
    const paths = page.locator(".vj-paths");
    await paths.first().waitFor({ timeout: 20_000 });
    const sora = page.locator(".vj-path-sora");
    const scan = page.locator(".vj-path-scan");
    assert.match(await sora.textContent(), /Panduan video Sora/);
    assert.match(await sora.textContent(), /klip 18 detik/);
    assert.match(await scan.textContent(), /Pindai furnitur dari video/);
    assert.match(await scan.textContent(), /KIRI Engine/);
    assert.equal(await sora.locator('a[href="/jual/sora/rekam"]').isVisible(), true);
    assert.equal(await scan.locator('a[href="/jual/pindai"]').isVisible(), true);
    assert.equal(await page.locator('a[href="/jual/sora/rekam"]').count() > 0, true);
    await open(page, "/jual/sora/rekam");
    await page.locator(".video-journey").waitFor();
    assert.ok((await page.locator("[data-video-player]").count()) >= 1);
    assert.ok((await page.locator("video").count()) >= 1);
    await shot(page, "11-sora-route");
    return { scanEntry: true, sora: true };
  });

  await check("an unknown scan id shows the not-found state", async () => {
    await open(page, "/pindai/00000000-0000-4000-8000-000000000000");
    const text = await page.locator("[data-scan-title]").textContent();
    assert.match(text, /tidak ditemukan/i);
    return { title: text.trim() };
  });

  await check("no page errors, failed app responses or external requests", async () => {
    assert.deepEqual(report.pageErrors, []);
    assert.deepEqual(report.failedResponses, []);
    assert.deepEqual(report.externalRequests, []);
    return {
      pageErrors: report.pageErrors.length,
      failedResponses: report.failedResponses.length,
      externalRequests: report.externalRequests.length,
      consoleErrors: report.consoleErrors.length,
    };
  });
  await context.close();
}

// 5. The mesh profile: stills to the featureless endpoint, a GLB in the viewer.
{
  await stopServer();
  await startServer({ input: "mesh" });
  const { context, page } = await newPage();
  await check("mesh profile builds a GLB and serves it to the viewer", async () => {
    await open(page, "/jual/pindai");
    await pickClip(page, meshClip);
    await submitClip(page);
    const state = await waitForJobEnd(page);
    assert.equal(state.error, null);
    await page.locator("[data-scan-open]").click();
    await page.waitForURL(/\/pindai\/[0-9a-f-]{36}$/);
    await page.locator("[data-scan-viewer][data-state='ready']").waitFor({ timeout: 60_000 });
    const triangles = await page.locator("[data-scan-viewer]").getAttribute("data-triangles");
    assert.equal(Number(triangles), 72);
    const details = await page.locator("[data-scan-details]").textContent();
    assert.match(details, /Jumlah segitiga/);
    assert.match(details, /72/);
    assert.match(details, /Ukuran GLB/);
    // Mock results say they are simulated rather than naming the profile, which
    // is the honest copy; the live wording is pinned by a unit test instead.
    assert.match(details, /Mode simulasi/);
    const source = await page.locator("[data-scan-provider]").textContent();
    assert.ok(source.length > 0);
    await shot(page, "12-mesh-result");
    return { triangles: Number(triangles), stages: state.seen };
  });

  await check("the mesh result can be orbited", async () => {
    const result = await orbitProof(page, "13-mesh-orbit");
    return result;
  });

  await check("the mesh result survives a reload without a new submission", async () => {
    const before = await jobCount();
    await page.reload({ waitUntil: "networkidle" });
    await page.locator("[data-scan-viewer][data-state='ready']").waitFor({ timeout: 60_000 });
    assert.equal(await jobCount(), before);
    return { jobs: before };
  });

  await check("the mesh flow raised no page errors or failed responses", async () => {
    assert.deepEqual(report.pageErrors, []);
    assert.deepEqual(report.failedResponses, []);
    return { pageErrors: 0, failedResponses: 0 };
  });
  await context.close();
}

// 6. The Photo Scan profile: KIRI's object route. It answers with a mesh too,
// so the viewer must take the GLB branch and the job must never claim splats.
{
  await stopServer();
  await startServer({ input: "photo" });
  const { context, page } = await newPage();
  await check("photo profile builds a GLB and serves it to the viewer", async () => {
    await open(page, "/jual/pindai");
    await pickClip(page, meshClip);
    await submitClip(page);
    const state = await waitForJobEnd(page);
    assert.equal(state.error, null);
    await page.locator("[data-scan-open]").click();
    await page.waitForURL(/\/pindai\/[0-9a-f-]{36}$/);
    const viewer = page.locator("[data-scan-viewer]");
    await viewer.waitFor({ state: "visible" });
    await page.locator("[data-scan-viewer][data-state='ready']").waitFor({ timeout: 60_000 });
    const triangles = await viewer.getAttribute("data-triangles");
    assert.equal(Number(triangles), 72);
    // A photo job is a mesh job: the splat counter must stay unset.
    assert.equal(await viewer.getAttribute("data-splats"), null);
    const details = await page.locator("[data-scan-details]").textContent();
    assert.match(details, /Jumlah segitiga/);
    assert.match(details, /Ukuran GLB/);
    assert.doesNotMatch(details, /Jumlah splat/);
    await shot(page, "14-photo-result");
    return { triangles: Number(triangles), stages: state.seen };
  });

  await check("the photo result can be orbited", async () => {
    return orbitProof(page, "15-photo-orbit");
  });

  await check("the photo result survives a reload without a new submission", async () => {
    const before = await jobCount();
    await page.reload({ waitUntil: "networkidle" });
    await page.locator("[data-scan-viewer][data-state='ready']").waitFor({ timeout: 60_000 });
    assert.equal(await jobCount(), before);
    return { jobs: before };
  });

  await check("the photo flow raised no page errors or failed responses", async () => {
    assert.deepEqual(report.pageErrors, []);
    assert.deepEqual(report.failedResponses, []);
    return { pageErrors: 0, failedResponses: 0 };
  });
  await context.close();
}

// 7. The refined preview: which sources the buyer may open, the stills that
// shaped the mesh, the retry that never spends a credit, and the narrow layout.
{
  await stopServer();
  await startServer({ input: "photo" });
  const { context, page } = await newPage();
  let jobId = null;

  await check("a refined job offers refined, raw and photo tabs", async () => {
    await open(page, "/jual/pindai");
    await pickClip(page, meshClip);
    await submitClip(page);
    await waitForJobEnd(page);
    await page.locator("[data-scan-open]").click();
    await page.waitForURL(/\/pindai\/[0-9a-f-]{36}$/);
    jobId = page.url().split("/").pop();
    await page.locator("[data-scan-viewer][data-state='ready']").waitFor({ timeout: 60_000 });
    const labels = await page.locator("[data-scan-source]").allTextContents();
    assert.equal(labels.length, 3, `expected three sources, saw ${labels.join(" | ")}`);
    assert.equal(
      await page.locator("[data-scan-source='refined']").getAttribute("aria-selected"),
      "true",
    );
    const summary = page.locator("[data-scan-summary]");
    await summary.waitFor({ state: "visible" });
    const summaryText = await summary.textContent();
    assert.match(summaryText, /KIRI Engine|Mode simulasi/);
    assert.match(summaryText, /foto/);
    const details = await page.locator("[data-scan-details]").textContent();
    assert.match(details, /Penyempurnaan/);
    const caveat = await page.locator("[data-scan-caveat]").textContent();
    assert.match(caveat, /Pratinjau 3D perkiraan/);
    await shot(page, "16-refined-sources");
    return { labels, summary: summaryText.trim(), caveat };
  });

  await check("the raw tab keeps KIRI's untouched file", async () => {
    const seen = [];
    page.on("response", (response) => {
      if (/\/raw\.glb$/.test(response.url())) seen.push(response.status());
    });
    await page.locator("[data-scan-source='raw']").click();
    await page.locator("[data-scan-viewer][data-state='ready']").waitFor({ timeout: 60_000 });
    await page.waitForFunction(
      () => document.querySelector("[data-scan-source='raw']").getAttribute("aria-selected") === "true",
      null,
      { timeout: 10_000 },
    );
    await shot(page, "17-refined-raw-tab");
    assert.ok(seen.includes(200), `raw.glb responses: ${seen.join(",")}`);
    return { rawResponses: seen };
  });

  await check("the photo tab shows the stills and hides the viewer", async () => {
    await page.locator("[data-scan-source='photos']").click();
    const panel = page.locator("[data-scan-photos]");
    await panel.waitFor({ state: "visible" });
    assert.equal(await page.locator("[data-scan-viewer]").isVisible(), false);
    const hero = page.locator("[data-scan-photo-hero]");
    await hero.waitFor({ state: "visible" });
    await page.waitForFunction(
      () => {
        const image = document.querySelector("[data-scan-photo-hero]");
        return image && image.complete && image.naturalWidth > 0;
      },
      null,
      { timeout: 15_000 },
    );
    const images = page.locator("[data-scan-photo-grid] img");
    const count = await images.count();
    assert.ok(count >= 1, "at least one still is offered");
    // The grid is lazy: bring it into view, then require every still to decode.
    await page.locator("[data-scan-photo-grid]").scrollIntoViewIfNeeded();
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll("[data-scan-photo-grid] img")].every(
          (image) => image.complete && image.naturalWidth > 0,
        ),
      null,
      { timeout: 20_000 },
    );
    const shown = await page.evaluate(() => {
      const tabs = document.querySelector("[data-scan-tabs]");
      const photos = document.querySelector("[data-scan-photos]");
      return Boolean(
        tabs &&
          photos &&
          tabs.compareDocumentPosition(photos) & Node.DOCUMENT_POSITION_FOLLOWING,
      );
    });
    assert.ok(shown, "the photos sit after the tabs, before anything else");
    await shot(page, "18-refined-photos-tab");
    return { stills: count };
  });

  await check("an explicit source choice survives a reload", async () => {
    const before = await jobCount();
    assert.equal(
      await page.locator("[data-scan-source='photos']").getAttribute("aria-selected"),
      "true",
    );
    await page.reload({ waitUntil: "networkidle" });
    await page.locator("[data-scan-source]").first().waitFor({ timeout: 30_000 });
    await page.waitForFunction(
      () =>
        document.querySelector("[data-scan-source='photos']")?.getAttribute("aria-selected") ===
        "true",
      null,
      { timeout: 15_000 },
    );
    assert.equal(await jobCount(), before);
    assert.equal(await page.locator("[data-scan-source]").count(), 3);
    return { source: "photos", jobs: before };
  });

  await check("keyboard focus stays on the tablist while the source changes", async () => {
    await page.locator("[data-scan-source='photos']").focus();
    await page.keyboard.press("ArrowRight");
    const focus = await page.evaluate(() => {
      const active = document.activeElement;
      return {
        role: active?.getAttribute("role"),
        source: active?.dataset?.scanSource,
        inside: Boolean(active?.closest("[data-scan-tabs]")),
        selected: active?.getAttribute("aria-selected"),
      };
    });
    assert.equal(focus.role, "tab");
    assert.ok(focus.inside, "focus stays inside the tablist");
    assert.notEqual(focus.source, "photos");
    assert.equal(focus.selected, "true");
    await shot(page, "18b-tab-focus");
    return focus;
  });

  await check("a failed refinement falls back to the raw scan and can be retried", async () => {
    // The service keeps every record under <jobs root>/jobs/<id>/job.json.
    const jobFile = path.join(jobsRoot, "jobs", jobId, "job.json");
    const record = JSON.parse(await fs.readFile(jobFile, "utf8"));
    const backup = JSON.stringify(record);
    record.refine = { status: "failed", reason: "model_invalid", ms: 12 };
    record.refined = null;
    await fs.writeFile(jobFile, JSON.stringify(record, null, 2));
    try {
      // A saved source choice from the previous check would outrank the
      // fallback; this check is about the fallback itself.
      await page.evaluate(() => {
        for (const key of Object.keys(localStorage))
          if (key.startsWith("lihatdulu:scan:source:")) localStorage.removeItem(key);
      });
      await page.reload({ waitUntil: "networkidle" });
      const note = page.locator("[data-scan-refine-note]");
      await note.waitFor({ state: "visible", timeout: 30_000 });
      const text = await note.textContent();
      assert.match(text, /gagal/);
      const labels = await page.locator("[data-scan-source]").allTextContents();
      assert.equal(labels.length, 2, `a failed refine leaves raw and photos: ${labels.join(" | ")}`);
      assert.equal(
        await page.locator("[data-scan-source='raw']").getAttribute("aria-selected"),
        "true",
      );
      const button = page.locator("[data-scan-refine]");
      await button.waitFor({ state: "visible" });
      const before = await jobCount();
      await button.click();
      // Applying the refine folds the metrics into the technical rows and drops
      // the retry button; the separate applied paragraph is gone by design.
      await page.locator("[data-scan-refine]").waitFor({ state: "hidden", timeout: 60_000 });
      await page.waitForFunction(
        () =>
          /Penyempurnaan/.test(document.querySelector("[data-scan-details]")?.textContent ?? "") &&
          document.querySelector("[data-scan-summary]")?.hidden === false,
        null,
        { timeout: 30_000 },
      );
      assert.equal(await jobCount(), before, "a retry must not create a job");
      assert.equal(await page.locator("[data-scan-source]").count(), 3);
      await shot(page, "19-refine-retry");
      return { failedNote: text, sources: labels.length };
    } finally {
      await fs.writeFile(jobFile, backup);
    }
  });

  await check("the refined result reads well at 390x844", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload({ waitUntil: "networkidle" });
    await page.locator("[data-scan-viewer][data-state='ready']").waitFor({ timeout: 60_000 });
    const facts = await layoutFacts(page);
    assert.equal(facts.clipped.length, 0, `clipped: ${JSON.stringify(facts.clipped)}`);
    assert.ok(facts.scrollWidth <= facts.width + 1, "no horizontal scroll");
    const tabsFit = await page.evaluate(() =>
      [...document.querySelectorAll("[data-scan-source]")].every((element) => {
        const box = element.getBoundingClientRect();
        return box.left >= -1 && box.right <= innerWidth + 1 && box.height >= 32;
      }),
    );
    assert.ok(tabsFit, "every source tab fits and stays tappable");
    await shot(page, "20-refined-mobile");
    return { width: facts.width, scrollWidth: facts.scrollWidth };
  });

  await check("the refined flow raised no page errors or failed responses", async () => {
    assert.deepEqual(report.pageErrors, []);
    assert.deepEqual(report.failedResponses, []);
    return { pageErrors: 0, failedResponses: 0 };
  });
  await context.close();
}

// 4. The release recorder, driven through a fake rear camera. getUserMedia and
// MediaRecorder are real; only the sensor is synthetic. Nothing is submitted,
// so the job counts above stay untouched.
{
  const { context, page } = await newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    blockCamera: false,
  });
  await context.grantPermissions(["camera"], { origin: base });

  await check("the camera records a clip that reaches the consent step", async () => {
    await open(page, "/jual/pindai");
    await page.locator("[data-scan-open-camera]").click();
    await page.locator("[data-rec-start]").waitFor({ timeout: 20_000 });
    const live = (await page.locator("[data-rec-status]").innerText()).trim();
    await page.locator("[data-rec-start]").click();
    await page.waitForTimeout(9200);
    await page.locator("[data-rec-stop]").click();
    await page.locator("[data-rec-use]").waitFor({ timeout: 20_000 });
    const review = (await page.locator("[data-rec-status]").innerText()).trim();
    await page.locator("[data-rec-use]").click();
    await page.locator("[data-scan-media]:not([hidden]) video").waitFor();
    // The clip is probed after it appears; read the facts only once the length
    // has been recovered, so a slow probe is not mistaken for a missing one.
    await page
      .waitForFunction(
        () => /\d+ dtk/.test(document.querySelector("[data-scan-facts]")?.textContent ?? ""),
        null,
        { timeout: 20_000 },
      )
      .catch(() => {});
    const facts = (await page.locator("[data-scan-facts]").innerText()).trim();
    assert.match(facts, /\.(?:webm|mp4)/i, `recording name: ${facts}`);
    // Android's streamed WebM reports no duration until the clip is seeked;
    // the page recovers it, so a real length must still be shown.
    assert.match(facts, /\d+ dtk/, `recorded length: ${facts}`);
    assert.equal(await page.locator("[data-scan-submit]").isDisabled(), true);
    await page.locator("[data-scan-consent]").check();
    assert.equal(await page.locator("[data-scan-submit]").isEnabled(), true);
    const released = await page.evaluate(
      () => document.querySelector("[data-rec-video]")?.srcObject === null,
    );
    assert.equal(released, true, "camera tracks must be released on use");
    await shot(page, "21-camera-recorded");
    return { live, review, facts };
  });

  await check("the camera flow raised no page errors or failed responses", async () => {
    assert.deepEqual(report.pageErrors, []);
    assert.deepEqual(report.failedResponses, []);
    return { pageErrors: 0, failedResponses: 0 };
  });

  await context.close();
}

// 5. The saved real chair. Its job record is a static JSON file, so this page
// works without the scan API. A fresh visit opens the photos, an explicit tab
// choice survives a reload, and a GLB never downloads the Spark runtime.
{
  const { context, page } = await newPage({ viewport: { width: 390, height: 844 } });
  const requested = [];
  page.on("request", (request) => requested.push(request.url()));

  await check("the saved chair opens on photos with the original photo under the tabs", async () => {
    await open(page, "/pindai/demo-chair");
    await page.locator("[data-scan-source]").first().waitFor({ timeout: 30_000 });
    await page.waitForFunction(
      () => {
        const image = document.querySelector("[data-scan-photo-hero]");
        return image && image.complete && image.naturalWidth > 0;
      },
      null,
      { timeout: 20_000 },
    );
    const state = await page.evaluate(() => {
      const tabs = document.querySelector("[data-scan-tabs]");
      const hero = document.querySelector("[data-scan-photo-hero]");
      return {
        selected: document
          .querySelector("[data-scan-source][aria-selected='true']")
          ?.getAttribute("data-scan-source"),
        afterTabs: Boolean(
          tabs &&
            hero &&
            tabs.compareDocumentPosition(hero) & Node.DOCUMENT_POSITION_FOLLOWING,
        ),
        tabs: document.querySelectorAll("[role='tab']").length,
        viewerHidden: document.querySelector("[data-scan-viewer]")?.hidden ?? false,
        summary: document.querySelector("[data-scan-summary]")?.textContent ?? "",
      };
    });
    assert.equal(state.selected, "photos");
    assert.ok(state.afterTabs, "the hero photo comes directly after the tabs");
    assert.equal(state.tabs, 3);
    assert.equal(state.viewerHidden, true);
    assert.match(state.summary, /KIRI Engine Photo Scan Ultra/);
    assert.match(state.summary, /18,8%/);
    assert.match(state.summary, /berasal dari penjual/);
    await shot(page, "22-demo-chair-photos");
    return state;
  });

  await check("the saved chair keeps an explicit model choice after a reload", async () => {
    await page.locator("[data-scan-source='refined']").click();
    await page.locator("[data-scan-viewer][data-state='ready']").waitFor({ timeout: 60_000 });
    await page.reload({ waitUntil: "networkidle" });
    await page.locator("[data-scan-source]").first().waitFor({ timeout: 30_000 });
    await page.waitForFunction(
      () =>
        document
          .querySelector("[data-scan-source='refined']")
          ?.getAttribute("aria-selected") === "true",
      null,
      { timeout: 15_000 },
    );
    await page.locator("[data-scan-viewer][data-state='ready']").waitFor({ timeout: 60_000 });
    const splat = requested.filter((url) => /scan-splat/.test(url));
    assert.deepEqual(splat, [], "a GLB must not download the splat runtime");
    await shot(page, "23-demo-chair-refined-reload");
    return { splatRequests: splat.length };
  });

  await check("keyboard can move between sources without losing focus", async () => {
    await page.locator("[data-scan-source='refined']").focus();
    await page.keyboard.press("ArrowRight");
    const focus = await page.evaluate(() => {
      const active = document.activeElement;
      return {
        role: active?.getAttribute("role"),
        source: active?.getAttribute("data-scan-source"),
        inside: Boolean(active?.closest("[data-scan-tabs]")),
        selected: active?.getAttribute("aria-selected"),
      };
    });
    assert.equal(focus.role, "tab");
    assert.ok(focus.inside, "focus stays on the tablist");
    assert.equal(focus.selected, "true");
    await shot(page, "24-demo-chair-focus");
    return focus;
  });

  await check("the saved-chair page raised no page errors", async () => {
    const demoErrors = report.pageErrors.filter((entry) =>
      /\/pindai\/demo-chair/.test(entry.url),
    );
    assert.deepEqual(demoErrors, []);
    return { demoErrors: 0 };
  });

  await context.close();
}

// 5b. A slow link. The saved chair's model is a large GLB; while it downloads
// the page must stay usable, keep the limits visible and let the seller return
// to the photo evidence with one tap.
{
  const { context, page } = await newPage({ viewport: { width: 390, height: 844 } });
  const glb = [];
  await page.route("**/demo/kursi/**/*.glb", async (route) => {
    glb.push(route.request().url().replace(base, ""));
    await new Promise((resolve) => setTimeout(resolve, 3500));
    await route.continue().catch(() => {});
  });

  await check("a slow chair model keeps the evidence usable and still opens", async () => {
    await page.goto(base + "/pindai/demo-chair", { waitUntil: "domcontentloaded" });
    await page.locator("[data-scan-source][aria-selected='true']").waitFor({ timeout: 20_000 });
    const first = await page.evaluate(() => ({
      selected: document
        .querySelector("[data-scan-source][aria-selected='true']")
        ?.getAttribute("data-scan-source"),
      photosVisible: !(document.querySelector("[data-scan-photos]")?.hidden ?? true),
    }));
    assert.equal(first.selected, "photos");
    assert.equal(first.photosVisible, true);
    assert.deepEqual(glb, [], "the model is downloaded only when it is opened");

    await page.locator("[data-scan-source='refined']").click();
    const during = await page.evaluate(() => {
      const tabs = document.querySelector("[data-scan-tabs]");
      return {
        state: document.querySelector("[data-scan-viewer]")?.dataset.state ?? null,
        tabsVisible: Boolean(tabs && tabs.getBoundingClientRect().height > 0),
        summary: (document.querySelector("[data-scan-summary]")?.textContent ?? "").trim(),
      };
    });
    assert.equal(during.tabsVisible, true, "the source tabs stay on screen while loading");
    assert.ok(
      ["idle", "loading"].includes(during.state),
      "viewer state while the model is slow: " + during.state,
    );
    assert.match(during.summary, /18,8%/, "the limit stays readable while the model loads");
    await shot(page, "25-demo-chair-slow-model");

    // The photo evidence remains one tap away during the wait.
    assert.equal(await page.locator("[data-scan-source='photos']").isEnabled(), true);
    await page.locator("[data-scan-source='photos']").click();
    await page.waitForFunction(
      () => !(document.querySelector("[data-scan-photos]")?.hidden ?? true),
      null,
      { timeout: 10_000 },
    );

    await page.locator("[data-scan-source='refined']").click();
    await page
      .locator("[data-scan-viewer][data-state='ready']")
      .waitFor({ timeout: 60_000 });
    assert.ok(glb.length > 0, "the slow model was requested");
    assert.deepEqual(
      report.pageErrors.filter((entry) => /\/pindai\/demo-chair/.test(entry.url)),
      [],
    );
    return { during, glb: glb.length };
  });

  await context.close();
}

// 5c. A seller who leaves mid-upload. The request is aborted with the page, no
// job is created server-side, and nothing is left restored or polling.
{
  const { context, page } = await newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  let held = 0;
  await page.route("**/api/kiri/jobs", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    held += 1;
    await new Promise((resolve) => setTimeout(resolve, 4000));
    await route.continue().catch(() => {});
  });

  await check("leaving the page mid-upload cancels the send without a stuck job", async () => {
    const before = await jobCount();
    await open(page, "/jual/pindai");
    await pickClip(page);
    await page.locator("[data-scan-consent]").check();
    await page.locator("[data-scan-submit]").click();
    await page.waitForFunction(
      () => {
        const job = document.querySelector("[data-scan-job]");
        return job && !job.hidden;
      },
      null,
      { timeout: 20_000 },
    );
    // Walk away while the browser is still holding the request.
    await page.goto(base + "/pindai/demo-chair", { waitUntil: "domcontentloaded" });
    await page.locator("[data-scan-tabs]").waitFor({ timeout: 20_000 });
    await page.waitForTimeout(1500);
    await open(page, "/jual/pindai");
    const restored = await page.evaluate(() => ({
      job: Boolean(document.querySelector("[data-scan-job]:not([hidden])")),
      chooseDisabled: document.querySelector("[data-scan-input]")?.disabled ?? false,
    }));
    assert.equal(restored.job, false, "no job is restored after the cancelled upload");
    assert.equal(restored.chooseDisabled, false);
    assert.deepEqual(
      report.pageErrors.filter((entry) => /\/jual\/pindai/.test(entry.url)),
      [],
    );
    await shot(page, "26-upload-cancelled");
    const after = await jobCount();
    assert.equal(after, before, "the cancelled upload creates no job");
    return { before, after, held };
  });

  await context.close();
}

// 6. A static host has no scan API: say so once and lead with the saved chair.
{
  const { context, page } = await newPage({ viewport: { width: 390, height: 844 } });
  await page.route("**/api/kiri/config", (route) => route.abort());

  await check("without an API the upload page says so and links the saved chair", async () => {
    await open(page, "/jual/pindai");
    const panel = page.locator("[data-scan-static]");
    await panel.waitFor({ state: "visible", timeout: 20_000 });
    const text = await panel.textContent();
    assert.match(text, /Demo statis/);
    assert.match(text, /belum aktif/);
    assert.equal(await page.locator("[data-scan-submit]").isDisabled(), true);
    assert.equal(await page.locator("[data-scan-open-camera]").isDisabled(), true);
    assert.equal(
      await page.locator("[data-scan-static] a[href='/pindai/demo-chair']").isVisible(),
      true,
    );
    await shot(page, "27-static-upload");
    return { text: text.trim() };
  });

  // A stale result link on a static host gets the SPA shell instead of JSON.
  // That must read as "no scanner here", once, with the saved chair offered —
  // not as five polling attempts behind a spinner.
  await check("an unknown job link on a static host says so and links the chair", async () => {
    await page.route("**/api/kiri/jobs/*", (route) =>
      // Verbatim from the deployment: Vercel answers an unknown /api path with
      // JSON whose code is the status number. That means "no scanner here".
      route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({
          error: { code: "404", message: "The page could not be found" },
        }),
      }),
    );
    const started = Date.now();
    await page.goto(base + "/pindai/8f1c3b9e-0000-4000-8000-00000000dead", {
      waitUntil: "domcontentloaded",
    });
    const card = page.locator("[data-scan-error]");
    await card.waitFor({ state: "visible", timeout: 15_000 });
    const ms = Date.now() - started;
    const text = (await card.innerText()).trim();
    assert.match(text, /tanpa server pindai|contoh tersimpan/i);
    assert.equal(
      await card.locator("a[href='/pindai/demo-chair']").isVisible(),
      true,
      "the saved chair is offered from the error card",
    );
    assert.ok(ms < 10_000, `the static state arrived after ${ms} ms`);
    await shot(page, "28-static-unknown-job");
    return { ms, text: text.slice(0, 160) };
  });

  await context.close();
}

await stopServer();
report.finished = new Date().toISOString();
report.serverLogTail = serverLog.slice(-4000);
await fs.writeFile(path.join(runDir, "report.json"), JSON.stringify(report, null, 2));

const failed = report.checks.filter((entry) => !entry.pass);
console.log(
  `\n${report.checks.length - failed.length}/${report.checks.length} checks passed · screenshots in ${path.relative(root, runDir)}`,
);
if (failed.length) {
  for (const entry of failed) console.error("FAILED:", entry.name);
  process.exitCode = 1;
}
