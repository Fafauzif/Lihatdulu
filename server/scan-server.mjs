import { createServer } from "node:http";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { once } from "node:events";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createJob,
  jobPaths,
  listJobs,
  pruneJobs,
  readJob,
  TERMINAL_STAGES,
  updateJob,
} from "./scan-jobs.mjs";
import { mediaExtension, parseScanMeta } from "./scan-meta.mjs";
import { ScanError } from "./scan-errors.mjs";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));

export const MAX_UPLOAD_BYTES = 104857600;
export const MAX_QUEUE = 3;
export const SCAN_KEEP = 10;

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
    ".woff2": "font/woff2",
    ".glb": "model/gltf-binary",
    ".mp4": "video/mp4",
    ".wasm": "application/wasm",
    ".spz": "application/octet-stream",
    ".ply": "application/octet-stream",
    ".ico": "image/x-icon",
  }),
);

export function toScanDto(record) {
  return {
    id: record.id,
    stage: record.stage,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    meta: record.meta,
    media: record.media,
    provenance: record.provenance,
    error: record.error,
    artifact: record.artifact
      ? {
          format: record.artifact.format,
          bytes: record.artifact.bytes,
          splatCount: record.artifact.splatCount,
          url: `/api/scans/${record.id}/result/${record.artifact.file}`,
          stills: record.artifact.stills.map(
            (_, index) => `/api/scans/${record.id}/frame/${index}`,
          ),
        }
      : null,
  };
}

async function selectPipeline() {
  if (process.env.SCAN_PIPELINE === "fake")
    return (await import("./scan-fake.mjs")).runFakePipeline;
  return (await import("./scan-pipeline.mjs")).runRealPipeline;
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

// An idempotent hit answers before the retried clip is consumed. Drain (or
// wait for the abort) so the response is not written while the body streams.
function drainRequest(req, timeoutMs = 10_000) {
  if (req.readableEnded || req.complete) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(done, timeoutMs);
    timer.unref?.();
    req.once("end", done);
    req.once("aborted", done);
    req.once("error", done);
    req.resume();
  });
}

function fail(res, error) {
  const scanError =
    error instanceof ScanError
      ? error
      : new ScanError("internal", "Terjadi kesalahan.");
  if (!(error instanceof ScanError)) console.error(error);
  if (res.headersSent) {
    res.destroy();
    return;
  }
  sendJson(res, scanError.status, {
    error: { code: scanError.code, message: scanError.message },
  });
}

function notFound() {
  return new ScanError("not_found", "Tidak ditemukan.");
}

function methodNotAllowed(res, allowed) {
  res.writeHead(405, {
    allow: allowed.join(", "),
    "cache-control": "no-store",
  });
  res.end();
}

async function sendFile(res, file, contentType = "application/octet-stream") {
  let info;
  try {
    info = await stat(file);
  } catch {
    throw notFound();
  }
  if (!info.isFile()) throw notFound();
  res.writeHead(200, {
    "content-type": contentType,
    "content-length": info.size,
    "cache-control": "no-store",
  });
  createReadStream(file).pipe(res);
}

export async function createScanServer(options = {}) {
  const root = resolve(options.root ?? join(repoRoot, "var/scans"));
  const distDir = resolve(
    options.distDir ?? process.env.SCAN_DIST ?? join(repoRoot, "dist"),
  );
  const pipeline = options.pipeline ?? (await selectPipeline());
  const host = options.host ?? "127.0.0.1";
  const port = Number(options.port ?? 0);
  const staticEnabled = options.staticEnabled !== false;
  const keep = Number(options.keep ?? process.env.SCAN_KEEP ?? SCAN_KEEP);
  const state = { active: null, queue: [] };
  const lifecycle = new AbortController();

  await mkdir(root, { recursive: true });
  for (const record of await listJobs(root)) {
    if (TERMINAL_STAGES.includes(record.stage)) continue;
    await updateJob(root, record.id, {
      stage: "failed",
      error: {
        code: "server_stopped",
        message: "Server demo berhenti sebelum pemrosesan selesai.",
      },
    }).catch(() => {});
  }
  await pruneJobs(root, keep).catch(() => {});

  function enqueue(id) {
    if (state.queue.length >= MAX_QUEUE) return false;
    state.queue.push(id);
    void pump();
    return true;
  }

  async function pump() {
    if (state.active) return;
    const next = state.queue.shift();
    if (!next) return;
    state.active = next;
    try {
      const record = await readJob(root, next);
      if (!record) throw notFound();
      const result = await pipeline(record, {
        root,
        signal: lifecycle.signal,
        updateStage: async (stage, patch = {}) => {
          await updateJob(root, next, { stage, ...patch });
        },
      });
      const current = await readJob(root, next);
      if (current && !TERMINAL_STAGES.includes(current.stage))
        await updateJob(root, next, {
          stage: "ready",
          media: result?.media ?? current.media,
          provenance: result?.provenance ?? null,
          artifact: result?.artifact ?? null,
        }).catch(() => {});
    } catch (error) {
      const current = await readJob(root, next).catch(() => null);
      if (current && !TERMINAL_STAGES.includes(current.stage)) {
        const code = error instanceof ScanError ? error.code : "internal";
        const message =
          error instanceof ScanError ? error.message : "Pemrosesan gagal.";
        await updateJob(root, next, {
          stage: "failed",
          error: { code, message },
        }).catch(() => {});
      }
      if (!(error instanceof ScanError)) console.error(error);
    } finally {
      state.active = null;
      await pruneJobs(root, keep).catch(() => {});
      void pump();
    }
  }

  async function handleCreate(req, res, url) {
    const contentType = req.headers["content-type"];
    if (!mediaExtension(contentType))
      throw new ScanError("unsupported_media", "Format video tidak didukung.");
    const declared = Number(req.headers["content-length"]);
    if (!Number.isInteger(declared) || declared <= 0)
      throw new ScanError(
        "length_required",
        "Ukuran unggahan wajib dikirim.",
      );
    if (declared > MAX_UPLOAD_BYTES)
      throw new ScanError(
        "too_large",
        "Rekaman terlalu besar. Maksimal 100 MB.",
      );
    if (state.queue.length >= MAX_QUEUE)
      throw new ScanError(
        "queue_full",
        "Antrean sedang penuh. Coba lagi sebentar.",
      );
    const meta = parseScanMeta(url.searchParams);
    if (meta.clientId) {
      const existing = (await listJobs(root)).find(
        (record) =>
          record.clientId === meta.clientId &&
          Date.now() - Date.parse(record.createdAt) < 3_600_000,
      );
      if (existing) {
        await drainRequest(req);
        sendJson(res, 200, { id: existing.id });
        return;
      }
    }
    const record = await createJob(root, meta);
    const paths = jobPaths(root, record.id);
    const extension = mediaExtension(contentType);
    const file = `${paths.clip}.${extension}`;
    let received = 0;
    try {
      await mkdir(dirname(file), { recursive: true });
      const out = createWriteStream(file, { flags: "wx" });
      for await (const chunk of req) {
        received += chunk.length;
        if (received > MAX_UPLOAD_BYTES)
          throw new ScanError(
            "too_large",
            "Rekaman terlalu besar. Maksimal 100 MB.",
          );
        if (!out.write(chunk)) await once(out, "drain");
      }
      if (received !== declared)
        throw new ScanError("upload_incomplete", "Unggahan tidak lengkap.");
      await new Promise((resolveEnd, rejectEnd) => {
        out.end(resolveEnd);
        out.once("error", rejectEnd);
      });
    } catch (error) {
      await rm(file, { force: true }).catch(() => {});
      await updateJob(root, record.id, {
        stage: "failed",
        error: {
          code: error instanceof ScanError ? error.code : "upload_incomplete",
          message:
            error instanceof ScanError ? error.message : "Unggahan gagal.",
        },
      }).catch(() => {});
      throw error;
    }
    await updateJob(root, record.id, {
      media: {
        ...record.media,
        contentType: contentType.split(";")[0].trim().toLowerCase(),
        bytes: received,
      },
    });
    if (!enqueue(record.id)) {
      await updateJob(root, record.id, {
        stage: "failed",
        error: { code: "queue_full", message: "Antrean sedang penuh." },
      });
      throw new ScanError(
        "queue_full",
        "Antrean sedang penuh. Coba lagi sebentar.",
      );
    }
    sendJson(res, 201, { id: record.id });
  }

  async function handleResult(res, id, file) {
    const record = await readJob(root, id);
    if (!record) throw notFound();
    if (record.stage !== "ready" || !record.artifact)
      throw new ScanError("not_ready", "Hasil belum siap.");
    if (file !== record.artifact.file) throw notFound();
    await sendFile(res, join(jobPaths(root, id).output, record.artifact.file));
  }

  async function handleFrame(res, id, frame) {
    const record = await readJob(root, id);
    if (!record) throw notFound();
    if (record.stage !== "ready" || !record.artifact)
      throw new ScanError("not_ready", "Hasil belum siap.");
    const index = Number(frame);
    if (!Number.isInteger(index) || String(index) !== String(frame))
      throw notFound();
    const name = record.artifact.stills[index];
    if (!name) throw notFound();
    const type =
      {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
        ".svg": "image/svg+xml",
      }[extname(name).toLowerCase()] ?? "application/octet-stream";
    await sendFile(res, join(jobPaths(root, id).stills, name), type);
  }

  async function handleApi(req, res, url, parts) {
    if (parts[1] !== "scans") throw notFound();
    if (parts.length === 2) {
      if (req.method === "POST") return handleCreate(req, res, url);
      if (req.method === "GET") throw notFound();
      return methodNotAllowed(res, ["POST"]);
    }
    if (parts.length === 3) {
      if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);
      const record = await readJob(root, parts[2]);
      if (!record)
        throw new ScanError("not_found", "Hasil pindai tidak ditemukan.");
      return sendJson(res, 200, toScanDto(record));
    }
    if (parts.length === 5 && parts[3] === "result") {
      if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);
      return handleResult(res, parts[2], parts[4]);
    }
    if (parts.length === 5 && parts[3] === "frame") {
      if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);
      return handleFrame(res, parts[2], parts[4]);
    }
    throw notFound();
  }

  async function handleStatic(req, res, url) {
    if (!staticEnabled) throw notFound();
    if (!["GET", "HEAD"].includes(req.method))
      return methodNotAllowed(res, ["GET", "HEAD"]);
    let decoded;
    try {
      decoded = decodeURIComponent(url.pathname);
    } catch {
      throw notFound();
    }
    if (decoded.includes("\0")) throw notFound();
    const base = resolve(distDir);
    let file = resolve(base, `.${decoded}`);
    if (file !== base && !file.startsWith(base + sep)) throw notFound();
    let info = await stat(file).catch(() => null);
    if (!info || info.isDirectory()) {
      if (extname(decoded)) throw notFound();
      file = join(base, "index.html");
      info = await stat(file).catch(() => null);
      if (!info)
        throw new ScanError(
          "not_found",
          "Situs belum dibangun. Jalankan npm run build.",
        );
    }
    const type =
      MIME.get(extname(file).toLowerCase()) ?? "application/octet-stream";
    res.writeHead(200, {
      "content-type": type,
      "content-length": info.size,
      "cache-control": "no-store",
    });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    createReadStream(file).pipe(res);
  }

  async function handle(req, res) {
    const url = new URL(req.url, "http://scan.local");
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0] === "api") return handleApi(req, res, url, parts);
    return handleStatic(req, res, url);
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((error) => {
      // A rejected upload still has a body in flight; drain it so the client
      // can read the JSON error instead of seeing a socket reset.
      req.resume();
      fail(res, error);
    });
  });
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(port, host, resolveListen);
  });
  const address = server.address();
  const url = `http://${host}:${address.port}`;

  async function close() {
    if (!server.listening) return;
    await new Promise((resolveClose) => {
      server.close(resolveClose);
      server.closeAllConnections?.();
    });
  }

  async function stop() {
    lifecycle.abort();
    const activeId = state.active;
    state.queue.length = 0;
    if (activeId)
      await updateJob(root, activeId, {
        stage: "failed",
        error: {
          code: "server_stopped",
          message: "Server demo berhenti sebelum pemrosesan selesai.",
        },
      }).catch(() => {});
    await close();
  }

  return { server, url, close, stop };
}

async function main() {
  const args = process.argv.slice(2);
  const flag = (name) => args.includes(name);
  const value = (name, fallback) => {
    const index = args.indexOf(name);
    return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
  };
  if (flag("--fake")) process.env.SCAN_PIPELINE = "fake";
  const port = Number(value("--port", process.env.SCAN_PORT ?? 8787));
  const host = value("--host", process.env.SCAN_HOST ?? "127.0.0.1");
  const root = resolve(process.env.SCAN_ROOT ?? join(repoRoot, "var/scans"));
  const distDir = resolve(process.env.SCAN_DIST ?? join(repoRoot, "dist"));
  const apiOnly = flag("--api-only");
  if (!apiOnly && !existsSync(join(distDir, "index.html"))) {
    console.error("Situs belum dibangun. Jalankan npm run build dulu.");
    process.exit(1);
  }
  await mkdir(root, { recursive: true });
  const { url, stop } = await createScanServer({
    root,
    distDir,
    port,
    host,
    staticEnabled: !apiOnly,
    keep: Number(process.env.SCAN_KEEP ?? SCAN_KEEP),
  });
  console.log(`Scan API on ${url}`);
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, async () => {
      await stop();
      process.exit(0);
    });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
