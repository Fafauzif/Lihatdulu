import test from "node:test";
import assert from "node:assert/strict";
import { getJob, getScanConfig } from "../src/scan-api.js";

// The public demo runs on static hosting, so /api/... is rewritten to the app
// shell. That answer is not a broken job: it means this origin has no scanner.
// The result page must say so at once instead of polling into a spinner.

function withFetch(response, run) {
  const original = globalThis.fetch;
  globalThis.fetch = async () => response;
  return run().finally(() => {
    globalThis.fetch = original;
  });
}

const html = () =>
  new Response("<!doctype html><title>LihatDulu</title>", {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });

test("an HTML answer from /api is reported as unavailable, not as a job", async () => {
  await withFetch(html(), async () => {
    await assert.rejects(getJob("8f1c3b9e-0000-4000-8000-00000000dead"), (error) => {
      assert.equal(error.code, "unavailable");
      assert.match(error.message, /contoh tersimpan/i);
      return true;
    });
  });
});

test("the scan config reports the same static-host state", async () => {
  await withFetch(html(), async () => {
    await assert.rejects(getScanConfig(), (error) => {
      assert.equal(error.code, "unavailable");
      return true;
    });
  });
});

test("a JSON job still reads normally", async () => {
  const body = JSON.stringify({ id: "abc", stage: "ready" });
  const response = new Response(body, {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
  await withFetch(response, async () => {
    const job = await getJob("abc");
    assert.equal(job.stage, "ready");
  });
});

test("a real 404 keeps its not_found code", async () => {
  const response = new Response(JSON.stringify({ error: { code: "not_found" } }), {
    status: 404,
    headers: { "content-type": "application/json" },
  });
  await withFetch(response, async () => {
    await assert.rejects(getJob("abc"), (error) => {
      assert.equal(error.code, "not_found");
      return true;
    });
  });
});

test("the deployed host answers /api with a plain 404, which is also unavailable", async () => {
  const response = new Response("Not Found", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
  await withFetch(response, async () => {
    await assert.rejects(getJob("8f1c3b9e-0000-4000-8000-00000000dead"), (error) => {
      assert.equal(error.code, "unavailable");
      assert.equal(error.status, 404);
      return true;
    });
  });
});
