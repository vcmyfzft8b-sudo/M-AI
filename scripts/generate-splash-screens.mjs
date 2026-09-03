/**
 * Renders the installed app's launch screens and home-screen icons.
 *
 * Run after changing the mark, the canvas colours, or the device matrix:
 *
 *   node scripts/generate-splash-screens.mjs
 *
 * Everything it writes is checked in, because these files are static brand
 * assets and generating them during the build would put sharp on the critical
 * path of every deploy for output that changes once a year. The device matrix
 * lives in src/lib/splash-screens.ts and is imported here rather than copied,
 * so the PNGs on disk and the <link> tags in the layout always agree.
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

import {
  SPLASH_BACKGROUNDS,
  SPLASH_LOGO_SCALE,
  SPLASH_MARK_FILE,
  SPLASH_MARK_WIDTH,
  splashScreens,
} from "../src/lib/splash-screens.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(root, "public");
const splashDir = path.join(publicDir, "splash");
const iconDir = path.join(publicDir, "icons");

const MARK = path.join(publicDir, "memo-logo-compressed.png");

/**
 * The mark, centred on a flat canvas, at the size the launch screen wants.
 *
 * The mark alone, not the lockup: the launch screen answers "did the thing I
 * tapped open?", and the thing they tapped is the brain on the home screen.
 * Repeating it is the answer; spelling the name out underneath is a poster.
 */
async function renderSplash({ pixelWidth, pixelHeight, theme }) {
  // Sized against the shorter edge, so the mark lands well clear of the notch
  // and the home indicator on every device in the matrix.
  const logoWidth = Math.round(Math.min(pixelWidth, pixelHeight) * SPLASH_LOGO_SCALE);
  const logo = await sharp(MARK).resize({ width: logoWidth }).toBuffer();

  return sharp({
    create: {
      width: pixelWidth,
      height: pixelHeight,
      channels: 4,
      background: SPLASH_BACKGROUNDS[theme],
    },
  })
    .composite([{ input: logo, gravity: "centre" }])
    /*
     * A flat field with one illustration on it is exactly what an indexed PNG
     * is good at, but only with dithering off: the noise it sprays across the
     * mark's gradients defeats every row filter and quadruples the file for a
     * difference nobody can see at 128 colours.
     */
    .png({ compressionLevel: 9, palette: true, colours: 128, dither: 0, effort: 10 })
    .toBuffer();
}

/**
 * The mark alone, transparent, for the launch screen the page draws itself.
 *
 * Same picture as the one baked into the screens above, on no canvas: the
 * document supplies the colour, so one file serves both themes. See
 * `LaunchScreen`.
 */
async function renderMark() {
  return sharp(MARK)
    .resize({ width: SPLASH_MARK_WIDTH })
    .png({ compressionLevel: 9, palette: true, colours: 128, dither: 0, effort: 10 })
    .toBuffer();
}

/**
 * A home-screen icon. `maskable` icons are cropped to whatever shape the
 * launcher likes, so the mark is inset into the safe circle and the canvas is
 * filled edge to edge; the plain icon keeps its transparent sticker edge.
 */
async function renderIcon({ size, maskable }) {
  const markWidth = Math.round(size * (maskable ? 0.62 : 0.92));
  const mark = await sharp(MARK).resize({ width: markWidth }).toBuffer();

  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: maskable ? SPLASH_BACKGROUNDS.light : { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: mark, gravity: "centre" }])
    .png({ compressionLevel: 9, palette: true, colours: 128, dither: 0, effort: 10 })
    .toBuffer();
}

async function main() {
  await rm(splashDir, { force: true, recursive: true });
  await mkdir(splashDir, { recursive: true });
  await mkdir(iconDir, { recursive: true });

  // Two devices can share a pixel size (different CSS size, different ratio),
  // and both point at the one file. Render it once.
  const screens = new Map(splashScreens().map((screen) => [screen.file, screen]));
  let bytes = 0;

  for (const screen of screens.values()) {
    const png = await renderSplash(screen);
    await writeFile(path.join(publicDir, screen.file), png);
    bytes += png.length;
  }

  const mark = await renderMark();
  await writeFile(path.join(publicDir, SPLASH_MARK_FILE), mark);
  bytes += mark.length;

  const icons = [
    { file: "icons/icon-192.png", size: 192, maskable: false },
    { file: "icons/icon-512.png", size: 512, maskable: false },
    { file: "icons/icon-maskable-512.png", size: 512, maskable: true },
  ];

  for (const icon of icons) {
    const png = await renderIcon(icon);
    await writeFile(path.join(publicDir, icon.file), png);
    bytes += png.length;
  }

  console.log(
    `Wrote ${screens.size} launch screens, the in-page mark and ${icons.length} icons (${(bytes / 1024 / 1024).toFixed(2)} MB).`,
  );
}

await main();
