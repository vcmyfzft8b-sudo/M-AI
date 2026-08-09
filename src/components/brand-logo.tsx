import Image from "next/image";

import { BRAND_TAGLINE, SEO_BRAND_NAME } from "@/lib/brand";

export function BrandLogo({
  subtitle = BRAND_TAGLINE,
  compact = false,
  imageSizes,
  priority = false,
}: {
  subtitle?: string;
  compact?: boolean;
  imageSizes?: string;
  priority?: boolean;
}) {
  return (
    // One artwork file carries the mark and the "Memo AI" lettering together,
    // rather than pairing the brain with live text. The iOS wrapper shows the
    // same file, so the two stay identical without the app having to restyle
    // the page.
    <span className={`brand-logo ${compact ? "compact" : ""}`}>
      <span className="brand-logo-mark">
        <Image
          src="/memo-wordmark.png"
          alt={SEO_BRAND_NAME}
          width={480}
          height={148}
          className="brand-logo-image"
          sizes={imageSizes ?? (compact ? "(max-width: 768px) 10rem, 22rem" : "9rem")}
          priority={priority}
        />
      </span>
      {!compact && subtitle ? (
        <span className="brand-logo-copy">
          <small>{subtitle}</small>
        </span>
      ) : null}
    </span>
  );
}
