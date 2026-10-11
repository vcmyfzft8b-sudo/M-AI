import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * iOS Safari's data detectors rewrite the document before React hydrates: a digit
 * run it takes for a phone number is wrapped in `<a href="tel:…">`. The creator
 * join link (`/ugc/join/<token>`) renders the terms, which name the company's
 * ten-digit registration number, and every iPhone that opened one reported React
 * #418 (Sentry MEMOAI-WEB-7, replays showed the injected `tel:` anchor). The
 * `format-detection` meta in the root layout turns the detectors off for the site.
 */

const read = (relative) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

test("the root layout turns off iOS phone, address and email detection", () => {
  const layout = read("../src/app/layout.tsx");
  const block = layout.match(/formatDetection:\s*\{([^}]*)\}/);

  assert.ok(block, "generateMetadata must set formatDetection");
  assert.match(block[1], /telephone:\s*false/);
  assert.match(block[1], /address:\s*false/);
  assert.match(block[1], /email:\s*false/);
});

test("the creator terms still carry a digit run Safari would link", () => {
  // If this ever stops holding, the meta above is still right: help and billing
  // copy carry the same number.
  const terms = read("../src/lib/ugc/creator-terms-text.ts");

  assert.match(terms, /\b\d{10}\b/);
});
