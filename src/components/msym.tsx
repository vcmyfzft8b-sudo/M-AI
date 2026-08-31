import type { CSSProperties } from "react";

/**
 * A Material Symbols Rounded glyph, as the redesign draws them.
 *
 * `fill` picks the FILL axis: the redesign uses filled glyphs for solid
 * affordances (play, close, check) and outlined ones for navigation and tools.
 * Every name used here must also appear in the `icon_names` subset requested in
 * `src/app/layout.tsx`, otherwise the ligature renders as its own text.
 */
export function Msym({
  name,
  size,
  fill = true,
  weight,
  className,
  style,
}: {
  name: string;
  /** Any CSS length; the redesign sizes icons in rem. */
  size?: string;
  fill?: boolean;
  weight?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const variation =
    weight === undefined
      ? undefined
      : `"FILL" ${fill ? 1 : 0}, "wght" ${weight}, "GRAD" 0, "opsz" 24`;

  return (
    <span
      aria-hidden="true"
      className={["msym", fill ? "" : "msym-outline", className ?? ""].filter(Boolean).join(" ")}
      style={{
        fontSize: size,
        ...(variation ? { fontVariationSettings: variation } : null),
        ...style,
      }}
    >
      {name}
    </span>
  );
}

/**
 * Emoji rendered on the colour font, matching the redesign's `.emoji` class:
 * inline-flex so it keeps its own line box instead of shifting the row.
 */
export function Emoji({
  symbol,
  size,
  className,
}: {
  symbol: string;
  size?: string;
  className?: string;
}) {
  return (
    <span
      className={["memo-emoji", className ?? ""].filter(Boolean).join(" ")}
      style={{ fontSize: size }}
    >
      {symbol}
    </span>
  );
}
