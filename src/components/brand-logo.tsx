import Image from "next/image";

import {
  BRAND_LOCKUP_HEIGHT,
  BRAND_LOCKUP_SRC,
  BRAND_LOCKUP_WIDTH,
  SEO_BRAND_NAME,
} from "@/lib/brand";

/**
 * `subtitle` defaults to nothing rather than to the tagline. Every caller
 * either renders the lockup `compact` or passes an empty subtitle, so the
 * tagline default was never drawn; keeping it would mean this shared component
 * reaching for translated copy it does not use.
 */
export function BrandLogo({
  subtitle = "",
  compact = false,
  priority = false,
}: {
  subtitle?: string;
  compact?: boolean;
  priority?: boolean;
}) {
  const showSubtitle = !compact && subtitle.trim().length > 0;
  const className = ["brand-logo", compact ? "compact" : "", showSubtitle ? "with-subtitle" : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={className}>
      <span className="brand-logo-mark">
        <Image
          src={BRAND_LOCKUP_SRC}
          alt={SEO_BRAND_NAME}
          width={BRAND_LOCKUP_WIDTH}
          height={BRAND_LOCKUP_HEIGHT}
          className="brand-logo-image"
          priority={priority}
        />
      </span>
      {showSubtitle ? (
        <span className="brand-logo-copy">
          <small>{subtitle}</small>
        </span>
      ) : null}
    </span>
  );
}
