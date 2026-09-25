import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { isRetryableSupabaseRead, withSupabaseReadRetry } from "../src/lib/supabase/read-retry.ts";

const REST = "https://example.supabase.co/rest/v1/lectures?select=*";

// A response whose headers arrived but whose body dies on the way, which is how
// undici reports a socket reset mid-response.
function resetMidBody() {
  return new Response(new ReadableStream({
    pull(controller) {
      controller.error(new TypeError("terminated", { cause: new Error("read ECONNRESET") }));
    },
  }), { status: 200 });
}

function scripted(...steps) {
  const calls = [];
  const fetchImpl = async (input, init) => {
    calls.push({ input, init });
    const step = steps[Math.min(calls.length - 1, steps.length - 1)];
    if (step instanceof Error) throw step;
    return step();
  };
  return { fetchImpl, calls };
}

test("a read reset mid-body is tried once more and returns the second answer", async () => {
  const { fetchImpl, calls } = scripted(resetMidBody, () => Response.json([{ id: 1 }]));
  const response = await withSupabaseReadRetry(fetchImpl)(REST, { method: "GET" });
  assert.equal(calls.length, 2);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), [{ id: 1 }]);
});

test("a read that fails before any response is tried once more", async () => {
  const { fetchImpl, calls } = scripted(new TypeError("fetch failed"), () => Response.json([]));
  const response = await withSupabaseReadRetry(fetchImpl)(REST);
  assert.equal(calls.length, 2);
  assert.deepEqual(await response.json(), []);
});

test("a read that fails twice gives up with the second error", async () => {
  const { fetchImpl, calls } = scripted(new TypeError("fetch failed"), new TypeError("terminated"));
  await assert.rejects(withSupabaseReadRetry(fetchImpl)(REST), /terminated/);
  assert.equal(calls.length, 2);
});

test("a write is never repeated, even on a transport failure", async () => {
  for (const method of ["POST", "PATCH", "DELETE", "PUT"]) {
    const { fetchImpl, calls } = scripted(new TypeError("fetch failed"), () => Response.json({}));
    await assert.rejects(withSupabaseReadRetry(fetchImpl)(REST, { method, body: "{}" }), /fetch failed/);
    assert.equal(calls.length, 1, method);
  }
});

test("auth and storage calls pass through untouched", async () => {
  for (const url of [
    "https://example.supabase.co/auth/v1/user",
    "https://example.supabase.co/storage/v1/object/lectures/a.m4a",
  ]) {
    const { fetchImpl, calls } = scripted(new TypeError("fetch failed"));
    await assert.rejects(withSupabaseReadRetry(fetchImpl)(url), /fetch failed/);
    assert.equal(calls.length, 1, url);
  }
});

test("an abort is the caller giving up and is not retried", async () => {
  const controller = new AbortController();
  controller.abort();
  const { fetchImpl, calls } = scripted(new TypeError("fetch failed"));
  await assert.rejects(withSupabaseReadRetry(fetchImpl)(REST, { signal: controller.signal }));
  assert.equal(calls.length, 1);

  const abortError = new DOMException("aborted", "AbortError");
  const second = scripted(abortError);
  await assert.rejects(withSupabaseReadRetry(second.fetchImpl)(REST), /aborted/);
  assert.equal(second.calls.length, 1);
});

test("status, headers and bodiless answers survive the buffering", async () => {
  const { fetchImpl } = scripted(() => new Response("[]", {
    status: 206, statusText: "Partial Content", headers: { "content-range": "0-0/5" },
  }));
  const partial = await withSupabaseReadRetry(fetchImpl)(REST);
  assert.equal(partial.status, 206);
  assert.equal(partial.statusText, "Partial Content");
  assert.equal(partial.headers.get("content-range"), "0-0/5");
  assert.equal(await partial.text(), "[]");

  const empty = await withSupabaseReadRetry(scripted(() => new Response(null, { status: 204 })).fetchImpl)(REST);
  assert.equal(empty.status, 204);

  const head = await withSupabaseReadRetry(scripted(() => new Response(null, {
    status: 200, headers: { "content-range": "*/12" },
  })).fetchImpl)(REST, { method: "HEAD" });
  assert.equal(head.headers.get("content-range"), "*/12");
});

test("a Request object is classified by its own method", () => {
  assert.equal(isRetryableSupabaseRead(new Request(REST)), true);
  assert.equal(isRetryableSupabaseRead(new Request(REST, { method: "PATCH", body: "{}" })), false);
  assert.equal(isRetryableSupabaseRead(new URL(REST)), true);
  assert.equal(isRetryableSupabaseRead("/rest/v1/relative"), false);
});

test("every server-side Supabase client reads through the retry", () => {
  const source = readFileSync(new URL("../src/lib/supabase/server.ts", import.meta.url), "utf8");
  assert.equal(source.match(/global: \{ fetch: withSupabaseReadRetry\(\) \}/g)?.length, 3);
});
