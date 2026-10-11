import type { Metadata } from "next";

import { I18nProvider } from "@/components/i18n-provider";
import { CreatorProgram } from "@/components/ugc/creator-program";
import { CreatorTermsView } from "@/components/ugc/creator-terms-view";
import { SEO_SITE_URL } from "@/lib/brand";
import { getMessages } from "@/lib/i18n/messages";
import { getTranslationsFor } from "@/lib/i18n/server";
import { normalizeReferrer } from "@/lib/ugc/creator-application";
import { CREATOR_CAMPAIGN_PATHS, CREATOR_TERMS, CREATOR_TERMS_PATHS } from "@/lib/ugc/creator-campaigns";
import { campaignPageLocale, guardCampaignPage } from "@/lib/ugc/creator-market.server";
import type { CreatorMarket } from "@/lib/ugc/creator-program";
import { getShowcaseVideos } from "@/lib/ugc/creator-showcase";
import { creatorTermsMarkdown } from "@/lib/ugc/creator-terms";

/**
 * The two campaign pages, `/ugc/slovenija` and `/ugc/balkan`, and their terms. Each is
 * one campaign in one language: Slovenian for Slovenia, the visitor's Balkan language
 * (Croatian by default) for the Balkans, with no language switch, so nothing on one page
 * leads to the other. A visitor whose IP belongs to the other campaign is redirected to
 * their own (`guardCampaignPage`). See docs/ugc-creator-program.md.
 */

type SearchParams = Promise<{ ref?: string | string[] }>;

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export async function creatorCampaignMetadata(market: CreatorMarket): Promise<Metadata> {
  const t = getTranslationsFor(await campaignPageLocale(market));
  const title = t("ugcApply.metaTitle");
  const description = t("ugcApply.metaDescription");
  const path = CREATOR_CAMPAIGN_PATHS[market];

  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { title, description, url: `${SEO_SITE_URL}${path}`, type: "website" },
    twitter: { card: "summary_large_image", title, description },
  };
}

/**
 * `?ref=` tags a shared link (`?ref=instagram-story`) and is stored with each
 * application, so the admin can tell which post brought whom. It survives the redirect.
 */
export async function CreatorCampaignPage({ market, searchParams }: { market: CreatorMarket; searchParams: SearchParams }) {
  const referrer = normalizeReferrer(first((await searchParams).ref));
  const query = new URLSearchParams(referrer ? { ref: referrer } : {});
  const { preview } = await guardCampaignPage(market, { query });
  const [locale, videos] = await Promise.all([campaignPageLocale(market), getShowcaseVideos()]);

  return (
    <I18nProvider locale={locale} messages={getMessages(locale)} persist={false}>
      <CreatorProgram
        market={market}
        terms={CREATOR_TERMS[market]}
        termsHref={CREATOR_TERMS_PATHS[market]}
        videos={videos}
        preview={preview}
        referrer={referrer}
      />
    </I18nProvider>
  );
}

export async function creatorTermsMetadata(market: CreatorMarket): Promise<Metadata> {
  const t = getTranslationsFor(await campaignPageLocale(market));

  return { title: t("ugcApply.termsLink"), alternates: { canonical: CREATOR_TERMS_PATHS[market] } };
}

/** A campaign's Terms of Participation, guarded like its page. */
export async function CreatorCampaignTerms({ market }: { market: CreatorMarket }) {
  await guardCampaignPage(market, { paths: CREATOR_TERMS_PATHS });
  const locale = await campaignPageLocale(market);
  const t = getTranslationsFor(locale);

  return (
    <CreatorTermsView
      label={t("ugcApply.navLabel")}
      homeHref={CREATOR_CAMPAIGN_PATHS[market]}
      markdown={creatorTermsMarkdown(locale, market)}
    />
  );
}
