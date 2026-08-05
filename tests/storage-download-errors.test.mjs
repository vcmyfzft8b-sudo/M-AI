import assert from "node:assert/strict";
import test from "node:test";

import { StorageApiError } from "@supabase/storage-js";

import { isTransientStorageDownloadError } from "../src/lib/storage-download-errors.ts";

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
