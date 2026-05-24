import type { Metadata } from "next";

import { LandingPageContent } from "@/components/landing-page-content";
import { DEFAULT_LOCALE } from "@/lib/i18n";

export const metadata: Metadata = {
  alternates: {
    canonical: "/",
    languages: {
      "sl-SI": "/",
      "cs-CZ": "/cz",
      "x-default": "/",
    },
  },
};

export default async function HomePage() {
  return <LandingPageContent locale={DEFAULT_LOCALE} />;
}
