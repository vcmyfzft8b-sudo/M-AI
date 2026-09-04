import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

function readSource(relativePath) {
  return readFileSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url)), "utf8");
}

import {
  SPLASH_BACKGROUNDS,
  SPLASH_DEVICES,
  SPLASH_MARK_FILE,
  SPLASH_MARK_HEIGHT,
  SPLASH_MARK_SRC,
  SPLASH_MARK_WIDTH,
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

/**
 * The second thing iOS did silently. `(prefers-color-scheme: dark)` is honoured
 * in a launch-screen media query; `(prefers-color-scheme: light)` is not — a
 * light-qualified link matches nothing, and a phone in light mode opens to a
 * blank screen exactly as if no launch screen had been declared at all.
 *
 * Measured on an iPhone 17 Pro simulator (iOS 26.5) with two links to visibly
 * different images: unqualified, then dark-qualified. In light mode the
 * unqualified image appeared; in dark mode the dark-qualified one did. So light
 * has to be the bare fallback and dark the override, and the dark link has to
 * come second for it to win.
 */
test("light is the unqualified fallback and dark overrides it", () => {
  const screens = splashScreens();

  for (const screen of screens) {
    const qualified = screen.media.includes("prefers-color-scheme");

    if (screen.theme === "dark") {
      assert.ok(
        screen.media.includes("(prefers-color-scheme: dark)"),
        `${screen.file} is the dark image but does not ask for a dark scheme`,
      );
    } else {
      assert.ok(
        !qualified,
        `${screen.file} asks for a colour scheme; iOS ignores a light-qualified launch screen and the app opens blank`,
      );
    }
  }

  // Both match on a dark device, so the dark one must be declared last.
  for (const device of SPLASH_DEVICES) {
    const forDevice = screens.filter((s) => s.media.includes(`(device-width: ${device.width}px)`)
      && s.media.includes(`(device-height: ${device.height}px)`)
      && s.media.includes(`(-webkit-device-pixel-ratio: ${device.ratio})`));
    const light = forDevice.findIndex((s) => s.theme === "light");
    const dark = forDevice.findIndex((s) => s.theme === "dark");
    assert.ok(light !== -1 && dark !== -1, `${device.devices} is missing a colour scheme`);
    assert.ok(
      screens.indexOf(forDevice[light]) < screens.indexOf(forDevice[dark]),
      `${device.devices}: the dark link must follow the unqualified one to win on a dark device`,
    );
  }
});

/**
 * The line the whole feature hangs from. iOS only honours
 * `apple-touch-startup-image` on a page that also claims
 * `apple-mobile-web-app-capable`, and Next does not emit it: the metadata
 * API's `appleWebApp.capable` renders the standards-track
 * `mobile-web-app-capable`, which iOS ignores.
 *
 * Without the hand-written tag the launch screens are served, correctly sized,
 * matched by their media queries — and never drawn. Measured by serving
 * production's own HTML from localhost unchanged (blank) and then adding only
 * this tag (the mark appeared). There is no assertion that can catch its
 * absence at runtime, so it is pinned here.
 */
test("the layout declares apple-mobile-web-app-capable by hand", () => {
  const layout = readSource("src/app/layout.tsx");

  assert.match(
    layout,
    /<meta\s+name="apple-mobile-web-app-capable"\s+content="yes"/,
    "without this tag iOS ignores every launch screen and the app opens blank",
  );
});

/**
 * Three files name the same two colours: the launch screens are drawn on them,
 * `--bg` paints the app on them, and `:root` paints the canvas between pages
 * with them. They had already drifted once — the dark canvas sat at pure black
 * while everything else used #121214, so the frames between pages were darker
 * than either side of them, and Android had the wrong colour to derive its own
 * launch screen from.
 *
 * Android is why this is pinned rather than left to care. Its launch screen
 * has no per-theme control of its own: the manifest carries a single
 * `background_color`, and the only way the two appearances differ there is if
 * Chrome overrides it from the `prefers-color-scheme` rules in this stylesheet.
 * Whatever these say is what an Android user opens into.
 */
test("the canvas, the app background and the launch screens are the same colours", () => {
  const css = readSource("src/app/redesign.css");

  const canvasLight = css.match(/:root\s*\{\s*background-color:\s*(#[0-9a-f]{6})/i)?.[1];
  const canvasDark = css.match(
    /:root\[data-theme="dark"\]\s*\{\s*background-color:\s*(#[0-9a-f]{6})/i,
  )?.[1];

  assert.equal(
    canvasLight?.toLowerCase(),
    SPLASH_BACKGROUNDS.light,
    "the light canvas does not match the light launch screens",
  );
  assert.equal(
    canvasDark?.toLowerCase(),
    SPLASH_BACKGROUNDS.dark,
    "the dark canvas does not match the dark launch screens; on Android this is the launch screen",
  );

  // `--bg` is what the app itself paints; a mismatch is a visible seam between
  // the launch screen and the first frame of the app.
  for (const [theme, colour] of Object.entries(SPLASH_BACKGROUNDS)) {
    assert.ok(
      css.includes(`--bg: ${colour};`),
      `--bg has no ${theme} value of ${colour}, so the app does not match its own launch screen`,
    );
  }
});

/**
 * The service worker exists for the white frame between the launch screen and
 * the app: iOS holds its launch image until first paint, first paint waits on
 * render-blocking CSS, and a document that has painted nothing is white.
 * Keeping the build's assets in the cache is what removes the wait.
 *
 * What it must never do is cache a page. Memo's HTML is per-account, so a
 * cached navigation is one person's notes handed to whoever opens the app
 * next. The scope is content-hashed build output, where a changed file is a
 * changed URL and a stale hit is impossible.
 */
test("the service worker caches build output and nothing else", () => {
  const sw = readSource("public/sw.js");

  assert.match(
    sw,
    /startsWith\("\/_next\/static\/"\)/,
    "the cacheable test must be the content-hashed build directory",
  );

  // Anything that could carry account data, or change behind a stable URL.
  for (const forbidden of ["/api/", "text/html"]) {
    assert.ok(
      !sw.includes(forbidden),
      `the service worker mentions ${forbidden}; it must not cache pages or API replies`,
    );
  }

  /*
   * Navigations are answered — that is how the preloaded response gets used —
   * but the branch that answers them must never reach a cache. A page is one
   * account's notes; storing one would hand them to whoever opens the app next.
   */
  const navigateBranch = sw.slice(
    sw.indexOf('request.mode === "navigate"'),
    sw.indexOf("if (!isCacheable(url))"),
  );

  assert.ok(navigateBranch.length > 0, "the navigation branch has moved; re-check this assertion");
  assert.ok(
    !navigateBranch.includes("cache"),
    "the navigation branch touches a cache; pages must never be stored",
  );

  assert.match(sw, /request\.method !== "GET"/, "only GETs may be served from cache");
});

/**
 * The launch screen the page draws for itself, which exists because the one
 * above is not enough: iOS uses a baked-in image only where its pixels match
 * the screen exactly, so a phone in Display Zoom, a home-screen icon carried
 * over by a device transfer, and every Android device open into a bare canvas.
 * See src/components/launch-screen.tsx.
 *
 * It has the same problem as the images: no runtime, no error path, and it
 * looks broken only on a real phone.
 */
test("the mark the in-page launch screen draws exists at the size it claims", () => {
  const file = publicFile(SPLASH_MARK_FILE);

  assert.ok(
    existsSync(file),
    `${SPLASH_MARK_FILE} is missing — run node --experimental-strip-types scripts/generate-splash-screens.mjs`,
  );

  const { width, height } = pngSize(file);
  assert.equal(width, SPLASH_MARK_WIDTH, `${SPLASH_MARK_FILE} is ${width}px wide`);
  assert.equal(height, SPLASH_MARK_HEIGHT, `${SPLASH_MARK_FILE} is ${height}px tall`);
  assert.equal(SPLASH_MARK_SRC, `/${SPLASH_MARK_FILE}`);
});

test("the layout renders the launch screen, and it draws the generated mark", () => {
  const layout = readSource("src/app/layout.tsx");
  const launch = readSource("src/components/launch-screen.tsx");
  const css = readSource("src/app/redesign.css");

  assert.match(layout, /<LaunchScreen \/>/, "nothing renders the launch screen");

  /*
   * A CSS background rather than an <img>, so that the website — where the
   * launch screen is `display: none` — fetches nothing for it. An <img> is
   * loaded whether or not its box is drawn, and asking for it early enough to
   * be useful in the app means asking ahead of the landing page's own hero.
   */
  assert.ok(
    !/<img\b[^>]*src=/.test(launch),
    "an <img> here is fetched on the website too, where the launch screen never shows",
  );
  assert.ok(
    css.includes(`background-image: url("${SPLASH_MARK_SRC}")`),
    "the launch screen must draw the generated mark",
  );
  assert.ok(
    css.includes(`aspect-ratio: ${SPLASH_MARK_WIDTH} / ${SPLASH_MARK_HEIGHT}`),
    "the mark's box must keep the mark's own shape",
  );
});

/**
 * The two gates and the two ways out. Losing the gate would put a full-screen
 * logo over the website; losing a way out would leave it over the app.
 */
test("the in-page launch screen shows only in an installed app, and always leaves", () => {
  const css = readSource("src/app/redesign.css");
  const dismiss = readSource("src/components/launch-screen-dismiss.tsx");
  const layout = readSource("src/app/layout.tsx");

  const hidden = css.match(/\.memo-launch \{[^}]*display: none;/s);
  assert.ok(hidden, ".memo-launch must be hidden by default, so a browser tab never sees it");

  assert.match(
    css,
    /@media \(display-mode: standalone\), \(display-mode: fullscreen\) \{\s*\.memo-launch \{\s*display: flex;/,
    "the launch screen must be gated on the app being installed",
  );
  assert.match(
    css,
    /:root\[data-standalone\] \.memo-launch \{\s*display: flex;/,
    "iOS's own standalone flag must show it too",
  );
  assert.match(
    layout,
    /window\.navigator\.standalone === true/,
    "nothing sets data-standalone, so the iOS gate can never match",
  );

  // Way out one: the app says it has launched.
  assert.match(
    dismiss,
    /document\.documentElement\.dataset\.launched/,
    "the launch screen is never dismissed",
  );
  assert.match(
    css,
    /:root\[data-launched\] \.memo-launch \{/,
    "nothing hides the launch screen once the app has launched",
  );

  // Way out two: the app's JavaScript never arrives at all. Without this the
  // failure mode is an app that shows its logo and never opens.
  assert.match(
    css,
    /animation: memo-launch-timeout [^;]+;/,
    "the launch screen has no timeout; with no JavaScript it would never leave",
  );
  assert.match(css, /@keyframes memo-launch-timeout \{/, "the timeout animation is not defined");
});

test("the in-page launch screen is drawn on the same colours as the baked-in ones", () => {
  const css = readSource("src/app/redesign.css");
  const block = css.slice(css.indexOf(".memo-launch {"), css.indexOf("@keyframes memo-launch-timeout"));

  assert.ok(block.includes(`background-color: ${SPLASH_BACKGROUNDS.light};`), "light seam");
  assert.ok(block.includes(`background-color: ${SPLASH_BACKGROUNDS.dark};`), "dark seam");
});

/**
 * public/ is served with `max-age=0, must-revalidate`, which puts a conditional
 * request in front of the mark on every cold launch — the one moment the app
 * cannot spend a round trip, and the one connection where it might not come
 * back at all.
 */
test("the launch assets are cached rather than revalidated on every launch", () => {
  const config = readSource("next.config.ts");
  const rule = config.slice(config.indexOf("async headers()"));

  assert.match(rule, /splash\|icons/, "the launch assets have no cache rule");
  assert.match(rule, /max-age=\d{4,}/, "the cache rule is too short to survive to the next launch");
});
