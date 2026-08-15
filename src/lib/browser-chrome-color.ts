/**
 * Works out the colour the app paints along the bottom edge of the viewport, so
 * the browser's own chrome can be given the same one. Without it a sheet that
 * runs to the bottom of the screen ends in a hard seam: grey sheet, then a
 * black browser bar underneath.
 *
 * Rather than hard-coding a colour per screen, the bottom-centre pixel is
 * sampled from the live DOM, so every sheet, dock and page gets the right
 * colour for free — including ones added later.
 */

/** Canvas colours, mirrored from `--canvas` in globals.css. */
export const CANVAS_COLOR_LIGHT = "#e9e9ed";
export const CANVAS_COLOR_DARK = "#000000";

/** Marks the meta tag this module owns, so it is never duplicated. */
export const THEME_COLOR_META_ATTRIBUTE = "data-app-theme-color";

type Rgba = { r: number; g: number; b: number; a: number };

const TRANSPARENT: Rgba = { r: 0, g: 0, b: 0, a: 0 };
/** The browser's default canvas, sitting under every page background. */
const DEFAULT_CANVAS: Rgba = { r: 255, g: 255, b: 255, a: 1 };

function expandHex(hex: string) {
  return hex.length <= 4
    ? hex
        .split("")
        .map((character) => character + character)
        .join("")
    : hex;
}

function parseHex(hex: string): Rgba | null {
  const expanded = expandHex(hex);

  if (expanded.length !== 6 && expanded.length !== 8) {
    return null;
  }

  const channel = (index: number) => Number.parseInt(expanded.slice(index, index + 2), 16);

  return {
    r: channel(0),
    g: channel(2),
    b: channel(4),
    a: expanded.length === 8 ? channel(6) / 255 : 1,
  };
}

/**
 * Parses the colour formats `getComputedStyle` can hand back for a background:
 * `rgb()`/`rgba()` in either the legacy comma or the modern slash syntax, hex
 * literals, and `color(srgb ...)` — which Safari uses for some `color-mix()`
 * results. Anything else (a gradient, a non-sRGB space) returns null so the
 * layer is skipped and the one behind it is used instead.
 */
export function parseCssColor(input: string): Rgba | null {
  const value = input.trim().toLowerCase();

  if (!value || value === "transparent" || value === "none") {
    return TRANSPARENT;
  }

  if (value.startsWith("#")) {
    return parseHex(value.slice(1));
  }

  const call = /^(rgba?|color)\(([^)]*)\)$/.exec(value);

  if (!call) {
    return null;
  }

  const isColorFunction = call[1] === "color";
  let body = call[2].trim();

  if (isColorFunction) {
    const space = /^([a-z0-9-]+)\s+/.exec(body);

    if (!space || space[1] !== "srgb") {
      return null;
    }

    body = body.slice(space[0].length);
  }

  const [channelPart, alphaPart] = body.split("/");
  const parts = channelPart.split(/[\s,]+/).filter(Boolean);

  if (parts.length < 3) {
    return null;
  }

  const toChannel = (part: string) => {
    const amount = Number.parseFloat(part);

    if (Number.isNaN(amount)) {
      return null;
    }

    // `color(srgb ...)` channels run 0–1, `rgb()` channels run 0–255.
    return part.endsWith("%") ? (amount / 100) * 255 : isColorFunction ? amount * 255 : amount;
  };

  const [r, g, b] = parts.slice(0, 3).map(toChannel);

  if (r === null || g === null || b === null) {
    return null;
  }

  const rawAlpha = (alphaPart ?? parts[3])?.trim();
  const alpha = rawAlpha
    ? rawAlpha.endsWith("%")
      ? Number.parseFloat(rawAlpha) / 100
      : Number.parseFloat(rawAlpha)
    : 1;

  return {
    r,
    g,
    b,
    a: Number.isNaN(alpha) ? 1 : Math.min(1, Math.max(0, alpha)),
  };
}

/** Standard source-over compositing of `top` onto `bottom`. */
function composite(top: Rgba, bottom: Rgba): Rgba {
  const alpha = top.a + bottom.a * (1 - top.a);

  if (alpha <= 0) {
    return TRANSPARENT;
  }

  const blend = (topChannel: number, bottomChannel: number) =>
    (topChannel * top.a + bottomChannel * bottom.a * (1 - top.a)) / alpha;

  return {
    r: blend(top.r, bottom.r),
    g: blend(top.g, bottom.g),
    b: blend(top.b, bottom.b),
    a: alpha,
  };
}

function toHex({ r, g, b }: Rgba) {
  const channel = (value: number) =>
    Math.min(255, Math.max(0, Math.round(value)))
      .toString(16)
      .padStart(2, "0");

  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

/**
 * Walks the stack of elements under the bottom-centre of the viewport and
 * blends their backgrounds together, so translucent sheets and backdrops
 * resolve to the colour the user actually sees.
 */
export function readBottomEdgeColor(): string | null {
  if (typeof document === "undefined" || typeof window === "undefined") {
    return null;
  }

  const width = window.innerWidth;
  const height = window.innerHeight;

  if (!width || !height) {
    return null;
  }

  const layers: Rgba[] = [];
  let node = document.elementFromPoint(Math.round(width / 2), height - 1);

  while (node) {
    const background = parseCssColor(window.getComputedStyle(node).backgroundColor);

    if (background && background.a > 0) {
      layers.push(background);

      if (background.a >= 1) {
        break;
      }
    }

    node = node.parentElement;
  }

  // Nothing under the point — `elementFromPoint` returns null whenever the
  // sample lands outside the layout viewport, which happens for a frame while
  // Safari's toolbar collapses and the viewport grows. Reporting the default
  // canvas here would flash a white strip across a dark app, so say nothing and
  // let the caller keep the colour it already has.
  if (layers.length === 0) {
    return null;
  }

  let result = DEFAULT_CANVAS;

  for (let index = layers.length - 1; index >= 0; index -= 1) {
    result = composite(layers[index], result);
  }

  return toHex(result);
}

/**
 * Writes the colour into a `theme-color` meta tag kept at the very top of the
 * head. It is created here rather than through Next's viewport metadata so
 * React never claims the tag back during hydration.
 */
export function setThemeColorMeta(color: string) {
  if (typeof document === "undefined") {
    return;
  }

  let meta = document.head.querySelector<HTMLMetaElement>(
    `meta[name="theme-color"][${THEME_COLOR_META_ATTRIBUTE}]`,
  );

  if (!meta) {
    meta = document.createElement("meta");
    meta.setAttribute("name", "theme-color");
    meta.setAttribute(THEME_COLOR_META_ATTRIBUTE, "");
    document.head.prepend(meta);
  }

  if (meta.getAttribute("content") !== color) {
    meta.setAttribute("content", color);
  }
}
