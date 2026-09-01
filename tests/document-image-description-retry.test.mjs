import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const SOURCE = readFileSync(
  new URL("../src/lib/document-image-extraction.ts", import.meta.url),
  "utf8",
);
const START = SOURCE.indexOf("async function describeDocumentImage");
const END = SOURCE.indexOf("async function extractDocxImages", START);
const DESCRIPTION_SOURCE = SOURCE.slice(START, END);

test("an optional document-image description retries one transient provider failure", () => {
  assert.ok(START > 0 && END > START, "describeDocumentImage must remain discoverable");
  assert.match(
    DESCRIPTION_SOURCE,
    /maxAttempts:\s*IMAGE_DESCRIPTION_MAX_ATTEMPTS/,
  );
  assert.match(SOURCE, /const IMAGE_DESCRIPTION_MAX_ATTEMPTS = 2;/);
});

test("an exhausted transient outage degrades without opening a Sentry defect", () => {
  const transientGuard = DESCRIPTION_SOURCE.indexOf("if (isRetryableAiError(error))");
  const transientFallback = DESCRIPTION_SOURCE.indexOf("return undefined", transientGuard);
  const unexpectedCapture = DESCRIPTION_SOURCE.indexOf("captureBackgroundError(error", transientGuard);

  assert.ok(transientGuard > 0, "transient provider failures must be classified");
  assert.ok(
    transientFallback > transientGuard && transientFallback < unexpectedCapture,
    "transient failures must take the image fallback before Sentry capture",
  );
  assert.ok(
    unexpectedCapture > transientGuard,
    "unexpected image-description failures must stay visible in Sentry",
  );
});
