/**
 * The launch screen an installed Memo shows before its first paint.
 *
 * A web app added to the iOS home screen gets no launch image of its own. iOS
 * paints the page's own canvas colour instead and holds it until the document
 * arrives — which on a cold start is the app opening into a plain black
 * rectangle (`:root` is `#000000` in the dark theme; see redesign.css). The
 * only way to put something there is `apple-touch-startup-image`, and iOS will
 * only use an image whose pixel size matches the device exactly. Hence a
 * matrix: one file per screen, per orientation, per colour scheme.
 *
 * Nothing here is inferred at runtime. `scripts/generate-splash-screens.mjs`
 * renders the PNGs from this same list, so the files in `public/splash` and the
 * `<link>` tags in the root layout cannot drift apart. Re-run the script after
 * touching this list or the mark.
 *
 * A device missing from the list simply falls back to the blank canvas, so
 * adding hardware is additive and never a regression.
 *
 * KEEP THIS LIST SHORT. The first cut of this shipped 120 links — every device
 * in both orientations, and landscape twice over to cover a media-query
 * ambiguity — and iOS silently ignored the lot: a freshly added web app opened
 * into the same black rectangle it did before. Measured on an iPhone 17 Pro
 * simulator (iOS 26.5) by adding four otherwise identical pages to the home
 * screen and photographing the launch: one link works, one link plus a manifest
 * works, and the 120-link set does not. Portrait alone is 46 links and works.
 * Whatever the ceiling is, it sits between the two, so treat every added row as
 * spending from a budget rather than as free coverage.
 */

/** One physical screen, in CSS pixels, as iOS reports it to a media query. */
export type SplashDevice = {
  /** Width of the screen's shorter edge, in CSS pixels. */
  width: number;
  /** Height of the screen's longer edge, in CSS pixels. */
  height: number;
  /** `-webkit-device-pixel-ratio`. */
  ratio: number;
  /** The hardware this row covers. Documentation only. */
  devices: string;
};

/**
 * Sizes are the device's natural (portrait) orientation, taken from Apple's own
 * simulator profiles (`mainScreenWidth/Height/Scale` in each
 * `*.simdevicetype/Contents/Resources/profile.plist`) rather than from memory —
 * which is how the minis, the Air and the M4 iPad Pro were found missing.
 */
export const SPLASH_DEVICES: SplashDevice[] = [
  // iPhone
  { width: 320, height: 568, ratio: 2, devices: "iPhone SE (1st gen)" },
  { width: 375, height: 667, ratio: 2, devices: "iPhone SE (2nd/3rd gen), 6/7/8" },
  { width: 414, height: 736, ratio: 3, devices: "iPhone 8 Plus" },
  { width: 360, height: 780, ratio: 3, devices: "iPhone 12 mini, 13 mini" },
  { width: 375, height: 812, ratio: 3, devices: "iPhone X, XS, 11 Pro" },
  { width: 414, height: 896, ratio: 2, devices: "iPhone XR, 11" },
  { width: 414, height: 896, ratio: 3, devices: "iPhone XS Max, 11 Pro Max" },
  { width: 390, height: 844, ratio: 3, devices: "iPhone 12, 13, 14, 16e, 17e" },
  { width: 393, height: 852, ratio: 3, devices: "iPhone 14 Pro, 15, 15 Pro, 16" },
  { width: 402, height: 874, ratio: 3, devices: "iPhone 16 Pro, 17, 17 Pro" },
  { width: 428, height: 926, ratio: 3, devices: "iPhone 12/13 Pro Max, 14 Plus" },
  { width: 430, height: 932, ratio: 3, devices: "iPhone 14 Pro Max, 15 Plus/Pro Max, 16 Plus" },
  { width: 440, height: 956, ratio: 3, devices: "iPhone 16 Pro Max, 17 Pro Max" },
  { width: 420, height: 912, ratio: 3, devices: "iPhone Air" },
  // iPad
  { width: 744, height: 1133, ratio: 2, devices: 'iPad mini 6/7 (8.3")' },
  { width: 768, height: 1024, ratio: 2, devices: 'iPad mini 5, iPad 9.7"' },
  { width: 810, height: 1080, ratio: 2, devices: 'iPad 10.2"' },
  { width: 820, height: 1180, ratio: 2, devices: 'iPad 10th gen, iPad Air 10.9"/11"' },
  { width: 834, height: 1112, ratio: 2, devices: 'iPad Pro 10.5", iPad Air 3' },
  { width: 834, height: 1194, ratio: 2, devices: 'iPad Pro 11" (1st-4th gen)' },
  { width: 834, height: 1210, ratio: 2, devices: 'iPad Pro 11" (M4/M5)' },
  { width: 1024, height: 1366, ratio: 2, devices: 'iPad Pro 12.9", iPad Air 13"' },
  { width: 1032, height: 1376, ratio: 2, devices: 'iPad Pro 13" (M4)' },
];

export const SPLASH_THEMES = ["light", "dark"] as const;
export type SplashTheme = (typeof SPLASH_THEMES)[number];

/**
 * `--bg` from redesign.css, both themes — the colour the app itself paints, not
 * the `:root` canvas behind it. The dark one matters: the canvas is pure black,
 * and a launch screen in pure black reads as a device that has not woken up
 * yet. #121214 is the same near-black every screen of the app is drawn on, so
 * the launch screen looks like the app arriving early rather than a fault.
 *
 * The image is chosen by the system colour scheme, which is what the app
 * follows until someone overrides it in settings — a manual override cannot
 * reach a picture iOS cached at install time, so it sees one mismatched frame.
 */
export const SPLASH_BACKGROUNDS: Record<SplashTheme, string> = {
  light: "#f1f1f5",
  dark: "#121214",
};

/**
 * Fraction of the screen's shorter edge the brain mark spans. Small: a launch
 * screen is a held breath, not a billboard, and the mark reads as a mark rather
 * than an illustration at about a third of the width.
 */
export const SPLASH_LOGO_SCALE = 0.3;

export type SplashScreen = {
  /** Path under `public/`, without the leading slash. */
  file: string;
  url: string;
  media: string;
  /** Image size in device pixels. */
  pixelWidth: number;
  pixelHeight: number;
  theme: SplashTheme;
};

/**
 * Every `<link rel="apple-touch-startup-image">` the layout renders: one per
 * device, per colour scheme, portrait only.
 *
 * Landscape is deliberately absent. Covering it honestly needed two links per
 * device — browsers disagree on whether `device-width` follows the device or
 * the viewport once the screen is turned — which tripled the list and took the
 * whole thing past whatever iOS is willing to read. A phone-shaped app that
 * launches upright is worth more than a sideways iPad launch that costs the
 * upright one, so landscape falls back to the plain canvas.
 */
export function splashScreens(): SplashScreen[] {
  const screens: SplashScreen[] = [];

  for (const device of SPLASH_DEVICES) {
    for (const theme of SPLASH_THEMES) {
      const pixelWidth = device.width * device.ratio;
      const pixelHeight = device.height * device.ratio;
      const file = `splash/${pixelWidth}x${pixelHeight}-${theme}.png`;

      screens.push({
        file,
        url: `/${file}`,
        media: [
          `(prefers-color-scheme: ${theme})`,
          `(device-width: ${device.width}px)`,
          `(device-height: ${device.height}px)`,
          `(-webkit-device-pixel-ratio: ${device.ratio})`,
          `(orientation: portrait)`,
        ].join(" and "),
        pixelWidth,
        pixelHeight,
        theme,
      });
    }
  }

  return screens;
}
