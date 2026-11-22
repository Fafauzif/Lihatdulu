import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createKiriClient, kiriState } from "../server/kiri-client.mjs";

async function tempVideo(t, bytes = 256) {
  const dir = await mkdtemp(join(tmpdir(), "lihatdulu-kiri-client-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, "kursi.mp4");
  await writeFile(file, Buffer.alloc(bytes, 7));
  return file;
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("submitVideo sends the 3DGS form with automatic masking", async (t) => {
  const file = await tempVideo(t);
  let seen;
  const client = createKiriClient({
    apiKey: "kiri-secret",
    fetchImpl: async (url, options) => {
      seen = { url, options };
      return jsonResponse({ code: 0, msg: "success", data: { serialize: "abc123def456", calculateType: 3 }, ok: true });
    },
  });
  const result = await client.submitVideo({ filePath: file, filename: "kursi.mp4" });
  assert.equal(result.serial, "abc123def456");
  assert.equal(result.calculateType, 3);
  assert.match(seen.url, /\/v1\/open\/3dgs\/video$/);
  assert.equal(seen.options.method, "POST");
  assert.equal(seen.options.headers.authorization, "Bearer kiri-secret");
  assert.equal(seen.options.body.get("isMask"), "1");
  assert.equal(seen.options.body.get("isMesh"), "0");
  const upload = seen.options.body.get("videoFile");
  assert.equal(upload.name, "kursi.mp4");
  assert.equal(typeof upload.arrayBuffer, "function");
});

test("submitImages sends every still to the 3DGS photo endpoint", async (t) => {
  const first = await tempVideo(t);
  const second = await tempVideo(t);
  let seen;
  const client = createKiriClient({
    apiKey: "kiri-secret",
    fetchImpl: async (url, options) => {
      seen = { url, options };
      return jsonResponse({ code: 0, msg: "success", data: { serialize: "photo12345678", calculateType: 3 }, ok: true });
    },
  });
  const result = await client.submitImages({
    files: [
      { path: first, filename: "0001.jpg" },
      { path: second, filename: "0002.jpg" },
    ],
    mask: 0,
  });
  assert.equal(result.serial, "photo12345678");
  assert.equal(result.calculateType, 3);
  assert.match(seen.url, /\/v1\/open\/3dgs\/image$/);
  assert.equal(seen.options.method, "POST");
  assert.equal(seen.options.headers.authorization, "Bearer kiri-secret");
  assert.equal(seen.options.body.get("isMesh"), "0");
  assert.equal(seen.options.body.get("isMask"), "0");
  const uploads = seen.options.body.getAll("imagesFiles");
  assert.equal(uploads.length, 2);
  assert.deepEqual(
    uploads.map((file) => file.name),
    ["0001.jpg", "0002.jpg"],
  );
});

test("submitImages refuses an empty photo set without calling KIRI", async () => {
  const client = createKiriClient({
    apiKey: "k",
    fetchImpl: async () => {
      throw new Error("must not fetch");
    },
  });
  await assert.rejects(client.submitImages({ files: [] }), (error) => {
    assert.equal(error.code, "kiri_unavailable");
    assert.equal(error.detail, "Foto kosong.");
    return true;
  });
});

test("getStatus maps every documented KIRI status", async () => {
  const states = [];
  for (const status of [-1, 0, 1, 2, 3, 4]) {
    const client = createKiriClient({
      apiKey: "k",
      fetchImpl: async () => jsonResponse({ code: 0, data: { status } }),
    });
    const result = await client.getStatus("abc123def456");
    states.push(result.state);
    assert.equal(result.status, status);
  }
  assert.deepEqual(states, [
    "uploading",
    "processing",
    "failed",
    "successful",
    "queuing",
    "expired",
  ]);
  assert.equal(kiriState(99), "unknown");
});

test("getStatus rejects a malformed serial before calling KIRI", async () => {
  const client = createKiriClient({
    apiKey: "k",
    fetchImpl: async () => {
      throw new Error("must not fetch");
    },
  });
  await assert.rejects(() => client.getStatus("../etc/passwd"), (error) => {
    assert.equal(error.code, "kiri_unavailable");
    return true;
  });
});

test("HTTP failures map to the operator-facing codes", async () => {
  for (const [status, code] of [
    [401, "kiri_unauthorized"],
    [403, "kiri_no_credit"],
    [429, "kiri_rate_limited"],
    [500, "kiri_unavailable"],
  ]) {
    const client = createKiriClient({
      apiKey: "secret-key",
      fetchImpl: async () => jsonResponse({ code: 1, msg: "upstream says no" }, status),
    });
    await assert.rejects(() => client.getStatus("abc123def456"), (error) => {
      assert.equal(error.code, code);
      assert.ok(!error.message.includes("secret-key"));
      assert.ok(!String(error.detail ?? "").includes("secret-key"));
      return true;
    });
  }
});

test("network failures are retryable and do not leak the key", async () => {
  const client = createKiriClient({
    apiKey: "secret-key",
    fetchImpl: async () => {
      throw new Error("connect ECONNREFUSED with Bearer secret-key");
    },
  });
  await assert.rejects(() => client.getModelZip("abc123def456"), (error) => {
    assert.equal(error.code, "kiri_network");
    assert.equal(error.retryable, true);
    assert.ok(!String(error.detail).includes("secret-key"));
    return true;
  });
});

test("getModelZip refuses a non-http download link", async () => {
  const client = createKiriClient({
    apiKey: "k",
    fetchImpl: async () =>
      jsonResponse({ code: 0, data: { modelUrl: "file:///C:/Windows/win.ini" } }),
  });
  await assert.rejects(() => client.getModelZip("abc123def456"), (error) => {
    assert.equal(error.code, "kiri_unavailable");
    return true;
  });
});

test("a non-zero API code becomes an upstream error", async () => {
  const client = createKiriClient({
    apiKey: "k",
    fetchImpl: async () => jsonResponse({ code: 40001, msg: "invalid video", ok: false }),
  });
  await assert.rejects(() => client.getStatus("abc123def456"), (error) => {
    assert.equal(error.code, "kiri_unavailable");
    return true;
  });
});

test("masking can be switched off per client and per call", async (t) => {
  const file = await tempVideo(t);
  const seen = [];
  const fetchImpl = async (_url, options) => {
    seen.push(options.body.get("isMask"));
    return jsonResponse({ code: 200, msg: "success", data: { serialize: "abc123def456" } });
  };
  const off = createKiriClient({ apiKey: "kiri-secret", fetchImpl, isMask: 0 });
  await off.submitVideo({ filePath: file });
  const on = createKiriClient({ apiKey: "kiri-secret", fetchImpl });
  await on.submitVideo({ filePath: file });
  await on.submitVideo({ filePath: file, mask: 0 });
  assert.deepEqual(seen, ["0", "1", "0"]);
});

test("submitVideo uses the long upload timeout, not the control timeout", async (t) => {
  const file = await tempVideo(t, 1024);
  const client = createKiriClient({
    apiKey: "k",
    requestTimeoutMs: 40,
    uploadTimeoutMs: 5_000,
    // A real 60 MB upload lasts far longer than 40 ms; this stands in for it.
    fetchImpl: async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
      return jsonResponse({ code: 0, msg: "success", data: { serialize: "abc123def456" } });
    },
  });
  const result = await client.submitVideo({ filePath: file, filename: "kursi.mp4" });
  assert.equal(result.serial, "abc123def456");
});

test("a successful upload that answers code 200 still yields its serial", async (t) => {
  const file = await tempVideo(t);
  const client = createKiriClient({
    apiKey: "k",
    // The live API answered exactly this for a real 61 MB 3DGS upload.
    fetchImpl: async () =>
      jsonResponse({ code: 200, msg: "success", data: { serialize: "live200serial1" }, ok: true }),
  });
  const result = await client.submitVideo({ filePath: file, filename: "kursi.mp4" });
  assert.equal(result.serial, "live200serial1");
});

test("code 200 with ok false is still a failure", async (t) => {
  const file = await tempVideo(t);
  const client = createKiriClient({
    apiKey: "k",
    fetchImpl: async () => jsonResponse({ code: 200, msg: "no credit", data: null, ok: false }),
  });
  await assert.rejects(() => client.submitVideo({ filePath: file }), (error) => {
    assert.equal(error.code, "kiri_unavailable");
    return true;
  });
});

test("getStatus accepts the same success codes as submit", async () => {
  for (const code of [0, 200]) {
    const client = createKiriClient({
      apiKey: "k",
      fetchImpl: async () => jsonResponse({ code, msg: "success", data: { status: 2 }, ok: true }),
    });
    const result = await client.getStatus("abc123def456");
    assert.equal(result.state, "successful");
  }
});
