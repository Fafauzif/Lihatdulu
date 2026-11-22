import { openAsBlob } from "node:fs";
import { KiriError, redact } from "./kiri-errors.mjs";
import { downloadToFile } from "./kiri-artifact.mjs";

// Small KIRI Engine adapter, following https://docs.kiriengine.app/:
//   POST /v1/open/3dgs/video          multipart: videoFile, isMesh, isMask
//   GET  /v1/open/model/getStatus     ?serialize=
//   GET  /v1/open/model/getModelZip   ?serialize=
// Only the server holds the API key; the browser never sees this module.

export const KIRI_STATUS = Object.freeze({
  UPLOADING: -1,
  PROCESSING: 0,
  FAILED: 1,
  SUCCESSFUL: 2,
  QUEUING: 3,
  EXPIRED: 4,
});

const STATE_BY_STATUS = Object.freeze({
  [-1]: "uploading",
  0: "processing",
  1: "failed",
  2: "successful",
  3: "queuing",
  4: "expired",
});

export function kiriState(status) {
  return STATE_BY_STATUS[status] ?? "unknown";
}

const SERIAL = /^[A-Za-z0-9_-]{8,64}$/;
const STATUS_BY_HTTP = {
  401: "kiri_unauthorized",
  403: "kiri_no_credit",
  404: "kiri_unavailable",
  429: "kiri_rate_limited",
};

function assertSerial(serial) {
  if (typeof serial !== "string" || !SERIAL.test(serial))
    throw new KiriError("kiri_unavailable", { detail: "Serial KIRI tidak valid." });
  return serial;
}

export function createKiriClient({
  apiKey,
  baseUrl = "https://api.kiriengine.app/api",
  fetchImpl = fetch,
  requestTimeoutMs = 120_000,
  downloadTimeoutMs = 20 * 60 * 1000,
} = {}) {
  if (!apiKey) throw new KiriError("missing_key");

  async function request(path, { method = "GET", body, headers = {}, timeoutMs = requestTimeoutMs } = {}) {
    const url = `${String(baseUrl).replace(/\/+$/, "")}${path}`;
    let response;
    try {
      response = await fetchImpl(url, {
        method,
        body,
        headers: { authorization: `Bearer ${apiKey}`, ...headers },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
      throw new KiriError(timedOut ? "kiri_unavailable" : "kiri_network", {
        cause: error,
        detail: redact(error?.message ?? "fetch gagal"),
      });
    }
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (!response.ok) {
      const code = STATUS_BY_HTTP[response.status] ?? "kiri_unavailable";
      const upstream = Number(payload?.code);
      const mapped =
        code === "kiri_unavailable" && upstream === 401
          ? "kiri_unauthorized"
          : code;
      throw new KiriError(mapped, {
        detail: redact(
          `HTTP ${response.status} ${payload?.msg ?? ""}`.trim().slice(0, 200),
        ),
      });
    }
    if (payload && payload.code !== 0 && payload.code !== undefined)
      throw new KiriError("kiri_unavailable", {
        detail: redact(`kode ${payload.code}: ${payload.msg ?? ""}`.slice(0, 200)),
      });
    return payload ?? {};
  }

  async function videoBlob(filePath) {
    if (typeof openAsBlob === "function") {
      try {
        return await openAsBlob(filePath);
      } catch {
        // fall through to a buffered read
      }
    }
    const { readFile } = await import("node:fs/promises");
    return new Blob([await readFile(filePath)]);
  }

  const client = {
    provider: "kiri",
    async submitVideo({ filePath, filename = "video.mp4" } = {}) {
      const form = new FormData();
      form.append("isMesh", "0");
      form.append("isMask", "1");
      form.append("videoFile", await videoBlob(filePath), filename);
      const payload = await request("/v1/open/3dgs/video", {
        method: "POST",
        body: form,
      });
      const serial = payload?.data?.serialize;
      if (typeof serial !== "string" || !SERIAL.test(serial))
        throw new KiriError("kiri_unavailable", {
          detail: "Respons unggah tanpa serial.",
        });
      return {
        serial,
        calculateType: Number(payload?.data?.calculateType ?? 0) || null,
      };
    },

    async getStatus(serial) {
      const payload = await request(
        `/v1/open/model/getStatus?serialize=${encodeURIComponent(assertSerial(serial))}`,
      );
      const status = Number(payload?.data?.status);
      if (!Number.isInteger(status))
        throw new KiriError("kiri_unavailable", {
          detail: "Status KIRI tidak terbaca.",
        });
      return { status, state: kiriState(status) };
    },

    async getModelZip(serial) {
      const payload = await request(
        `/v1/open/model/getModelZip?serialize=${encodeURIComponent(assertSerial(serial))}`,
        { timeoutMs: 60_000 },
      );
      const modelUrl = payload?.data?.modelUrl;
      let parsed;
      try {
        parsed = new URL(String(modelUrl));
      } catch {
        parsed = null;
      }
      if (!parsed || !["http:", "https:"].includes(parsed.protocol))
        throw new KiriError("kiri_unavailable", {
          detail: "Tautan unduhan KIRI tidak valid.",
        });
      return { modelUrl: parsed.toString() };
    },

    // One call for the two KIRI steps the pipeline needs: ask for the ZIP link,
    // then stream it to disk with a size ceiling.
    async downloadZip(serial, destination, { maxBytes = 300 * 1024 * 1024 } = {}) {
      const { modelUrl } = await client.getModelZip(serial);
      const { bytes } = await downloadToFile(modelUrl, destination, {
        maxBytes,
        timeoutMs: downloadTimeoutMs,
        fetchImpl,
      });
      return { bytes, modelUrl };
    },
  };
  return client;
}
