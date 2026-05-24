import type { Metadata } from "next";

import { LandingPageContent } from "@/components/landing-page-content";
import { SEO_BRAND_NAME, SEO_SITE_URL } from "@/lib/brand";
import { CZECH_LOCALE, getDictionary } from "@/lib/i18n";

const dictionary = getDictionary(CZECH_LOCALE);
const title = `${SEO_BRAND_NAME} | ${dictionary.brand.shortline}`;

export const metadata: Metadata = {
  title: {
    absolute: title,
  },
  description: dictionary.brand.seoDescription,
  alternates: {
    canonical: "/cz",
    languages: {
      "sl-SI": "/",
      "cs-CZ": "/cz",
      "x-default": "/",
    },
  },
  openGraph: {
    title,
    description: dictionary.brand.seoDescription,
    url: `${SEO_SITE_URL}/cz`,
    siteName: SEO_BRAND_NAME,
    locale: "cs_CZ",
    type: "website",
  },
  twitter: {
    card: "summary",
    title,
    description: dictionary.brand.seoDescription,
  },
};

export default async function CzechHomePage() {
  return <LandingPageContent locale={CZECH_LOCALE} />;
}
