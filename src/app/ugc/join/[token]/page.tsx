import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";

import { I18nProvider } from "@/components/i18n-provider";
import { CreatorJoinForm } from "@/components/ugc/creator-join-form";
import { CreatorTermsView } from "@/components/ugc/creator-terms-view";
import type { UgcCreatorApplicationRow } from "@/lib/database.types";
import { getMessages } from "@/lib/i18n/messages";
import { getTranslations, getTranslationsFor } from "@/lib/i18n/server";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { CREATOR_CAMPAIGN_PATHS, CREATOR_DISCORD_INVITES } from "@/lib/ugc/creator-campaigns";
import { campaignLocale } from "@/lib/ugc/creator-program";
import { CREATOR_TERMS_VERSION, creatorTermsMarkdown } from "@/lib/ugc/creator-terms";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const application = await loadApplication((await params).token);
  const t = application ? getTranslationsFor(campaignLocale(application.market, application.locale)) : (await getTranslations()).t;

  // A personal link: never indexed, never sent on as a referrer.
  return { title: t("ugcJoin.metaTitle"), robots: { index: false, follow: false }, referrer: "no-referrer" };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The accepted application behind a join link, or `null` for anything else. */
const loadApplication = cache(async function loadApplication(
  token: string,
): Promise<(UgcCreatorApplicationRow & { market: "si" | "balkans" }) | null> {
  if (!UUID.test(token)) {
    return null;
  }

  const { data } = await createSupabaseServiceRoleClient()
    .from("ugc_creator_applications")
    .select("*")
    .eq("join_token", token)
    .maybeSingle();
  const application = data as UgcCreatorApplicationRow | null;

  return application?.status === "approved" && (application.market === "si" || application.market === "balkans")
    ? (application as UgcCreatorApplicationRow & { market: "si" | "balkans" })
    : null;
});

/**
 * An accepted creator's personal join link, from the acceptance email.
 *
 * Shows the Terms of Participation with their campaign's pay; accepting them (the form,
 * `/api/ugc/join`) concludes the agreement and hands over the Discord invite. The invite
 * is only in the page once the terms are accepted.
 */
export default async function CreatorJoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const application = await loadApplication(token);

  if (!application) {
    notFound();
  }

  const market = application.market;
  const accepted = application.terms_accepted_at;
  // The campaign's own language, like its page: Slovenian, or the creator's Balkan language.
  const locale = campaignLocale(market, application.locale);
  const t = getTranslationsFor(locale);

  return (
    <I18nProvider locale={locale} messages={getMessages(locale)} persist={false}>
    <CreatorTermsView
      label={t("ugcApply.navLabel")}
      homeHref={CREATOR_CAMPAIGN_PATHS[market]}
      markdown={creatorTermsMarkdown(locale, market)}
      intro={
        <>
          <div className="memo-cp-head memo-cp-doc-head">
            <h1 className="memo-cp-title">{t("ugcJoin.title")}</h1>
            <p className="memo-cp-lead">
              {t("ugcJoin.lead", { campaign: t(market === "si" ? "ugcApply.market.si" : "ugcApply.market.balkans") })}
            </p>
          </div>
          <CreatorJoinForm
            token={token}
            version={CREATOR_TERMS_VERSION}
            defaultName={application.full_name}
            needsGuardian={application.age !== null && application.age < 18}
            accepted={accepted ? { at: accepted, discordUrl: CREATOR_DISCORD_INVITES[market] } : null}
          />
        </>
      }
    />
    </I18nProvider>
  );
}
