import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { KiriError, errorPayload, redact } from "./kiri-errors.mjs";
import { listZipEntries, readZipEntry } from "./zip.mjs";
import {
  defaultEnvFile,
  loadDotEnv,
  publicConfig,
  readKiriConfig,
} from "./kiri-config.mjs";
import { createKiriClient } from "./kiri-client.mjs";
import { createMockClient } from "./kiri-mock.mjs";
import { createKiriService } from "./kiri-service.mjs";
import { isJobId, jobPaths, readJob } from "./kiri-jobs.mjs";
import { createVideoTranscoder, sniffVideoContainer } from "./kiri-transcode.mjs";

// HTTP surface for the prototype. The browser only ever talks to /api/kiri/*;
// the API key, the KIRI serial, the temporary video and the local paths stay on
// this side. In production the same process also serves the built dist/.

const MIME = new Map(
  Object.entries({
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".woff2": "font/woff2",
    ".woff": "font/woff",
    ".glb": "model/gltf-binary",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".wasm": "application/wasm",
    ".spz": "application/octet-stream",
    ".ico": "image/x-icon",
    ".txt": "text/plain; charset=utf-8",
  }),
);

export const MAX_FILENAME = 120;

export function sanitizeFilename(value) {
  const raw = String(value || "").replace(/[/\\]/g, " ").replace(/[\u0000-\u001f]/g, "");
  const name = basename(raw).trim().slice(0, MAX_FILENAME);
  if (!name) return "video.mp4";
  return /\.mp4$/i.test(name) ? name : `${name.replace(/\.[A-Za-z0-9]{1,8}$/, "")}.mp4`;
}

export function sanitizePhotoSetName(value) {
  const name = basename(String(value || "foto").replace(/[/\\]/g, " ")).trim();
  const clean = name.slice(0, MAX_FILENAME) || "foto";
  return /\.[A-Za-z0-9]{1,8}$/.test(clean) ? clean : `${clean}.zip`;
}

export function decodeFilename(header) {
  if (!header) return "";
  try {
    return decodeURIComponent(String(header));
  } catch {
    return String(header);
  }
}

export function isMp4Header(head) {
  return (
    Buffer.isBuffer(head) &&
    head.length >= 12 &&
    head.toString("latin1", 4, 8) === "ftyp"
  );
}

// A converted clip is deduplicated by its own bytes, not by the upload it came
// from: two different WebM recordings can normalize to the same MP4 only if they
// really are the same content.
async function hashFile(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

// Seller-provided measurements, never inferred from the mesh. The header is
// "length,width,height" in centimetres; anything outside a plausible furniture
// range is ignored instead of trusted.
export function parseDimensions(header) {
  if (!header) return null;
  const parts = String(header)
    .split(/[,x×\s]+/)
    .map((value) => Number(value.replace(",", ".")));
  if (parts.length !== 3) return null;
  if (parts.some((value) => !Number.isFinite(value) || value <= 1 || value >= 1000))
    return null;
  const [length, width, height] = parts.map((value) => Math.round(value * 10) / 10);
  return { length, width, height, unit: "cm" };
}

function sendJson(res, status, payload) {
  if (res.writableEnded || res.headersSent) return;
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  res.end(body);
}

function sendError(res, error, log) {
  const kiriError = error instanceof KiriError ? error : new KiriError("internal", { cause: error });
  if (!(error instanceof KiriError))
    log?.({ event: "unhandled_error", detail: redact(error?.message ?? error) });
  else if (kiriError.detail)
    log?.({ event: "request_error", code: kiriError.code, detail: redact(kiriError.detail) });
  sendJson(res, kiriError.status, errorPayload(kiriError));
}

function methodNotAllowed(res, allowed) {
  res.writeHead(405, {
    allow: allowed.join(", "),
    "content-type": "application/json; charset=utf-8",
  });
  res.end(
    JSON.stringify({
      error: {
        code: "conflict",
        message: `Metode ini tidak didukung. Gunakan ${allowed.join(" atau ")}.`,
        retryable: false,
      },
    }),
  );
}

async function readFileBuffer(path) {
  return readFile(path);
}

async function receiveUpload(req, destination, maxBytes) {
  const declared = Number(req.headers["content-length"] || 0);
  if (declared && declared > maxBytes) {
    req.resume();
    throw new KiriError("video_too_large");
  }
  await mkdir(dirname(destination), { recursive: true });
  const { createWriteStream } = await import("node:fs");
  const hash = createHash("sha256");
  const file = createWriteStream(destination);
  let bytes = 0;
  let head = Buffer.alloc(0);
  try {
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        req.destroy();
        throw new KiriError("video_too_large");
      }
      if (head.length < 16) head = Buffer.concat([head, chunk]).subarray(0, 16);
      hash.update(chunk);
      if (!file.write(chunk)) await new Promise((done) => file.once("drain", done));
    }
  } catch (error) {
    file.destroy();
    await rm(destination, { force: true }).catch(() => {});
    throw error instanceof KiriError
      ? error
      : new KiriError("internal", { cause: error });
  }
  await new Promise((done, fail) => {
    file.end(() => done());
    file.once("error", fail);
  });
  return { bytes, hash: hash.digest("hex"), head };
}

// A job owns exactly one artifact, in the format KIRI produced: SPZ for splats,
// GLB for a featureless mesh. Asking for the other extension is a 404, so a
// stale link can never stream the wrong bytes with the wrong content type.
// `result.glb` is the preview the pipeline stands behind (refined when that
// pass applied, KIRI's own export otherwise); `raw.glb` is always KIRI's file.
async function serveArtifact(req, res, config, id, requested = "spz", { raw = false } = {}) {
  const job = await readJob(config.jobsRoot, id);
  if (!job || !job.artifact) throw new KiriError("not_found");
  const format = job.artifact.format === "glb" ? "glb" : "spz";
  if (requested !== format) throw new KiriError("not_found");
  const paths = jobPaths(config.jobsRoot, id);
  const refinedAvailable = format === "glb" && job.refine?.status === "applied";
  const file =
    format === "glb"
      ? raw || !refinedAvailable
        ? paths.model
        : paths.refined
      : paths.artifact;
  let size;
  try {
    size = (await stat(file)).size;
  } catch {
    // A refined file can disappear between the record and the request; fall
    // back to the raw scan rather than 404 the whole preview.
    if (format === "glb" && file === paths.refined) {
      return serveArtifact(req, res, config, id, requested, { raw: true });
    }
    throw new KiriError(format === "glb" ? "model_invalid" : "spz_invalid", {
      detail: format === "glb" ? "Berkas GLB hilang." : "Berkas SPZ hilang.",
    });
  }
  // Label the bytes, not the route: an unrefined `/result.glb` is the raw scan.
  const served =
    format !== "glb" ? "model" : file === paths.refined ? "refined" : "raw";
  res.writeHead(200, {
    "content-type":
      format === "glb" ? "model/gltf-binary" : "application/octet-stream",
    "content-length": size,
    "content-disposition": `inline; filename="pindai-${id}${served === "refined" ? "-halus" : ""}.${format}"`,
    "cache-control": "private, max-age=31536000, immutable",
    "x-content-type-options": "nosniff",
    "x-scan-artifact": served,
  });
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  createReadStream(file).pipe(res);
}

const PHOTO_MIME = Object.freeze({
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
});

// The seller's own stills. They are the fallback when neither model is usable,
// so they are served from the job folder, never from a temp directory.
async function servePhoto(req, res, config, id, index) {
  const job = await readJob(config.jobsRoot, id);
  if (!job || !Array.isArray(job.photos)) throw new KiriError("not_found");
  const photo = job.photos[index];
  if (!photo) throw new KiriError("not_found");
  const file = join(jobPaths(config.jobsRoot, id).photosDir, basename(photo.file));
  let size;
  try {
    size = (await stat(file)).size;
  } catch {
    throw new KiriError("not_found");
  }
  res.writeHead(200, {
    "content-type": PHOTO_MIME[extname(file).toLowerCase()] ?? "application/octet-stream",
    "content-length": size,
    "cache-control": "private, max-age=31536000, immutable",
    "x-content-type-options": "nosniff",
  });
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  createReadStream(file).pipe(res);
}

// A photoset arrives as a ZIP of JPG/PNG stills: no FFmpeg, no multipart parser,
// and the same size ceiling as a clip. Entries are validated before anything is
// written, so a hostile archive cannot land outside the temp folder.
async function receivePhotos(zip, directory, limits) {
  const entries = listZipEntries(zip).filter(
    (entry) =>
      !entry.directory &&
      !/(^|\/)__MACOSX\//.test(entry.name) &&
      /\.(jpe?g|png)$/i.test(entry.name),
  );
  if (!entries.length) throw new KiriError("photos_invalid");
  if (entries.some((entry) => entry.uncompressedSize > limits.maxPhotoBytes))
    throw new KiriError("artifact_too_large", {
      detail: "Satu foto melebihi batas ukuran.",
    });
  const picked = entries
    .sort((left, right) => left.name.localeCompare(right.name, "en", { numeric: true }))
    .slice(0, limits.maxPhotoCount);
  if (picked.length < limits.minPhotoCount)
    throw new KiriError("photos_too_few", {
      detail: `hanya ${picked.length} foto`,
    });
  await mkdir(directory, { recursive: true });
  const files = [];
  for (let index = 0; index < picked.length; index += 1) {
    const data = readZipEntry(zip, picked[index]);
    const extension = /\.png$/i.test(picked[index].name) ? "png" : "jpg";
    const filename = `${String(index + 1).padStart(3, "0")}.${extension}`;
    const path = join(directory, filename);
    await writeFile(path, data);
    files.push({ path, filename: basename(picked[index].name) });
  }
  return files;
}

async function serveStatic(req, res, config, pathname) {
  if (!config.serveDist) throw new KiriError("not_found");
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const target = resolve(config.distDir, relative);
  const root = resolve(config.distDir);
  if (target !== root && !target.startsWith(`${root}${sep}`))
    throw new KiriError("not_found");
  let file = target;
  try {
    if (!(await stat(file)).isFile()) throw new Error("not a file");
  } catch {
    if (extname(relative)) throw new KiriError("not_found");
    file = join(root, "index.html");
  }
  let size;
  try {
    size = (await stat(file)).size;
  } catch {
    throw new KiriError("not_found");
  }
  const extension = extname(file).toLowerCase();
  const immutable = /^\/assets\//.test(pathname);
  res.writeHead(200, {
    "content-type": MIME.get(extension) ?? "application/octet-stream",
    "content-length": size,
    "cache-control": immutable
      ? "public, max-age=31536000, immutable"
      : "no-cache",
  });
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  createReadStream(file).pipe(res);
}

export function createKiriServer({
  config,
  service,
  log = () => {},
  now = () => Date.now(),
  tempDir = join(config.jobsRoot, "tmp"),
  transcoder = createVideoTranscoder({
    ffmpegPath: config.ffmpegPath,
    timeoutMs: config.transcodeTimeoutMs,
    maxBytes: config.limits.maxUploadBytes,
    maxDurationS: config.limits.maxDurationS,
    log,
  }),
}) {
  return createServer(async (req, res) => {
    const started = now();
    let url;
    try {
      url = new URL(req.url ?? "/", "http://localhost");
    } catch {
      sendJson(res, 400, errorPayload(new KiriError("internal")));
      return;
    }
    const pathname = decodeURIComponent(url.pathname);
    try {
      if (pathname === "/api/kiri/config") {
        if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);
        sendJson(res, 200, publicConfig(config));
        return;
      }

      // Read-only credit probe: an integer and the mode, never the key. The
      // seller UI stays quiet about it; operators and runbooks use it to avoid
      // submitting a paid job on an empty balance.
      if (pathname === "/api/kiri/balance") {
        if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);
        if (config.mode === "unconfigured") throw new KiriError("missing_key");
        const balance = await service.balance();
        sendJson(res, 200, { mode: config.mode, balance });
        return;
      }

      if (pathname === "/api/kiri/jobs") {
        if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);
        if (config.mode === "unconfigured") {
          req.resume();
          throw new KiriError("missing_key");
        }
        const uploadStarted = now();
        const temp = join(tempDir, `${randomUUID()}.mp4`);
        await mkdir(tempDir, { recursive: true });
        const received = await receiveUpload(req, temp, config.limits.maxUploadBytes);
        if (!received.bytes) throw new KiriError("upload_empty");
        const container = sniffVideoContainer(received.head);
        if (container === "unknown") throw new KiriError("video_not_mp4");
        // iPhone Safari records MP4; Android Chromium records WebM. One of them
        // has to be converted before KIRI sees it, and the phone cannot be
        // asked to do it. The converted file becomes the job's source.
        let sourcePath = temp;
        let sourceBytes = received.bytes;
        let sourceHash = received.hash;
        let transcodedFrom = null;
        if (container !== "mp4") {
          const converted = join(tempDir, `${randomUUID()}.mp4`);
          try {
            const output = await transcoder.toMp4({
              inputPath: temp,
              outputPath: converted,
            });
            sourcePath = converted;
            sourceBytes = output.bytes;
            sourceHash = await hashFile(converted);
            transcodedFrom = container;
          } finally {
            await rm(temp, { force: true }).catch(() => {});
          }
        }
        const result = await service.submit({
          tempPath: sourcePath,
          filename: sanitizeFilename(decodeFilename(req.headers["x-file-name"])),
          bytes: sourceBytes,
          videoHash: sourceHash,
          uploadMs: now() - uploadStarted,
          transcodedFrom,
        });
        sendJson(res, result.deduplicated ? 200 : 201, {
          ...service.dto(result.job),
          deduplicated: result.deduplicated === true,
        });
        return;
      }

      if (pathname === "/api/kiri/jobs/photos") {
        if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);
        if (config.mode === "unconfigured") {
          req.resume();
          throw new KiriError("missing_key");
        }
        const uploadStarted = now();
        const temp = join(tempDir, `${randomUUID()}.zip`);
        await mkdir(tempDir, { recursive: true });
        const received = await receiveUpload(req, temp, config.limits.maxUploadBytes);
        if (!received.bytes) throw new KiriError("upload_empty");
        const photosDir = join(tempDir, `${randomUUID()}-photos`);
        try {
          const zip = await readFileBuffer(temp);
          const files = await receivePhotos(zip, photosDir, config.limits);
          const result = await service.submitPhotos({
            files,
            bytes: received.bytes,
            videoHash: received.hash,
            filename: sanitizePhotoSetName(decodeFilename(req.headers["x-file-name"])),
            dimensions: parseDimensions(decodeFilename(req.headers["x-dimensions"])),
            uploadMs: now() - uploadStarted,
          });
          sendJson(res, result.deduplicated ? 200 : 201, {
            ...service.dto(result.job),
            deduplicated: result.deduplicated === true,
          });
        } finally {
          await rm(photosDir, { recursive: true, force: true }).catch(() => {});
          await rm(temp, { force: true }).catch(() => {});
        }
        return;
      }

      const jobMatch =
        /^\/api\/kiri\/jobs\/([^/]+)(\/retry|\/refine|\/raw\.glb|\/result\.(?:spz|glb)|\/photos\/(\d+))?$/.exec(
          pathname,
        );
      if (jobMatch) {
        const id = jobMatch[1];
        const suffix = jobMatch[2] ?? "";
        if (!isJobId(id)) throw new KiriError("not_found");
        if (suffix.startsWith("/photos/")) {
          if (!["GET", "HEAD"].includes(req.method))
            return methodNotAllowed(res, ["GET", "HEAD"]);
          await servePhoto(req, res, config, id, Math.max(0, Number(jobMatch[3]) - 1));
          return;
        }
        if (suffix === "/raw.glb") {
          if (!["GET", "HEAD"].includes(req.method))
            return methodNotAllowed(res, ["GET", "HEAD"]);
          await serveArtifact(req, res, config, id, "glb", { raw: true });
          return;
        }
        if (suffix.startsWith("/result.")) {
          if (!["GET", "HEAD"].includes(req.method))
            return methodNotAllowed(res, ["GET", "HEAD"]);
          await serveArtifact(req, res, config, id, suffix.slice(-3));
          return;
        }
        if (suffix === "/retry") {
          if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);
          const job = await service.retry(id);
          sendJson(res, 202, service.dto(job));
          return;
        }
        if (suffix === "/refine") {
          if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);
          const job = await service.refine(id);
          sendJson(res, 200, service.dto(job));
          return;
        }
        if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);
        const job = await readJob(config.jobsRoot, id);
        if (!job) throw new KiriError("not_found");
        sendJson(res, 200, service.dto(job));
        return;
      }

      if (pathname.startsWith("/api/")) throw new KiriError("not_found");
      if (!["GET", "HEAD"].includes(req.method)) return methodNotAllowed(res, ["GET", "HEAD"]);
      await serveStatic(req, res, config, pathname);
    } catch (error) {
      sendError(res, error, log);
    } finally {
      if (!res.writableEnded)
        log({
          event: "request",
          method: req.method,
          path: pathname,
          status: res.statusCode,
          ms: now() - started,
        });
    }
  });
}

// Live, mock and unconfigured clients share one interface, so the routes never
// branch on the mode and a missing key cannot crash the marketplace.
function unconfiguredClient() {
  const fail = () => {
    throw new KiriError("missing_key");
  };
  return {
    provider: "kiri",
    submitVideo: fail,
    getStatus: fail,
    getModelZip: fail,
    downloadZip: fail,
  };
}

export function createClient(config) {
  if (config.mode === "mock")
    return createMockClient({
      jobsRoot: config.jobsRoot,
      latencyMs: config.mockLatencyMs,
      failMode: config.mockFail,
      failOnce: config.mockFailOnce,
    });
  if (config.mode === "live")
    return createKiriClient({
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      requestTimeoutMs: config.requestTimeoutMs,
      uploadTimeoutMs: config.uploadTimeoutMs,
      isMask: config.isMask,
      downloadTimeoutMs: config.downloadTimeoutMs,
    });
  return unconfiguredClient();
}

export function defaultLog(fields) {
  console.log(JSON.stringify({ time: new Date().toISOString(), ...fields }));
}

export async function startKiriServer({ env = process.env, cwd = process.cwd() } = {}) {
  loadDotEnv(defaultEnvFile(cwd), env);
  const config = readKiriConfig(env, cwd);
  await mkdir(join(config.jobsRoot, "tmp"), { recursive: true });
  const client = createClient(config);
  const service = createKiriService({ config, client, log: defaultLog });
  const server = createKiriServer({ config, service, log: defaultLog });
  // Node caps a whole request body at five minutes by default, which a phone
  // clip on a slow uplink can exceed. Keep the same budget as the KIRI upload.
  server.requestTimeout = config.uploadTimeoutMs;
  server.headersTimeout = 60_000;
  const resumed = await service.resume();
  await new Promise((done) => server.listen(config.port, config.host, done));
  defaultLog({
    event: "server_started",
    mode: config.mode,
    provider: "KIRI Engine",
    host: config.host,
    port: config.port,
    resumed,
    serveDist: config.serveDist,
  });
  const shutdown = () => {
    service.stop();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref?.();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  return { server, service, config };
}

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) {
  startKiriServer().catch((error) => {
    console.error(redact(error?.message ?? error));
    process.exit(1);
  });
}
