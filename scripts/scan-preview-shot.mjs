import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";
import { testBrowserPath } from "./test-browser.js";
import { createScanServer } from "../server/scan-server.mjs";
import { isJobId, readJob } from "../server/scan-jobs.mjs";

// Preview screenshot harness for one ready scan job.
//
// Usage:
//   node scripts/scan-preview-shot.mjs --job <uuid> [--root var/scans] [--out var/spike/preview-<slug>]
//
// Starts a serving-only scan server (pipeline paused, no new job is created),
// opens /pindai/<job> in headless Chromium with SwiftShader, waits for
// [data-scan-viewer][data-state="ready"], checks data-splats, screenshots the
// viewer element (must exceed 15000 bytes) and saves the viewer canvas plus
// 1440x900 + 390x844 viewport PNGs and report.json with { job, state, splats,
// viewerBytes, screenshots, viewerScreenshots }. Run it from the repository
// root so dist/ and var/scans resolve. Exits 1 for a missing/not-ready job, a
// viewer that never reaches ready, data-splats = 0, or a viewer screenshot
// <= 15000 bytes.
//
// The PNGs are evidence on disk only: never open or attach them in chat.

const VIEWER_SELECTOR = "[data-scan-viewer]";
const READY_SELECTOR = `${VIEWER_SELECTOR}[data-state="ready"]`;
const READY_TIMEOUT_MS = 60_000;
const MIN_VIEWER_BYTES = 15_000;
const WIDE_VIEWPORT = { width: 1440, height: 900 };
const NARROW_VIEWPORT = { width: 390, height: 844 };
const CHROMIUM_ARGS = [
  "--use-gl=angle",
  "--use-angle=swiftshader",
  "--enable-unsafe-swiftshader",
];

const USAGE = `Usage:
  node scripts/scan-preview-shot.mjs --job <uuid> [--root var/scans] [--out var/spike/preview-<slug>]

Options:
  --job <uuid>   Ready scan job id (job.json under <root>/<uuid>). Required.
  --root <dir>   Scan job root. Default: var/scans
  --out <dir>    Output folder. Default: var/spike/preview-<title-slug>
  --help, -h     Show this message.

Requires a current built dist/ (npm run build) and an already-ready job. Writes
1440.png, 390.png and report.json (job, state, splats, viewerBytes,
screenshots) into --out. Exits 0 on success, 1 on any failure.`;

function log(message) {
  console.log(`[scan-preview-shot] ${message}`);
}

function fail(message) {
  console.error(`[scan-preview-shot] ${message}`);
}

function parseArgs(argv) {
  const options = { job: null, root: "var/scans", out: null, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }
    const match = /^--(job|root|out)(?:=(.*))?$/.exec(argument);
    if (!match)
      throw new Error(
        `Argumen tidak dikenal / unknown argument: ${argument}`,
      );
    let value = match[2];
    if (value === undefined) {
      index += 1;
      value = argv[index];
    }
    if (value === undefined || value === "" || value.startsWith("--"))
      throw new Error(
        `--${match[1]} membutuhkan nilai / --${match[1]} requires a value`,
      );
    options[match[1]] = value;
  }
  if (!options.help && !options.job)
    throw new Error("--job wajib diisi / --job is required");
  return options;
}

function slugify(value) {
  const slug = String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return slug || "job";
}

async function readViewerFacts(page) {
  return page.$eval(VIEWER_SELECTOR, (host) => ({
    state: host.getAttribute("data-state") ?? "missing",
    splats: Number.parseInt(host.getAttribute("data-splats") ?? "", 10),
  }));
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
    console.error(USAGE);
    return 1;
  }
  if (options.help) {
    console.log(USAGE);
    return 0;
  }

  const { job } = options;
  if (!isJobId(job)) {
    fail(`ID pekerjaan tidak valid: ${job}. / Invalid job id.`);
    return 1;
  }
  const root = path.resolve(options.root);
  const record = await readJob(root, job);
  if (!record) {
    fail(
      `Job ${job} tidak ditemukan: tidak ada job.json yang valid di ` +
        `${path.join(root, job)}. / Job not found (no job.json).`,
    );
    return 1;
  }
  if (record.stage !== "ready") {
    fail(
      `Job ${job} berstatus "${record.stage}", bukan "ready"; pratinjau belum ` +
        `tersedia. / Job is not ready.`,
    );
    return 1;
  }

  const distIndex = path.resolve("dist", "index.html");
  if (!existsSync(distIndex)) {
    fail(
      `dist/index.html belum ada. Jalankan "npm run build" dulu. / ` +
        `No built dist; run "npm run build" first.`,
    );
    return 1;
  }

  const outDir = path.resolve(
    options.out ?? path.join("var/spike", `preview-${slugify(record.meta?.title)}`),
  );
  await fs.mkdir(outDir, { recursive: true });

  let server = null;
  let browser = null;
  try {
    server = await createScanServer({
      root,
      pipeline: async () => new Promise(() => {}),
      distDir: "dist",
    });
    const baseUrl = server.url;
    log(`serving ${root} at ${baseUrl} (pipeline paused, no new job)`);

    browser = await chromium.launch({
      executablePath: await testBrowserPath(),
      headless: true,
      args: CHROMIUM_ARGS,
    });
    const context = await browser.newContext({ viewport: WIDE_VIEWPORT });
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    log(`opening ${baseUrl}/pindai/${job}`);
    await page.goto(`${baseUrl}/pindai/${job}`, {
      waitUntil: "domcontentloaded",
    });

    try {
      await page.waitForSelector(READY_SELECTOR, {
        timeout: READY_TIMEOUT_MS,
      });
    } catch {
      const observed = await page
        .evaluate(() => {
          const host = document.querySelector("[data-scan-viewer]");
          return {
            state: host?.getAttribute("data-state") ?? "missing",
            message:
              host?.querySelector("[data-scan-viewer-placeholder]")
                ?.textContent ?? "",
          };
        })
        .catch(() => ({ state: "unknown", message: "" }));
      throw new Error(
        `Pratinjau 3D tidak mencapai state "ready" dalam ` +
          `${READY_TIMEOUT_MS / 1000} detik (state terakhir: ` +
          `"${observed.state}"${observed.message ? `, pesan: "${observed.message}"` : ""}). ` +
          `Pastikan dist/ adalah build terbaru (npm run build). / ` +
          `viewer never reached ready.` +
          (pageErrors.length
            ? ` Page errors: ${pageErrors.slice(0, 3).join(" | ")}`
            : ""),
      );
    }

    // Let the splat render loop paint at least one frame after ready.
    await page.waitForTimeout(1000);
    const facts = await readViewerFacts(page);
    const splats = Number.isInteger(facts.splats) ? facts.splats : 0;
    if (facts.state !== "ready") {
      throw new Error(
        `Viewer berubah dari "ready" ke "${facts.state}" sebelum diambil. / ` +
          `viewer left ready before capture.`,
      );
    }
    if (splats <= 0) {
      throw new Error(
        `Viewer mencapai ready tetapi data-splats = ${facts.splats}; tidak ada ` +
          `splat yang dimuat. / splat count is 0.`,
      );
    }

    // The viewer element screenshot is the byte assertion; the canvas lives
    // inside it and is composited by Chromium. Keep the PNG as evidence for
    // the programmatic visual verdict (never opened in chat).
    const viewerShot = await page.locator(VIEWER_SELECTOR).screenshot();
    const viewerBytes = viewerShot.length;
    const wideViewer = path.join(outDir, "viewer-1440.png");
    await fs.writeFile(wideViewer, viewerShot);
    const wideShot = path.join(outDir, "1440.png");
    await page.screenshot({ path: wideShot, fullPage: false });

    await page.setViewportSize(NARROW_VIEWPORT);
    await page.waitForSelector(READY_SELECTOR, { timeout: READY_TIMEOUT_MS });
    await page.waitForTimeout(800);
    const narrowViewerShot = await page.locator(VIEWER_SELECTOR).screenshot();
    const narrowViewer = path.join(outDir, "viewer-390.png");
    await fs.writeFile(narrowViewer, narrowViewerShot);
    const narrowShot = path.join(outDir, "390.png");
    await page.screenshot({ path: narrowShot, fullPage: false });

    const [wideInfo, narrowInfo] = await Promise.all([
      fs.stat(wideShot),
      fs.stat(narrowShot),
    ]);
    const report = {
      job,
      state: facts.state,
      splats,
      viewerBytes,
      screenshots: { 1440: wideShot, 390: narrowShot },
      viewerScreenshots: { 1440: wideViewer, 390: narrowViewer },
    };
    const reportPath = path.join(outDir, "report.json");
    await fs.writeFile(
      reportPath,
      `${JSON.stringify(report, null, 2)}\n`,
      "utf8",
    );

    log(`state=${facts.state} splats=${splats} viewerBytes=${viewerBytes}`);
    log(`1440  ${wideShot} (${wideInfo.size} bytes)`);
    log(`390   ${narrowShot} (${narrowInfo.size} bytes)`);
    log(`report ${reportPath}`);

    if (viewerBytes <= MIN_VIEWER_BYTES) {
      fail(
        `Viewer screenshot hanya ${viewerBytes} bytes (perlu > ` +
          `${MIN_VIEWER_BYTES}); kanvas tampak kosong. Report: ${reportPath}. / ` +
          `viewer screenshot too small.`,
      );
      return 1;
    }
    return 0;
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
    return 1;
  } finally {
    if (browser)
      await browser
        .close()
        .catch((error) => fail(`browser close gagal: ${error.message}`));
    if (server)
      await server
        .close()
        .catch((error) => fail(`server close gagal: ${error.message}`));
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    fail(error instanceof Error ? (error.stack ?? error.message) : String(error));
    process.exitCode = 1;
  });
