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

  assert.equal(
    screens.length,
    SPLASH_DEVICES.length * SPLASH_THEMES.length,
    "a device is missing a link",
  );
  assert.equal(
    byMedia.size,
    screens.length,
    "two media queries collide, so one device would get the other's launch screen",
  );
});

/**
 * The bug this file exists for. The first cut emitted 120 links — portrait plus
 * two landscape spellings per device per theme — and iOS quietly used none of
 * them: a freshly added web app opened into the same black rectangle as before.
 * 46 links renders; 120 does not. Both were measured on an iPhone 17 Pro
 * simulator (iOS 26.5) by adding the page to the home screen and photographing
 * the launch, so the real ceiling is somewhere in between and unknown.
 *
 * 64 is a deliberately conservative guess at a safe budget. If a future device
 * pushes past it, the answer is to drop a colour scheme or retire old hardware,
 * never to raise the number on the assumption that it was arbitrary.
 */
const SAFE_LINK_BUDGET = 64;

test("the launch-screen link set stays under the budget iOS will read", () => {
  const count = splashScreens().length;
  assert.ok(
    count <= SAFE_LINK_BUDGET,
    `${count} launch-screen links: past ${SAFE_LINK_BUDGET}, iOS is liable to ignore all of them and open to a blank screen`,
  );
});

test("every device the app supports is covered in portrait", () => {
  // Sizes read off Apple's simulator profiles. These are the ones a black
  // launch screen was actually reported on, plus the hardware that shipped
  // alongside them; losing one silently is the regression to catch.
  const required = [
    [360, 780, 3], // iPhone 12/13 mini
    [390, 844, 3], // iPhone 12/13/14/16e/17e
    [393, 852, 3], // iPhone 14 Pro/15/16
    [402, 874, 3], // iPhone 16 Pro/17/17 Pro
    [420, 912, 3], // iPhone Air
    [430, 932, 3], // iPhone 14 Pro Max/15 Plus/16 Plus
    [440, 956, 3], // iPhone 16 Pro Max/17 Pro Max
    [834, 1210, 2], // iPad Pro 11" (M4/M5)
  ];

  for (const [width, height, ratio] of required) {
    assert.ok(
      SPLASH_DEVICES.some((d) => d.width === width && d.height === height && d.ratio === ratio),
      `${width}x${height}@${ratio} has no launch screen`,
    );
  }
});
