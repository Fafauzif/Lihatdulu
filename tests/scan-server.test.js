import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { connect } from "node:net";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  MAX_UPLOAD_BYTES,
  createScanServer,
} from "../server/scan-server.mjs";
import { runFakePipeline } from "../server/scan-fake.mjs";

const clip = Buffer.from("fake-webm-body");
let root;
let distDir;
let url;
let close;
let id;

function request(path, { method = "GET", headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(`${url}${path}`, { method, headers }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () =>
        resolve({
          status: res.statusCode,
          headers: res.headers,
          text: Buffer.concat(chunks).toString("utf8"),
        }),
      );
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function upload(query, { type = "video/webm", length = clip.length, body = clip } = {}) {
  const headers = { "content-type": type };
  if (length !== null) headers["content-length"] = String(length);
  const res = await request(`/api/scans?${query}`, {
    method: "POST",
    headers,
    body,
  });
  let json = null;
  try {
    json = JSON.parse(res.text);
  } catch {}
  return { ...res, json };
}

function rawStatus(path, headers) {
  const port = Number(new URL(url).port);
  return new Promise((resolve, reject) => {
    const socket = connect(port, "127.0.0.1");
    let text = "";
    socket.setTimeout(2000);
    socket.on("connect", () => {
      const head = Object.entries(headers)
        .map(([key, value]) => `${key}: ${value}`)
        .join("\r\n");
      socket.write(
        `POST ${path} HTTP/1.1\r\nHost: 127.0.0.1\r\n${head}\r\nConnection: close\r\n\r\n`,
      );
    });
    socket.on("data", (chunk) => {
      text += chunk.toString("utf8");
    });
    socket.on("timeout", () => socket.destroy());
    socket.on("close", () => {
      const match = text.match(/^HTTP\/1\.1 (\d{3})/);
      if (match) resolve(Number(match[1]));
      else reject(new Error(`No status line in: ${text}`));
    });
    socket.on("error", reject);
  });
}

async function waitFor(idToWait, stage, attempts = 120) {
  for (let i = 0; i < attempts; i++) {
    const res = await request(`/api/scans/${idToWait}`);
    const dto = JSON.parse(res.text);
    if (dto.stage === stage) return dto;
    await delay(25);
  }
  throw new Error(`Timed out waiting for ${stage}`);
}

before(async () => {
  root = await mkdtemp(join(tmpdir(), "scan-api-"));
  distDir = await mkdtemp(join(tmpdir(), "scan-dist-"));
  await writeFile(join(distDir, "index.html"), '<!doctype html><div id="app"></div>');
  ({ url, close } = await createScanServer({
    root,
    pipeline: runFakePipeline,
    distDir,
  }));
});

after(async () => {
  await close();
  await rm(root, { recursive: true, force: true });
  await rm(distDir, { recursive: true, force: true });
});

test("creates a job, reports honest stages and serves the artifact", async () => {
  const created = await upload("title=Kursi&w=58&d=63&h=84");
  assert.equal(created.status, 201);
  id = created.json.id;
  const dto = await waitFor(id, "ready");
  assert.equal(dto.artifact.format, "ply");
  assert.equal(dto.artifact.splatCount, 64);
  assert.equal(dto.artifact.url, `/api/scans/${id}/result/scan.ply`);
  assert.equal(dto.artifact.stills.length, 3);
  const result = await request(dto.artifact.url);
  assert.equal(result.status, 200);
  assert.match(result.text, /^ply\r?\n/);
  const frame = await request(dto.artifact.stills[0]);
  assert.equal(frame.status, 200);
  assert.match(frame.headers["content-type"], /svg/);
  assert.equal(dto.meta.title, "Kursi");
  assert.equal(dto.media.durationS, 12.3);
  assert.equal(dto.provenance.frames.registered, 78);
});

test("rejects a non-video content type", async () => {
  assert.equal((await upload("title=Kursi&w=58&d=63&h=84", { type: "text/html", length: 10 })).status, 415);
});

test("rejects an upload without a content length", async () => {
  assert.equal((await upload("title=Kursi&w=58&d=63&h=84", { length: null })).status, 411);
});

test("rejects a declared body over the cap before reading it", async () => {
  const status = await rawStatus("/api/scans?title=Kursi&w=58&d=63&h=84", {
    "content-type": "video/webm",
    "content-length": String(MAX_UPLOAD_BYTES + 1),
  });
  assert.equal(status, 413);
});

test("rejects bad metadata", async () => {
  assert.equal((await upload("title=&w=58&d=63&h=84")).status, 400);
});

test("never serves the source clip and never lists jobs", async () => {
  assert.equal((await request("/api/scans")).status, 404);
  assert.equal((await request(`/api/scans/${id}/clip`)).status, 404);
  assert.equal((await request("/api/scans/not-a-uuid")).status, 404);
});

test("result and frames are 409 until ready", async () => {
  const pendingRoot = await mkdtemp(join(tmpdir(), "scan-pending-"));
  const pending = await createScanServer({
    root: pendingRoot,
    pipeline: () => new Promise(() => {}),
    distDir,
  });
  const res = await new Promise((resolve, reject) => {
    const req = httpRequest(
      `${pending.url}/api/scans?title=Kursi&w=58&d=63&h=84`,
      {
        method: "POST",
        headers: {
          "content-type": "video/webm",
          "content-length": String(clip.length),
        },
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            status: response.statusCode,
            text: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    req.on("error", reject);
    req.write(clip);
    req.end();
  });
  assert.equal(res.status, 201);
  const pendingId = JSON.parse(res.text).id;
  await delay(20);
  const result = await new Promise((resolve, reject) => {
    httpRequest(
      `${pending.url}/api/scans/${pendingId}/result/scan.ply`,
      (response) => {
        response.resume();
        response.on("end", () => resolve(response.statusCode));
      },
    ).on("error", reject).end();
  });
  assert.equal(result, 409);
  await pending.close();
  await rm(pendingRoot, { recursive: true, force: true });
});

test("SPA fallback serves index.html and /api stays JSON", async () => {
  const page = await request("/beli");
  assert.equal(page.status, 200);
  assert.match(page.text, /<div id="app">/);
  const missingAsset = await request("/missing.js");
  assert.equal(missingAsset.status, 404);
  const api = await request("/api/nope");
  assert.equal(api.status, 404);
  assert.match(api.headers["content-type"], /application\/json/);
});

test("traversal ids and encoded paths never escape root", async () => {
  assert.equal((await request("/..%2fpackage.json")).status, 404);
  assert.equal(
    (await request("/api/scans/%2e%2e%2f%2e%2e%2fpackage.json")).status,
    404,
  );
  assert.equal(
    (await request("/api/scans/..%2F..%2Fpackage.json")).status,
    404,
  );
});

test("duplicate clientId returns the same job without creating a second one", async () => {
  const cid = "6f1c2b7e-8a4d-4c3e-9f10-2b3c4d5e6f70";
  const query = `title=Kursi&w=58&d=63&h=84&cid=${cid}`;
  const first = await upload(query);
  const second = await upload(query);
  assert.equal(first.status, 201);
  assert.equal(second.status, 200);
  assert.equal(second.json.id, first.json.id);
});

test("queue full is rejected with 429", async () => {
  const queueRoot = await mkdtemp(join(tmpdir(), "scan-queue-"));
  const slow = await createScanServer({
    root: queueRoot,
    pipeline: () => new Promise(() => {}),
    distDir,
  });
  const send = () =>
    new Promise((resolve, reject) => {
      const req = httpRequest(
        `${slow.url}/api/scans?title=Kursi&w=58&d=63&h=84`,
        {
          method: "POST",
          headers: {
            "content-type": "video/webm",
            "content-length": String(clip.length),
          },
        },
        (response) => {
          response.resume();
          response.on("end", () => resolve(response.statusCode));
        },
      );
      req.on("error", reject);
      req.write(clip);
      req.end();
    });
  for (let i = 0; i < 4; i++) {
    assert.equal(await send(), 201);
    await delay(10);
  }
  assert.equal(await send(), 429);
  await slow.close();
  await rm(queueRoot, { recursive: true, force: true });
});
