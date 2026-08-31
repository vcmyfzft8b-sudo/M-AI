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
 * touching this list or the lockup.
 *
 * A device missing from the list simply falls back to the blank canvas, so
 * adding hardware is additive and never a regression.
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

/** Sizes are the device's natural (portrait) orientation. */
export const SPLASH_DEVICES: SplashDevice[] = [
  // iPhone
  { width: 320, height: 568, ratio: 2, devices: "iPhone SE (1st gen)" },
  { width: 375, height: 667, ratio: 2, devices: "iPhone SE (2nd/3rd gen), 6/7/8" },
  { width: 414, height: 736, ratio: 3, devices: "iPhone 8 Plus" },
  { width: 375, height: 812, ratio: 3, devices: "iPhone X, XS, 11 Pro, 12 mini, 13 mini" },
  { width: 414, height: 896, ratio: 2, devices: "iPhone XR, 11" },
  { width: 414, height: 896, ratio: 3, devices: "iPhone XS Max, 11 Pro Max" },
  { width: 390, height: 844, ratio: 3, devices: "iPhone 12, 13, 14, 16e" },
  { width: 393, height: 852, ratio: 3, devices: "iPhone 14 Pro, 15, 15 Pro, 16" },
  { width: 402, height: 874, ratio: 3, devices: "iPhone 16 Pro" },
  { width: 428, height: 926, ratio: 3, devices: "iPhone 12/13 Pro Max, 14 Plus" },
  { width: 430, height: 932, ratio: 3, devices: "iPhone 14 Pro Max, 15 Plus/Pro Max, 16 Plus" },
  { width: 440, height: 956, ratio: 3, devices: "iPhone 16 Pro Max" },
  // iPad
  { width: 744, height: 1133, ratio: 2, devices: 'iPad mini 6/7 (8.3")' },
  { width: 768, height: 1024, ratio: 2, devices: 'iPad mini 5, iPad 9.7"' },
  { width: 810, height: 1080, ratio: 2, devices: 'iPad 10.2"' },
  { width: 820, height: 1180, ratio: 2, devices: 'iPad 10th gen, iPad Air 10.9"/11"' },
  { width: 834, height: 1112, ratio: 2, devices: 'iPad Pro 10.5", iPad Air 3' },
  { width: 834, height: 1194, ratio: 2, devices: 'iPad Pro 11"' },
  { width: 1024, height: 1366, ratio: 2, devices: 'iPad Pro 12.9", iPad Air 13"' },
  { width: 1032, height: 1376, ratio: 2, devices: 'iPad Pro 13" (M4)' },
];

export const SPLASH_ORIENTATIONS = ["portrait", "landscape"] as const;
export type SplashOrientation = (typeof SPLASH_ORIENTATIONS)[number];

export const SPLASH_THEMES = ["light", "dark"] as const;
export type SplashTheme = (typeof SPLASH_THEMES)[number];

/**
 * The two canvas colours from redesign.css. The launch image is chosen by the
 * system colour scheme, which is the same thing the app follows until someone
 * overrides it in settings — a manual override cannot reach a picture iOS
 * cached at install time, so a light-on-dark override sees one light frame.
 */
export const SPLASH_BACKGROUNDS: Record<SplashTheme, string> = {
  light: "#f1f1f5",
  dark: "#000000",
};

/** Fraction of the screen's shorter edge the lockup spans. */
export const SPLASH_LOGO_SCALE = 0.62;

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
 * Every `<link rel="apple-touch-startup-image">` the layout renders.
 *
 * A landscape screen gets two links to the one image. Browsers disagree on
 * whether `device-width` follows the device or the viewport once the screen is
 * rotated — Safari is documented to keep it on the device's natural edge, which
 * is what every splash generator emits, but Chrome swaps the two, and there is
 * no way to settle it from a desktop. Both spellings are cheap, they cannot
 * both match at once, and between them one is right on whatever iOS does.
 */
export function splashScreens(): SplashScreen[] {
  const screens: SplashScreen[] = [];

  const add = (
    device: SplashDevice,
    orientation: SplashOrientation,
    theme: SplashTheme,
    { swapped }: { swapped: boolean },
  ) => {
    const portrait = orientation === "portrait";
    const pixelWidth = (portrait ? device.width : device.height) * device.ratio;
    const pixelHeight = (portrait ? device.height : device.width) * device.ratio;
    const queryWidth = swapped ? device.height : device.width;
    const queryHeight = swapped ? device.width : device.height;
    const file = `splash/${pixelWidth}x${pixelHeight}-${theme}.png`;

    screens.push({
      file,
      url: `/${file}`,
      media: [
        `(prefers-color-scheme: ${theme})`,
        `(device-width: ${queryWidth}px)`,
        `(device-height: ${queryHeight}px)`,
        `(-webkit-device-pixel-ratio: ${device.ratio})`,
        `(orientation: ${orientation})`,
      ].join(" and "),
      pixelWidth,
      pixelHeight,
      theme,
    });
  };

  for (const device of SPLASH_DEVICES) {
    for (const theme of SPLASH_THEMES) {
      add(device, "portrait", theme, { swapped: false });
      add(device, "landscape", theme, { swapped: false });
      add(device, "landscape", theme, { swapped: true });
    }
  }

  return screens;
}
