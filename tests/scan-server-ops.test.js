import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createJob, listJobs, readJob, updateJob, writeJob } from "../server/scan-jobs.mjs";
import { createScanServer } from "../server/scan-server.mjs";
import { runFakePipeline } from "../server/scan-fake.mjs";
import { ScanError } from "../server/scan-errors.mjs";

const repo = fileURLToPath(new URL("../", import.meta.url));
const meta = {
  title: "Kursi",
  widthCm: 58,
  depthCm: 63,
  heightCm: 84,
  conditionNote: "",
  device: "",
  clientId: "",
};

function cli(args, env = {}) {
  const child = spawn(process.execPath, [join(repo, "server/scan-server.mjs"), ...args], {
    cwd: repo,
    env: { ...process.env, ...env },
  });
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  return { child, output: () => output };
}

async function waitForServer(url, attempts = 80) {
  for (let index = 0; index < attempts; index++) {
    try {
      return await fetch(`${url}/api/nope`);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error(`server did not start at ${url}`);
}

async function upload(base, title = "Kursi") {
  const response = await fetch(
    `${base}/api/scans?title=${encodeURIComponent(title)}&w=58&d=63&h=84`,
    {
      method: "POST",
      headers: { "content-type": "video/webm" },
      body: Buffer.from("clip"),
    },
  );
  return (await response.json()).id;
}

test("serve mode exits 1 with a build hint when dist is missing", async () => {
  const empty = await mkdtemp(join(tmpdir(), "scan-empty-dist-"));
  const { child, output } = cli(["--port", "8790"], { SCAN_DIST: empty });
  const [code] = await once(child, "exit");
  assert.equal(code, 1);
  assert.match(output(), /npm run build/);
  await rm(empty, { recursive: true, force: true });
});

test("api-only starts without dist", async () => {
  const root = await mkdtemp(join(tmpdir(), "scan-api-only-"));
  const { child } = cli(
    ["--api-only", "--fake", "--port", "8791"],
    { SCAN_ROOT: root },
  );
  const response = await waitForServer("http://127.0.0.1:8791");
  assert.match(response.headers.get("content-type"), /application\/json/);
  child.kill();
  await once(child, "exit");
  await rm(root, { recursive: true, force: true });
});

test("a tool_missing job fails without crashing the server", async () => {
  const root = await mkdtemp(join(tmpdir(), "scan-tool-missing-"));
  const { url, close } = await createScanServer({
    root,
    pipeline: async () => {
      throw new ScanError("tool_missing", "Pasang Brush.");
    },
  });
  const id = await upload(url);
  for (let index = 0; index < 100; index++) {
    const dto = await (await fetch(`${url}/api/scans/${id}`)).json();
    if (dto.stage === "failed") {
      assert.equal(dto.error.code, "tool_missing");
      assert.equal((await fetch(`${url}/api/nope`)).status, 404);
      await close();
      await rm(root, { recursive: true, force: true });
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  await close();
  throw new Error("job did not fail");
});

test("startup marks a stranded job failed with server_stopped", async () => {
  const root = await mkdtemp(join(tmpdir(), "scan-stranded-"));
  const job = await createJob(root, meta);
  await updateJob(root, job.id, { stage: "aligning" });
  const { close } = await createScanServer({ root, pipeline: runFakePipeline });
  assert.equal((await readJob(root, job.id)).error.code, "server_stopped");
  await close();
  await rm(root, { recursive: true, force: true });
});

test("startup prunes finished jobs to SCAN_KEEP", async () => {
  const root = await mkdtemp(join(tmpdir(), "scan-prune-"));
  for (let index = 0; index < 2; index++) {
    const job = await createJob(root, meta);
    await writeJob(root, { ...job, stage: "ready" });
  }
  process.env.SCAN_KEEP = "1";
  const { close } = await createScanServer({ root, pipeline: runFakePipeline });
  delete process.env.SCAN_KEEP;
  assert.equal((await listJobs(root)).length, 1);
  await close();
  await rm(root, { recursive: true, force: true });
});

test("stop() marks the active job failed and closes the server", async () => {
  const root = await mkdtemp(join(tmpdir(), "scan-stop-"));
  const { url, stop } = await createScanServer({
    root,
    pipeline: () => new Promise(() => {}),
  });
  const id = await upload(url, "Kursi Stop");
  await new Promise((resolve) => setTimeout(resolve, 150));
  await stop();
  assert.equal((await readJob(root, id)).error.code, "server_stopped");
  await assert.rejects(() => fetch(`${url}/api/nope`));
  await rm(root, { recursive: true, force: true });
});
