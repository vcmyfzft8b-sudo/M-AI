import type { CSSProperties } from "react";

export function EmojiIcon({
  symbol,
  label,
  size = "1em",
  className,
  style,
  decorative = true,
}: {
  symbol: string;
  label?: string;
  size?: CSSProperties["fontSize"];
  className?: string;
  style?: CSSProperties;
  decorative?: boolean;
}) {
  return (
    <span
      className={`emoji-icon ${className ?? ""}`.trim()}
      // Lets globals.css correct the handful of glyphs whose ink sits well off
      // the centre of their own box; see the table beside `.emoji-icon`.
      data-symbol={symbol}
      aria-hidden={decorative}
      aria-label={decorative ? undefined : label}
      role={decorative ? undefined : "img"}
      style={{ fontSize: size, ...style }}
    >
      {symbol}
    </span>
  );
}
