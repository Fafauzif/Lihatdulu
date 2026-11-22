import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { KiriError, errorPayload, redact } from "./kiri-errors.mjs";
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
async function serveArtifact(req, res, config, id, requested = "spz") {
  const job = await readJob(config.jobsRoot, id);
  if (!job || !job.artifact) throw new KiriError("not_found");
  const format = job.artifact.format === "glb" ? "glb" : "spz";
  if (requested !== format) throw new KiriError("not_found");
  const paths = jobPaths(config.jobsRoot, id);
  const file = format === "glb" ? paths.model : paths.artifact;
  let size;
  try {
    size = (await stat(file)).size;
  } catch {
    throw new KiriError(format === "glb" ? "model_invalid" : "spz_invalid", {
      detail: format === "glb" ? "Berkas GLB hilang." : "Berkas SPZ hilang.",
    });
  }
  res.writeHead(200, {
    "content-type":
      format === "glb" ? "model/gltf-binary" : "application/octet-stream",
    "content-length": size,
    "content-disposition": `inline; filename="pindai-${id}.${format}"`,
    "cache-control": "private, max-age=31536000, immutable",
    "x-content-type-options": "nosniff",
  });
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  createReadStream(file).pipe(res);
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
        if (!isMp4Header(received.head)) throw new KiriError("video_not_mp4");
        const result = await service.submit({
          tempPath: temp,
          filename: sanitizeFilename(decodeFilename(req.headers["x-file-name"])),
          bytes: received.bytes,
          videoHash: received.hash,
          uploadMs: now() - uploadStarted,
        });
        sendJson(res, result.deduplicated ? 200 : 201, {
          ...service.dto(result.job),
          deduplicated: result.deduplicated === true,
        });
        return;
      }

      const jobMatch =
        /^\/api\/kiri\/jobs\/([^/]+)(\/retry|\/result\.(?:spz|glb))?$/.exec(pathname);
      if (jobMatch) {
        const id = jobMatch[1];
        const suffix = jobMatch[2] ?? "";
        if (!isJobId(id)) throw new KiriError("not_found");
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
