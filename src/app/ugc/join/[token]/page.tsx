import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { I18nProvider } from "@/components/i18n-provider";
import { CreatorJoinForm } from "@/components/ugc/creator-join-form";
import { CreatorTermsView } from "@/components/ugc/creator-terms-view";
import { getMessages } from "@/lib/i18n/messages";
import { getTranslations, getTranslationsFor } from "@/lib/i18n/server";
import { CREATOR_CAMPAIGN_PATHS, CREATOR_DISCORD_INVITES } from "@/lib/ugc/creator-campaigns";
import { loadSignable, signableTerms } from "@/lib/ugc/creator-signing.server";
import { CREATOR_TERMS_VERSION } from "@/lib/ugc/creator-terms";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const signable = await loadSignable((await params).token);
  const t = signable ? getTranslationsFor(signable.locale) : (await getTranslations()).t;

  // A personal link: never indexed, never sent on as a referrer.
  return {
    title: t(signable?.kind === "contract" ? "ugcContract.metaTitle" : "ugcJoin.metaTitle"),
    robots: { index: false, follow: false },
    referrer: "no-referrer",
  };
}

/**
 * A creator's personal link from their email: an accepted applicant joining their
 * campaign, or a creator already in the program signing the contract with their own pay.
 *
 * Opens on the signing card (one tap, `/api/ugc/join`), with the full Terms of
 * Participation below. An applicant gets the campaign's Discord invite once signed; the
 * invite is only in the page after that.
 */
export default async function CreatorJoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const signable = await loadSignable(token);

  if (!signable) {
    notFound();
  }

  const { market, locale } = signable;
  const contract = signable.kind === "contract";
  const t = getTranslationsFor(locale);

  return (
    <I18nProvider locale={locale} messages={getMessages(locale)} persist={false}>
      <CreatorTermsView
        label={t("ugcApply.navLabel")}
        homeHref={CREATOR_CAMPAIGN_PATHS[market]}
        markdown={signableTerms(signable)}
        intro={
          <>
            <div className="memo-cp-head memo-cp-doc-head">
              <h1 className="memo-cp-title">{t(contract ? "ugcContract.title" : "ugcJoin.title")}</h1>
              <p className="memo-cp-lead">
                {contract
                  ? t("ugcContract.lead")
                  : t("ugcJoin.lead", { campaign: t(market === "si" ? "ugcApply.market.si" : "ugcApply.market.balkans") })}
              </p>
            </div>
            <CreatorJoinForm
              token={token}
              version={CREATOR_TERMS_VERSION}
              defaultName={signable.fullName}
              needsGuardian={signable.minor}
              kind={signable.kind}
              accepted={
                signable.acceptedAt
                  ? { at: signable.acceptedAt, discordUrl: contract ? null : CREATOR_DISCORD_INVITES[market] }
                  : null
              }
            />
          </>
        }
      />
    </I18nProvider>
  );
}
