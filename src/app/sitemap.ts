import type { MetadataRoute } from "next";

import { SEO_SITE_URL } from "@/lib/brand";
import { LOCALES } from "@/lib/i18n/locales";
import { absoluteLocalizedUrl, HREFLANG } from "@/lib/i18n/routing";

/**
 * Every page a crawler should know about, in every language it exists in.
 *
 * The four translated landing pages have no incoming links from outside the
 * site — nothing on the web points at `/sl` yet — so this file is how they get
 * discovered at all. Each entry repeats the full `hreflang` set in
 * `alternates.languages`, which is what tells Google the five rows are one
 * page in five languages rather than five thin near-duplicates.
 */
const PUBLIC_PATHS = [
  { path: "/", changeFrequency: "weekly" as const, priority: 1 },
  { path: "/legal/terms-of-use", changeFrequency: "yearly" as const, priority: 0.3 },
  { path: "/legal/privacy-policy", changeFrequency: "yearly" as const, priority: 0.3 },
  { path: "/legal/refund-policy", changeFrequency: "yearly" as const, priority: 0.3 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();

  return PUBLIC_PATHS.flatMap(({ path, changeFrequency, priority }) => {
    const languages = Object.fromEntries(
      LOCALES.map((locale) => [HREFLANG[locale], absoluteLocalizedUrl(SEO_SITE_URL, path, locale)]),
    );

    return LOCALES.map((locale) => ({
      url: absoluteLocalizedUrl(SEO_SITE_URL, path, locale),
      lastModified,
      changeFrequency,
      priority,
      alternates: { languages },
    }));
  });
}
