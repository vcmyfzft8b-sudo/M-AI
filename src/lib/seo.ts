import type { Metadata } from "next";

import { SEO_BRAND_NAME } from "@/lib/brand";
import { LOCALE_OG_TAG, LOCALES, type Locale } from "@/lib/i18n/locales";
import { localeAlternates } from "@/lib/i18n/routing";

/**
 * The share card for a page in `locale`, pointing at the build-time image in
 * src/app/og/[lang]/route.tsx.
 *
 * 1200×630 is the size every scraper crops to; anything smaller is shown as a
 * thumbnail beside the text instead of above it, which is most of the point of
 * having one.
 */
export function openGraphImage(locale: Locale) {
  return {
    url: `/og/${locale}`,
    width: 1200,
    height: 630,
    alt: SEO_BRAND_NAME,
  };
}

/**
 * Everything a page that exists in all five languages has to declare: its own
 * canonical, the `hreflang` set naming the other four, the share card, and the
 * Open Graph language tags.
 *
 * `alternateLocale` matters more here than it usually does — these are four
 * neighbouring markets, and it is what tells a scraper the other versions are
 * translations of this page rather than four unrelated pages.
 */
export function localizedPageMetadata({
  pathname,
  locale,
  title,
  description,
}: {
  pathname: string;
  locale: Locale;
  title: string;
  description: string;
}): Metadata {
  const alternates = localeAlternates(pathname, locale);

  return {
    title,
    description,
    alternates,
    openGraph: {
      type: "website",
      siteName: SEO_BRAND_NAME,
      title,
      description,
      url: alternates.canonical,
      locale: LOCALE_OG_TAG[locale],
      alternateLocale: LOCALES.filter((other) => other !== locale).map(
        (other) => LOCALE_OG_TAG[other],
      ),
      images: [openGraphImage(locale)],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [openGraphImage(locale)],
    },
  };
}
