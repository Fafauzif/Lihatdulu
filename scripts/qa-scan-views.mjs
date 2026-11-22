import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";
import { testBrowserPath } from "./test-browser.js";
import { createScanServer } from "../server/scan-server.mjs";
import { isJobId, readJob } from "../server/scan-jobs.mjs";

// QA screenshot harness for the scan viewer (before/after and orbit proof).
//
// Usage:
//   node scripts/qa-scan-views.mjs --job <uuid> [--jobs-root <dir>]
//     [--dist <dir>] [--out <dir>] [--poses <json>] [--width <n>] [--height <n>]
//     [--orbit-proof]
//
// Starts a serving-only scan server from this worktree (pipeline paused on a
// never-resolving promise, distinct job root, keep=100), opens /pindai/<job> in
// headless Chromium with SwiftShader, waits for the viewer to reach
// [data-scan-viewer][data-state="ready"], optionally applies a list of fixed
// poses through host.scanViewer.setPose, waits ~600 ms and screenshots both the
// viewer element and the full page. Writes report.json with the observed pose,
// state, splat count, focus diagnostics and image paths.
//
// --poses accepts either a JSON array of pose objects (or plain azimuth
// numbers) or a comma-separated list of the same, e.g.
//   --poses '[{"azimuthDeg":0,"elevationDeg":15},{"azimuthDeg":45,"elevationDeg":15}]'
//   --poses '0,45,90,135'
//
// --orbit-proof instead drags the canvas with a real mouse (wide viewport) and
// with emulated touch (narrow viewport), asserts the azimuth moved more than
// 5 degrees, then clicks "Atur ulang" and asserts the pose returned to the
// initial values (0.5 degree / 0.005 dolly tolerance). Screenshots before and
// after each drag are saved in --out and report.json records the poses.
//
// --lifecycle-proof drags once, then resizes the viewport (1024x768, 390x844,
// back to wide), leaving the scan route through an in-app link and re-entering
// it with history back and a reload. It asserts that resizing keeps the camera
// pose and splat count, that leaving disposes the viewer, and that every
// re-entry reaches "ready" with the initial pose again.
//
// Run from the repository root. Requires a built dist (npm run build) unless
// --dist points at an existing build (the before baseline uses the primary
// checkout's dist). Every PNG is evidence on disk only.

const VIEWER_SELECTOR = "[data-scan-viewer]";
const READY_SELECTOR = `${VIEWER_SELECTOR}[data-state="ready"]`;
const CANVAS_SELECTOR = ".scan-viewer-canvas";
const RESET_SELECTOR = ".scan-viewer-reset";
const READY_TIMEOUT_MS = 60_000;
const SETTLE_MS = 600;
const WIDE_VIEWPORT = { width: 1440, height: 900 };
const NARROW_VIEWPORT = { width: 390, height: 844 };
const CHROMIUM_ARGS = [
  "--use-gl=angle",
  "--use-angle=swiftshader",
  "--enable-unsafe-swiftshader",
];
const ORBIT_MIN_DEGREES = 5;
const RESET_TOLERANCE_DEGREES = 0.5;
const RESET_TOLERANCE_SCALE = 0.005;

const USAGE = `Usage:
  node scripts/qa-scan-views.mjs --job <uuid> [options]

Options:
  --job <uuid>        Ready scan job id. Required.
  --jobs-root <dir>   Job root. Default: the overnight run's jobs folder.
  --dist <dir>        Built dist to serve. Default: ./dist
  --out <dir>         Output folder. Default: var/qa/viewer-fix/<job>-<w>x<h>
  --poses <json>      JSON array (or comma list) of poses for setPose().
  --width <n>         Viewport width. Default: 1440
  --height <n>        Viewport height. Default: 900
  --orbit-proof       Drag/touch orbit + reset assertions instead of captures.
  --lifecycle-proof   Resize, route re-entry and reload assertions instead of
                      captures.
  --help, -h          Show this message.`;

function log(message) {
  console.log(`[qa-scan-views] ${message}`);
}

function fail(message) {
  console.error(`[qa-scan-views] ${message}`);
}

function integerOption(raw, fallback, name) {
  if (raw === undefined || raw === null) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`--${name} harus bilangan bulat positif / invalid --${name}`);
  }
  return value;
}

function splitCommaList(text) {
  const tokens = [];
  let depth = 0;
  let start = 0;
  let quote = null;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quote) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === "{" || character === "[") {
      depth += 1;
    } else if (character === "}" || character === "]") {
      depth = Math.max(0, depth - 1);
    } else if (character === "," && depth === 0) {
      tokens.push(text.slice(start, index).trim());
      start = index + 1;
    }
  }
  tokens.push(text.slice(start).trim());
  return tokens.filter(Boolean);
}

function toPoseEntry(entry, index) {
  if (typeof entry === "number" && Number.isFinite(entry)) {
    return { azimuthDeg: entry };
  }
  if (entry && typeof entry === "object" && !Array.isArray(entry)) {
    const pose = {};
    if (Number.isFinite(entry.azimuthDeg)) pose.azimuthDeg = entry.azimuthDeg;
    if (Number.isFinite(entry.elevationDeg)) pose.elevationDeg = entry.elevationDeg;
    if (Number.isFinite(entry.distanceScale)) pose.distanceScale = entry.distanceScale;
    if (Object.keys(pose).length === 0) {
      throw new Error(`Pose ke-${index + 1} tidak berisi angka / empty pose`);
    }
    return pose;
  }
  throw new Error(`Pose ke-${index + 1} tidak dikenal / unknown pose value`);
}

function parsePoses(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === "") return [];
  const text = String(raw).trim();
  if (text.startsWith("[")) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw new Error(`--poses JSON tidak valid: ${error.message}`);
    }
    if (!Array.isArray(parsed)) throw new Error("--poses harus berupa array JSON");
    return parsed.map(toPoseEntry);
  }
  return splitCommaList(text).map((token, index) => {
    if (/^[-+]?\d+(?:\.\d+)?$/.test(token)) return { azimuthDeg: Number(token) };
    try {
      return toPoseEntry(JSON.parse(token), index);
    } catch (error) {
      throw new Error(`--poses token tidak valid (${token}): ${error.message}`);
    }
  });
}

function parseArgs(argv) {
  const options = {
    job: null,
    jobsRoot: null,
    dist: "dist",
    out: null,
    poses: [],
    width: WIDE_VIEWPORT.width,
    height: WIDE_VIEWPORT.height,
    orbitProof: false,
    lifecycleProof: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }
    if (argument === "--orbit-proof") {
      options.orbitProof = true;
      continue;
    }
    if (argument === "--lifecycle-proof") {
      options.lifecycleProof = true;
      continue;
    }
    const match = /^--(job|jobs-root|dist|out|poses|width|height)(?:=(.*))?$/.exec(
      argument,
    );
    if (!match) {
      throw new Error(`Argumen tidak dikenal / unknown argument: ${argument}`);
    }
    let value = match[2];
    if (value === undefined) {
      index += 1;
      value = argv[index];
    }
    if (value === undefined || value === "" || value.startsWith("--")) {
      throw new Error(
        `--${match[1]} membutuhkan nilai / --${match[1]} requires a value`,
      );
    }
    if (match[1] === "job") options.job = value;
    else if (match[1] === "jobs-root") options.jobsRoot = value;
    else if (match[1] === "dist") options.dist = value;
    else if (match[1] === "out") options.out = value;
    else if (match[1] === "poses") options.poses = parsePoses(value);
    else if (match[1] === "width")
      options.width = integerOption(value, WIDE_VIEWPORT.width, "width");
    else if (match[1] === "height")
      options.height = integerOption(value, WIDE_VIEWPORT.height, "height");
  }
  if (!options.help && !options.job) {
    throw new Error("--job wajib diisi / --job is required");
  }
  return options;
}

async function discoverJobsRoot(job) {
  const envRoot =
    process.env.LIHATDULU_JOBS_ROOT ?? process.env.SCAN_JOBS_ROOT ?? null;
  if (envRoot) return path.resolve(envRoot);
  const envRunDir = process.env.LIHATDULU_RUN_DIR;
  if (envRunDir) return path.join(path.resolve(envRunDir), "jobs");
  const overnightRoot = path.resolve("..", "Lihatdulu", "var", "overnight");
  try {
    const entries = (await fs.readdir(overnightRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    for (const name of entries.reverse()) {
      const candidate = path.join(overnightRoot, name, "jobs");
      if (existsSync(path.join(candidate, job, "job.json"))) return candidate;
    }
  } catch {}
  throw new Error(
    "--jobs-root wajib diisi: run dir default tidak ditemukan / no default run dir found",
  );
}

function angularDelta(after, before) {
  return Math.abs((((after - before + 540) % 360) - 180));
}

function poseLabel(pose, index) {
  const az = Math.round(Number(pose.azimuthDeg) || 0)
    .toString()
    .padStart(3, "0");
  const el = Math.round(Number(pose.elevationDeg) || 0)
    .toString()
    .padStart(3, "0");
  const dolly = Math.round((Number(pose.distanceScale) || 1) * 1000);
  return `${String(index).padStart(2, "0")}-az${az}-el${el}-d${dolly}`;
}

async function readFacts(page) {
  return page.$eval(VIEWER_SELECTOR, (host) => {
    const reset = host.querySelector(".scan-viewer-reset");
    let pose = null;
    try {
      pose = host.scanViewer?.getPose?.() ?? null;
    } catch {
      pose = null;
    }
    return {
      state: host.getAttribute("data-state") ?? "missing",
      splats: Number.parseInt(host.getAttribute("data-splats") ?? "", 10),
      pose,
      scanPose: host.dataset.scanPose ?? null,
      focusBox: host.dataset.scanFocusBox ?? null,
      focusCenter: host.dataset.scanFocusCenter ?? null,
      focusRadius: host.dataset.scanFocusRadius ?? null,
      rootBox: host.dataset.scanRootBox ?? null,
      resetLabel: reset?.textContent ?? null,
      resetHidden: reset ? Boolean(reset.hidden) : null,
      hasPoseApi: Boolean(host.scanViewer && host.scanViewer.setPose),
    };
  });
}

async function waitForReady(page, baseUrl, job) {
  log(`opening ${baseUrl}/pindai/${job}`);
  await page.goto(`${baseUrl}/pindai/${job}`, { waitUntil: "domcontentloaded" });
  try {
    await page.waitForSelector(READY_SELECTOR, { timeout: READY_TIMEOUT_MS });
  } catch {
    const observed = await page
      .evaluate(() => {
        const host = document.querySelector("[data-scan-viewer]");
        return {
          state: host?.getAttribute("data-state") ?? "missing",
          message:
            host?.querySelector("[data-scan-viewer-placeholder]")?.textContent ??
            "",
        };
      })
      .catch(() => ({ state: "unknown", message: "" }));
    throw new Error(
      `Pratinjau 3D tidak mencapai state "ready" dalam ` +
        `${READY_TIMEOUT_MS / 1000} detik (state terakhir: "${observed.state}"` +
        `${observed.message ? `, pesan: "${observed.message}"` : ""}). / ` +
        `viewer never reached ready.`,
    );
  }
  await page.waitForTimeout(SETTLE_MS);
}

async function saveViewerShot(page, outDir, label) {
  const viewerPath = path.join(outDir, `${label}-viewer.png`);
  const pagePath = path.join(outDir, `${label}-page.png`);
  const viewerShot = await page.locator(VIEWER_SELECTOR).screenshot();
  await fs.writeFile(viewerPath, viewerShot);
  await page.screenshot({ path: pagePath, fullPage: false });
  return { viewer: viewerPath, page: pagePath, viewerBytes: viewerShot.length };
}

async function captureMode(browser, server, options, outDir) {
  const report = {
    mode: "capture",
    job: options.job,
    width: options.width,
    height: options.height,
    dist: path.resolve(options.dist),
    jobsRoot: path.resolve(options.jobsRoot),
    generatedAt: new Date().toISOString(),
    default: null,
    poses: [],
    images: [],
  };
  const context = await browser.newContext({
    viewport: { width: options.width, height: options.height },
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  try {
    await waitForReady(page, server.url, options.job);
    const facts = await readFacts(page);
    if (facts.state !== "ready") {
      throw new Error(`Viewer berubah ke state "${facts.state}"`);
    }
    if (!Number.isInteger(facts.splats) || facts.splats <= 0) {
      throw new Error(`data-splats tidak sah: ${facts.splats}`);
    }
    const initialPose = facts.pose;
    const defaultShot = await saveViewerShot(page, outDir, "00-default");
    report.default = {
      requested: null,
      applied: facts.pose,
      scanPose: facts.scanPose,
      state: facts.state,
      splats: facts.splats,
      ...defaultShot,
    };
    report.images.push(defaultShot.viewer, defaultShot.page);
    report.pose = facts.pose;
    report.state = facts.state;
    report.splats = facts.splats;
    report.diagnostics = {
      focusBox: facts.focusBox,
      focusCenter: facts.focusCenter,
      focusRadius: facts.focusRadius,
      rootBox: facts.rootBox,
    };
    report.resetControl = {
      label: facts.resetLabel,
      hidden: facts.resetHidden,
    };
    report.pageErrors = pageErrors;
    log(
      `default state=${facts.state} splats=${facts.splats} pose=` +
        `${JSON.stringify(facts.pose)} viewerBytes=${defaultShot.viewerBytes}`,
    );

    if (options.poses.length > 0) {
      if (!facts.hasPoseApi) {
        throw new Error(
          "host.scanViewer.setPose tidak tersedia; dist ini memakai viewer lama. / pose API missing.",
        );
      }
      for (let index = 0; index < options.poses.length; index += 1) {
        const requested = options.poses[index];
        const applied = await page.evaluate(
          (pose) =>
            document.querySelector("[data-scan-viewer]").scanViewer.setPose(pose),
          requested,
        );
        await page.waitForTimeout(SETTLE_MS);
        const after = await readFacts(page);
        const label = poseLabel(applied, index + 1);
        const shot = await saveViewerShot(page, outDir, label);
        const entry = {
          requested,
          applied,
          scanPose: after.scanPose,
          state: after.state,
          splats: after.splats,
          ...shot,
        };
        report.poses.push(entry);
        report.images.push(shot.viewer, shot.page);
        log(
          `${label} requested=${JSON.stringify(requested)} applied=` +
            `${JSON.stringify(applied)} viewerBytes=${shot.viewerBytes}`,
        );
      }
      report.pose = initialPose;
    }
    await fs.writeFile(
      path.join(outDir, "report.json"),
      `${JSON.stringify(report, null, 2)}\n`,
      "utf8",
    );
    log(`report ${path.join(outDir, "report.json")}`);
    return report;
  } finally {
    await context.close().catch(() => {});
  }
}

async function getPose(page) {
  return page.evaluate(
    () => document.querySelector("[data-scan-viewer]")?.scanViewer?.getPose?.() ?? null,
  );
}

async function dragMouse(page) {
  const box = await page.locator(CANVAS_SELECTOR).boundingBox();
  if (!box) throw new Error("canvas tidak ditemukan / canvas not found");
  const startX = box.x + box.width * 0.58;
  const startY = box.y + box.height * 0.55;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX - 220, startY + 12, { steps: 14 });
  await page.mouse.up();
  await page.waitForTimeout(350);
}

async function dragTouch(context, page) {
  const box = await page.locator(CANVAS_SELECTOR).boundingBox();
  if (!box) throw new Error("canvas tidak ditemukan / canvas not found");
  const cdp = await context.newCDPSession(page);
  const startX = box.x + box.width * 0.72;
  const startY = box.y + box.height * 0.55;
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: startX, y: startY, id: 1 }],
  });
  for (let step = 1; step <= 12; step += 1) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: startX - step * 14, y: startY, id: 1 }],
    });
  }
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await cdp.detach().catch(() => {});
  await page.waitForTimeout(350);
}

async function resetByClick(page) {
  await page.locator(RESET_SELECTOR).click();
  await page.waitForTimeout(350);
}

async function resetByTap(page) {
  await page.locator(RESET_SELECTOR).tap();
  await page.waitForTimeout(350);
}

function poseClose(after, before) {
  if (!after || !before) return false;
  return (
    angularDelta(after.azimuthDeg, before.azimuthDeg) <= RESET_TOLERANCE_DEGREES &&
    Math.abs(after.elevationDeg - before.elevationDeg) <=
      RESET_TOLERANCE_DEGREES &&
    Math.abs(after.distanceScale - before.distanceScale) <=
      RESET_TOLERANCE_SCALE
  );
}

async function orbitProofMode(browser, server, options, outDir) {
  const report = {
    mode: "orbit-proof",
    job: options.job,
    width: options.width,
    height: options.height,
    dist: path.resolve(options.dist),
    jobsRoot: path.resolve(options.jobsRoot),
    generatedAt: new Date().toISOString(),
    mouse: {},
    touch: {},
    checks: [],
    images: [],
  };
  const check = (name, pass, detail) => {
    report.checks.push({ name, pass, ...detail });
    if (!pass) fail(`check gagal: ${name} ${JSON.stringify(detail)}`);
  };

  const wide = await browser.newContext({
    viewport: { width: options.width, height: options.height },
  });
  try {
    const page = await wide.newPage();
    await waitForReady(page, server.url, options.job);
    const before = await readFacts(page);
    const initialPose = before.pose;
    const beforeShot = await saveViewerShot(page, outDir, "orbit-wide-before");
    report.images.push(beforeShot.viewer, beforeShot.page);
    await dragMouse(page);
    const afterPose = await getPose(page);
    const afterShot = await saveViewerShot(page, outDir, "orbit-wide-after-drag");
    report.images.push(afterShot.viewer, afterShot.page);
    report.mouse = {
      initial: initialPose,
      afterDrag: afterPose,
      azimuthDelta: angularDelta(afterPose.azimuthDeg, initialPose.azimuthDeg),
      canvasPointerType: "mouse",
    };
    check(
      "mouse drag mengubah azimuth > 5 derajat",
      report.mouse.azimuthDelta > ORBIT_MIN_DEGREES,
      { azimuthDelta: report.mouse.azimuthDelta },
    );
    await resetByClick(page);
    const resetPose = await getPose(page);
    const resetShot = await saveViewerShot(page, outDir, "orbit-wide-after-reset");
    report.images.push(resetShot.viewer, resetShot.page);
    report.mouse.afterReset = resetPose;
    report.mouse.resetMatchesInitial = poseClose(resetPose, initialPose);
    check(
      "Atur ulang mengembalikan pose awal (toleransi 0.5 derajat)",
      report.mouse.resetMatchesInitial,
      { afterReset: resetPose, initial: initialPose },
    );
    log(
      `mouse azDelta=${report.mouse.azimuthDelta.toFixed(2)} reset=` +
        `${JsonShort(resetPose)} match=${report.mouse.resetMatchesInitial}`,
    );
  } finally {
    await wide.close().catch(() => {});
  }

  const narrow = await browser.newContext({
    viewport: {
      width: NARROW_VIEWPORT.width,
      height: NARROW_VIEWPORT.height,
    },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 1,
  });
  try {
    const page = await narrow.newPage();
    await waitForReady(page, server.url, options.job);
    const before = await readFacts(page);
    const initialPose = before.pose;
    const beforeShot = await saveViewerShot(page, outDir, "orbit-touch-before");
    report.images.push(beforeShot.viewer, beforeShot.page);
    await dragTouch(narrow, page);
    const afterPose = await getPose(page);
    const afterShot = await saveViewerShot(page, outDir, "orbit-touch-after-drag");
    report.images.push(afterShot.viewer, afterShot.page);
    report.touch = {
      initial: initialPose,
      afterDrag: afterPose,
      azimuthDelta: angularDelta(afterPose.azimuthDeg, initialPose.azimuthDeg),
      canvasPointerType: "touch",
      hasTouch: true,
    };
    check(
      "sentuhan (touch) mengubah azimuth > 5 derajat",
      report.touch.azimuthDelta > ORBIT_MIN_DEGREES,
      { azimuthDelta: report.touch.azimuthDelta },
    );
    await resetByTap(page);
    const resetPose = await getPose(page);
    const resetShot = await saveViewerShot(page, outDir, "orbit-touch-after-reset");
    report.images.push(resetShot.viewer, resetShot.page);
    report.touch.afterReset = resetPose;
    report.touch.resetMatchesInitial = poseClose(resetPose, initialPose);
    check(
      "Atur ulang (touch) mengembalikan pose awal (toleransi 0.5 derajat)",
      report.touch.resetMatchesInitial,
      { afterReset: resetPose, initial: initialPose },
    );
    log(
      `touch azDelta=${report.touch.azimuthDelta.toFixed(2)} reset=` +
        `${JsonShort(resetPose)} match=${report.touch.resetMatchesInitial}`,
    );
  } finally {
    await narrow.close().catch(() => {});
  }

  await fs.writeFile(
    path.join(outDir, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
  const failed = report.checks.filter((entry) => !entry.pass);
  log(
    `orbit proof: ${report.checks.length - failed.length}/${report.checks.length} checks lulus`,
  );
  return report;
}

const LIFECYCLE_VIEWPORTS = [
  { width: 1024, height: 768, label: "resize-1024x768" },
  { width: NARROW_VIEWPORT.width, height: NARROW_VIEWPORT.height, label: "resize-390x844" },
  { width: WIDE_VIEWPORT.width, height: WIDE_VIEWPORT.height, label: "resize-1440x900" },
];

async function readCanvasBox(page) {
  return page.$eval(CANVAS_SELECTOR, (canvas) => {
    const host = canvas.closest("[data-scan-viewer]");
    return {
      css: { width: canvas.clientWidth, height: canvas.clientHeight },
      host: {
        width: host?.clientWidth ?? 0,
        height: host?.clientHeight ?? 0,
      },
      backing: { width: canvas.width, height: canvas.height },
    };
  });
}

// Drag once, then prove the camera pose and the splat set survive resizes, that
// leaving the route disposes the viewer, and that history back plus a reload
// both rebuild it at the initial pose.
async function lifecycleProofMode(browser, server, options, outDir) {
  const report = {
    mode: "lifecycle-proof",
    job: options.job,
    width: options.width,
    height: options.height,
    dist: path.resolve(options.dist),
    jobsRoot: path.resolve(options.jobsRoot),
    generatedAt: new Date().toISOString(),
    initial: {},
    posed: null,
    resizes: [],
    routeLeave: {},
    routeReentry: {},
    reload: {},
    checks: [],
    images: [],
  };
  const check = (name, pass, detail) => {
    report.checks.push({ name, pass, ...detail });
    if (!pass) fail(`check gagal: ${name} ${JSON.stringify(detail)}`);
  };

  const context = await browser.newContext({
    viewport: { width: options.width, height: options.height },
  });
  try {
    const page = await context.newPage();
    await waitForReady(page, server.url, options.job);
    const initial = await readFacts(page);
    report.initial = initial;
    check(
      "viewer mencapai state ready dengan jumlah splat > 0",
      initial.state === "ready" && initial.splats > 0,
      { state: initial.state, splats: initial.splats },
    );
    check(
      "viewer mengekspos API pose dan tombol Atur ulang",
      initial.hasPoseApi && initial.resetLabel !== null && initial.resetHidden === false,
      { hasPoseApi: initial.hasPoseApi, resetLabel: initial.resetLabel, resetHidden: initial.resetHidden },
    );
    const initialShot = await saveViewerShot(page, outDir, "lifecycle-initial");
    report.images.push(initialShot.viewer, initialShot.page);

    await dragMouse(page);
    const posed = await getPose(page);
    report.posed = posed;
    const dragDelta = angularDelta(posed.azimuthDeg, initial.pose.azimuthDeg);
    check("drag mengubah pose sebelum resize", dragDelta > ORBIT_MIN_DEGREES, {
      azimuthDelta: dragDelta,
    });

    for (const viewport of LIFECYCLE_VIEWPORTS) {
      await page.setViewportSize({
        width: viewport.width,
        height: viewport.height,
      });
      await page.waitForTimeout(SETTLE_MS);
      const facts = await readFacts(page);
      const canvas = await readCanvasBox(page);
      const poseKept = poseClose(facts.pose, posed);
      const splatsKept = facts.state === "ready" && facts.splats === initial.splats;
      const canvasFits =
        Math.abs(canvas.css.width - canvas.host.width) <= 2 &&
        Math.abs(canvas.css.height - canvas.host.height) <= 2 &&
        canvas.backing.width > 0 &&
        canvas.backing.height > 0;
      report.resizes.push({
        viewport,
        pose: facts.pose,
        poseKept,
        splats: facts.splats,
        canvas,
      });
      check(
        `${viewport.label} menjaga pose kamera`,
        poseKept,
        { pose: facts.pose, expected: posed },
      );
      check(`${viewport.label} tetap ready dengan jumlah splat sama`, splatsKept, {
        state: facts.state,
        splats: facts.splats,
        expectedSplats: initial.splats,
      });
      check(`${viewport.label} canvas mengikuti ukuran host`, canvasFits, { canvas });
      const shot = await saveViewerShot(page, outDir, `lifecycle-${viewport.label}`);
      report.images.push(shot.viewer, shot.page);
    }

    const leaveTarget = await page
      .locator('a.brand[data-nav]')
      .first()
      .getAttribute("href");
    await page.locator('a.brand[data-nav]').first().click();
    await page.waitForFunction(
      () => !document.querySelector("[data-scan-viewer]"),
      undefined,
      { timeout: 15_000 },
    );
    const afterLeave = await page.evaluate(() => ({
      path: location.pathname,
      viewers: document.querySelectorAll("[data-scan-viewer]").length,
      bodies: document.querySelectorAll("canvas.scan-viewer-canvas").length,
    }));
    report.routeLeave = { target: leaveTarget, ...afterLeave };
    check(
      "navigasi dalam aplikasi meninggalkan rute pindai dan membuang viewer",
      afterLeave.path !== `/pindai/${options.job}` &&
        afterLeave.viewers === 0 &&
        afterLeave.bodies === 0,
      report.routeLeave,
    );
    await page.screenshot({
      path: path.join(outDir, "lifecycle-route-left-page.png"),
    });
    report.images.push(path.join(outDir, "lifecycle-route-left-page.png"));

    await page.goBack();
    await waitForReady(page, server.url, options.job);
    const reentry = await readFacts(page);
    const reentryPose = reentry.pose;
    const reentryDefault = poseClose(reentryPose, initial.pose);
    const reentryDiffersFromDrag = angularDelta(reentryPose.azimuthDeg, posed.azimuthDeg) > ORBIT_MIN_DEGREES;
    report.routeReentry = {
      path: await page.evaluate(() => location.pathname),
      pose: reentryPose,
      resetMatchesInitial: reentryDefault,
      differsFromDraggedPose: reentryDiffersFromDrag,
      splats: reentry.splats,
      state: reentry.state,
    };
    check(
      "kembali ke rute pindai memuat viewer sampai ready dengan splat yang sama",
      reentry.state === "ready" && reentry.splats === initial.splats,
      { state: reentry.state, splats: reentry.splats, expected: initial.splats },
    );
    check(
      "re-entry memakai pose awal, bukan pose hasil drag",
      reentryDefault && reentryDiffersFromDrag,
      { pose: reentryPose, initialPose: initial.pose, draggedPose: posed },
    );
    const reentryShot = await saveViewerShot(page, outDir, "lifecycle-route-reentry");
    report.images.push(reentryShot.viewer, reentryShot.page);

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(READY_SELECTOR, { timeout: READY_TIMEOUT_MS });
    await page.waitForTimeout(SETTLE_MS);
    const reloaded = await readFacts(page);
    report.reload = {
      state: reloaded.state,
      splats: reloaded.splats,
      pose: reloaded.pose,
      resetMatchesInitial: poseClose(reloaded.pose, initial.pose),
    };
    check(
      "muat ulang penuh membangun kembali viewer sampai ready",
      reloaded.state === "ready" && reloaded.splats === initial.splats,
      { state: reloaded.state, splats: reloaded.splats, expected: initial.splats },
    );
    check(
      "muat ulang penuh kembali ke pose awal",
      report.reload.resetMatchesInitial,
      { pose: reloaded.pose, initialPose: initial.pose },
    );
    const reloadShot = await saveViewerShot(page, outDir, "lifecycle-reload");
    report.images.push(reloadShot.viewer, reloadShot.page);
  } finally {
    await context.close().catch(() => {});
  }

  await fs.writeFile(
    path.join(outDir, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
  const failed = report.checks.filter((entry) => !entry.pass);
  log(
    `lifecycle proof: ${report.checks.length - failed.length}/${report.checks.length} checks lulus`,
  );
  return report;
}

function JsonShort(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
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
  // --jobs-root wins; discovery is only the convenience default. Overwriting a
  // supplied root silently served the wrong job store (found 2026-11-22 when a
  // second root was ignored).
  if (!options.jobsRoot) {
    try {
      options.jobsRoot = await discoverJobsRoot(job);
    } catch (error) {
      fail(error.message);
      return 1;
    }
  }
  const jobsRoot = path.resolve(options.jobsRoot);
  const distDir = path.resolve(options.dist);
  if (!existsSync(path.join(distDir, "index.html"))) {
    fail(
      `dist/index.html tidak ada di ${distDir}. Jalankan "npm run build" dulu ` +
        `atau arahkan --dist ke build yang ada. / No built dist.`,
    );
    return 1;
  }
  const record = await readJob(jobsRoot, job);
  if (!record) {
    fail(
      `Job ${job} tidak ditemukan (tidak ada job.json di ` +
        `${path.join(jobsRoot, job)}). / Job not found.`,
    );
    return 1;
  }
  if (record.stage !== "ready") {
    fail(`Job ${job} berstatus "${record.stage}", bukan "ready".`);
    return 1;
  }
  const outDir = path.resolve(
    options.out ??
      path.join(
        "var",
        "qa",
        "viewer-fix",
        `${job}-${options.width}x${options.height}`,
      ),
  );
  await fs.mkdir(outDir, { recursive: true });
  log(
    `job=${job} title=${record.meta?.title ?? ""} jobsRoot=${jobsRoot} ` +
      `dist=${distDir} out=${outDir} viewport=${options.width}x${options.height}`,
  );

  let server = null;
  let browser = null;
  try {
    server = await createScanServer({
      root: jobsRoot,
      pipeline: async () => new Promise(() => {}),
      distDir,
      keep: 100,
    });
    log(`serving ${jobsRoot} at ${server.url} (pipeline paused)`);
    browser = await chromium.launch({
      executablePath: await testBrowserPath(),
      headless: true,
      args: CHROMIUM_ARGS,
    });
    const report = options.orbitProof
      ? await orbitProofMode(browser, server, options, outDir)
      : options.lifecycleProof
        ? await lifecycleProofMode(browser, server, options, outDir)
        : await captureMode(browser, server, options, outDir);
    if (options.orbitProof || options.lifecycleProof) {
      return report.checks.every((entry) => entry.pass) ? 0 : 1;
    }
    if (report.state !== "ready" || report.splats <= 0) {
      fail(`state/splats tidak sah: ${report.state}/${report.splats}`);
      return 1;
    }
    return 0;
  } catch (error) {
    fail(error instanceof Error ? (error.stack ?? error.message) : String(error));
    return 1;
  } finally {
    if (browser) {
      await browser
        .close()
        .catch((error) => fail(`browser close gagal: ${error.message}`));
    }
    if (server) {
      await server
        .close()
        .catch((error) => fail(`server close gagal: ${error.message}`));
    }
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    fail(
      error instanceof Error ? (error.stack ?? error.message) : String(error),
    );
    process.exitCode = 1;
  });
