import assert from "node:assert/strict";
import test from "node:test";

import { StorageApiError } from "@supabase/storage-js";

import {
  isTransientStorageDownloadError,
  retryTransientStorageOperation,
} from "../src/lib/storage-download-errors.ts";

test("retries the real StorageApiError Supabase returns for a read-after-write miss", () => {
  // storage-api answers a not-yet-visible object with HTTP 400 and a "404" body code on
  // older deployments, and with a plain HTTP 404 on newer ones. Build both through the
  // library's own error class so the shape stays honest if supabase-js changes it.
  assert.equal(
    isTransientStorageDownloadError(new StorageApiError("Object not found", 400, "404")),
    true,
  );
  assert.equal(
    isTransientStorageDownloadError(new StorageApiError("Object not found", 404, "404")),
    true,
  );
});

test("retries missing-object responses regardless of casing or wording variant", () => {
  assert.equal(
    isTransientStorageDownloadError({ status: 400, message: "Object not found" }),
    true,
  );
  assert.equal(
    isTransientStorageDownloadError({ statusCode: "404", message: "object not found" }),
    true,
  );
  assert.equal(
    isTransientStorageDownloadError({ status: 404, message: "The resource was not found" }),
    true,
  );
});

test("does not retry unrelated client errors", () => {
  assert.equal(
    isTransientStorageDownloadError({ status: 400, message: "Invalid object path" }),
    false,
  );
  assert.equal(
    isTransientStorageDownloadError({ status: 404, message: "Bucket not found" }),
    false,
  );
  assert.equal(
    isTransientStorageDownloadError(new StorageApiError("Invalid JWT", 401, "401")),
    false,
  );
  assert.equal(
    isTransientStorageDownloadError(new StorageApiError("new row violates row-level security policy", 403, "403")),
    false,
  );
});

test("a status the service returned wins over the message fragments", () => {
  // Guards the pre-existing contract: once storage answers with a non-retryable status,
  // an incidental word in the message must not turn the failure into a retry.
  assert.equal(
    isTransientStorageDownloadError({ status: 403, message: "Connection not permitted" }),
    false,
  );
  assert.equal(
    isTransientStorageDownloadError({ status: 401, message: "network policy denied" }),
    false,
  );
});

test("retains retries for network and server failures", () => {
  assert.equal(isTransientStorageDownloadError({ status: 503, message: "Unavailable" }), true);
  assert.equal(isTransientStorageDownloadError({ status: 429, message: "Too many requests" }), true);
  assert.equal(isTransientStorageDownloadError({ status: 408, message: "Request timeout" }), true);
  // A transport failure never reaches storage, so it carries no status at all.
  assert.equal(isTransientStorageDownloadError({ message: "fetch failed" }), true);
  assert.equal(isTransientStorageDownloadError(new TypeError("fetch failed")), true);
});

test("tolerates junk without throwing", () => {
  assert.equal(isTransientStorageDownloadError(null), false);
  assert.equal(isTransientStorageDownloadError(undefined), false);
  assert.equal(isTransientStorageDownloadError("Object not found"), false);
  assert.equal(isTransientStorageDownloadError([]), false);
  assert.equal(isTransientStorageDownloadError({ status: "not-a-number", message: "" }), false);
});

test("classifies the bare 520 Supabase Storage answered the read-aloud route with", () => {
  // The production failure carried no message at all: `Error [StorageApiError]:` with
  // `status: 520, statusCode: "520"`. Classification has to come off the status alone.
  assert.equal(isTransientStorageDownloadError(new StorageApiError("", 520, "520")), true);
  assert.equal(
    isTransientStorageDownloadError({ __isStorageError: true, status: 520, statusCode: "520" }),
    true,
  );
});

test("retries a transient storage operation until it succeeds", async () => {
  const attempts = [];
  const result = await retryTransientStorageOperation(async () => {
    attempts.push(attempts.length);

    return attempts.length < 3
      ? { data: null, error: new StorageApiError("", 520, "520") }
      : { data: { signedUrl: "https://example.test/audio.mp3" }, error: null };
  }, [0, 0]);

  assert.equal(attempts.length, 3);
  assert.equal(result.error, null);
  assert.equal(result.data.signedUrl, "https://example.test/audio.mp3");
});

test("gives up on a transient failure once the delays run out, keeping the last error", async () => {
  let calls = 0;
  const result = await retryTransientStorageOperation(async () => {
    calls += 1;

    return { data: null, error: new StorageApiError("", 520, "520") };
  }, [0, 0]);

  // Two delays means three attempts, and the caller still gets the failure to throw.
  assert.equal(calls, 3);
  assert.equal(result.error.status, 520);
});

test("does not repeat an operation that failed for a non-transient reason", async () => {
  let calls = 0;
  const result = await retryTransientStorageOperation(async () => {
    calls += 1;

    return { data: null, error: new StorageApiError("Bucket not found", 404, "404") };
  }, [0, 0]);

  assert.equal(calls, 1);
  assert.equal(result.error.message, "Bucket not found");
});

test("does not repeat an operation that succeeded", async () => {
  let calls = 0;
  const result = await retryTransientStorageOperation(async () => {
    calls += 1;

    return { data: { path: "audio.mp3" }, error: null };
  }, [0, 0]);

  assert.equal(calls, 1);
  assert.equal(result.data.path, "audio.mp3");
});
