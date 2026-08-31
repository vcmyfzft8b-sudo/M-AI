import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  SPLASH_DEVICES,
  SPLASH_THEMES,
  splashScreens,
} from "../src/lib/splash-screens.ts";

/**
 * The launch screen has no runtime and no error path: iOS reads the <link>
 * tags, fetches whatever they point at, and silently falls back to a blank
 * canvas when a file is missing or the wrong size. A broken splash therefore
 * looks exactly like the bug it was added to fix, and looks it only on a real
 * phone. These assertions are the only thing standing between an edit to the
 * device matrix and shipping the black screen back.
 */

function publicFile(relativePath) {
  return fileURLToPath(new URL(`../public/${relativePath}`, import.meta.url));
}

/** The PNG header carries the image's true dimensions in bytes 16..24. */
function pngSize(absolutePath) {
  const header = readFileSync(absolutePath).subarray(16, 24);
  return { width: header.readUInt32BE(0), height: header.readUInt32BE(4) };
}

test("every declared launch screen exists on disk at the size it claims", () => {
  const screens = splashScreens();
  assert.ok(screens.length > 0, "the device matrix is empty");

  for (const screen of screens) {
    const file = publicFile(screen.file);
    assert.ok(
      existsSync(file),
      `${screen.file} is declared but missing — run node --experimental-strip-types scripts/generate-splash-screens.mjs`,
    );

    // iOS ignores a startup image whose pixels do not match the device exactly,
    // so a stale file is as bad as no file.
    const { width, height } = pngSize(file);
    assert.equal(width, screen.pixelWidth, `${screen.file} is ${width}px wide`);
    assert.equal(height, screen.pixelHeight, `${screen.file} is ${height}px tall`);
    assert.ok(statSync(file).size > 0, `${screen.file} is empty`);
  }
});

test("the home-screen icons the manifest names exist", () => {
  for (const icon of ["icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png"]) {
    assert.ok(existsSync(publicFile(icon)), `${icon} is missing`);
  }
});

test("no two devices claim the same media query", () => {
  const screens = splashScreens();
  const byMedia = new Set(screens.map((screen) => screen.media));

  // One portrait link plus the two landscape spellings, per colour scheme.
  assert.equal(
    screens.length,
    SPLASH_DEVICES.length * 3 * SPLASH_THEMES.length,
    "a device is missing a link",
  );
  assert.equal(
    byMedia.size,
    screens.length,
    "two media queries collide, so one device would get the other's launch screen",
  );
});
