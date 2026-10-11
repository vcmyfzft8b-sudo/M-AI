import type { Metadata } from "next";

import { CreatorProgram } from "@/components/ugc/creator-program";
import { SEO_SITE_URL } from "@/lib/brand";
import { getTranslations } from "@/lib/i18n/server";
import { normalizeReferrer } from "@/lib/ugc/creator-application";
import { CREATOR_TERMS } from "@/lib/ugc/creator-campaigns";
import { resolveCreatorMarket } from "@/lib/ugc/creator-market.server";
import { getShowcaseVideos } from "@/lib/ugc/creator-showcase";

// The campaign is chosen per request from the visitor's IP country.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslations();
  const title = t("ugcApply.metaTitle");
  const description = t("ugcApply.metaDescription");

  return {
    title,
    description,
    alternates: { canonical: "/ugc" },
    openGraph: { title, description, url: `${SEO_SITE_URL}/ugc`, type: "website" },
    twitter: { card: "summary_large_image", title, description },
  };
}

/**
 * The creator program's public page: the link shared to recruit UGC creators.
 * Applications land in `/admin/applications`. See docs/ugc-creator-program.md.
 *
 * One link for both campaigns: a visitor from Slovenia gets the Slovenian program and
 * one from the Balkans the Balkan program, each with only its own pay
 * (`resolveCreatorMarket`). `?ref=` tags the link (`?ref=instagram-story`) and is stored
 * with each application, so the admin can tell which post brought whom.
 */
export default async function UgcCreatorProgramPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string | string[]; market?: string | string[] }>;
}) {
  const { ref, market: requested } = await searchParams;
  const [{ market, preview }, videos] = await Promise.all([resolveCreatorMarket(requested), getShowcaseVideos()]);

  return (
    <CreatorProgram
      market={market}
      terms={CREATOR_TERMS[market]}
      videos={videos}
      preview={preview}
      referrer={normalizeReferrer(Array.isArray(ref) ? ref[0] : ref)}
    />
  );
}
