import assert from "node:assert/strict";
import test from "node:test";

import { isReadableLinkContentType } from "../src/lib/link-source-validation.ts";

test("ordinary pages are readable whatever flavour of markup the server declares", () => {
  for (const type of [
    "text/html; charset=utf-8",
    "text/plain",
    "text/markdown",
    "application/xhtml+xml",
    "application/xml",
    "image/svg+xml",
    "application/json",
    "application/ld+json",
    "",
  ]) {
    assert.equal(isReadableLinkContentType(type), true, type);
  }
});

test("binary is still refused, because there is no text in it to find", () => {
  for (const type of [
    "video/mp4",
    "audio/mpeg",
    "image/png",
    "application/zip",
    "application/octet-stream",
  ]) {
    assert.equal(isReadableLinkContentType(type), false, type);
  }
});
