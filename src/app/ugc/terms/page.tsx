import type { Metadata } from "next";

import { CreatorTermsView } from "@/components/ugc/creator-terms-view";
import { getTranslations } from "@/lib/i18n/server";
import { resolveCreatorMarket } from "@/lib/ugc/creator-market.server";
import { creatorTermsMarkdown } from "@/lib/ugc/creator-terms";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslations();

  return { title: t("ugcApply.termsLink"), alternates: { canonical: "/ugc/terms" } };
}

/** The creator terms for the visitor's own campaign, decided like `/ugc`. */
export default async function CreatorTermsPage({
  searchParams,
}: {
  searchParams: Promise<{ market?: string | string[] }>;
}) {
  const [{ locale, t }, { market: requested }] = await Promise.all([getTranslations(), searchParams]);
  const { market } = await resolveCreatorMarket(requested);

  return <CreatorTermsView label={t("ugcApply.navLabel")} markdown={creatorTermsMarkdown(locale, market)} />;
}
