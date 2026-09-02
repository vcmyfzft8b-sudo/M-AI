import type { Metadata } from "next";
import { Inter_Tight } from "next/font/google";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";

import { LandingFaq } from "@/components/landing/landing-faq";
import { LandingFeatureShowcase } from "@/components/landing/landing-feature-showcase";
import { LandingFlowDemo } from "@/components/landing/landing-flow-demo";
import { LandingGiveawayBoard } from "@/components/landing/landing-giveaway";
import { GiveawayPhone } from "@/components/giveaway-phone";
import { LandingNav } from "@/components/landing/landing-nav";
import { LandingTryCallout } from "@/components/landing/landing-try-callout";
import { LandingUserCount } from "@/components/landing/landing-user-count";
import { MemoAppPreview } from "@/components/landing/memo-app-preview";
import { LandingLoadingLink } from "@/components/landing-loading-link";
import { LandingScrollReveal } from "@/components/landing-scroll-reveal";
import { getOptionalUser } from "@/lib/auth";
import { getGiveawayLeaderboard, readGiveawayReferralCookie } from "@/lib/giveaway";
import { GIVEAWAY_GOAL, GIVEAWAY_PRIZE_NAME } from "@/lib/giveaway-shared";
import {
  BRAND_LOCKUP_HEIGHT,
  BRAND_LOCKUP_SRC,
  BRAND_LOCKUP_WIDTH,
  BRAND_NAME,
  BRAND_SUPPORT_EMAIL,
  SEO_BRAND_NAME,
  SEO_SITE_URL,
} from "@/lib/brand";
import { getTranslations } from "@/lib/i18n/server";
import type { MessageKey } from "@/lib/i18n/messages/keys";
import { hasPublicSupabaseEnv } from "@/lib/public-env";

import "./landing.css";

const interTight = Inter_Tight({
  subsets: ["latin", "latin-ext"], // latin-ext carries č/š/ž
  display: "swap",
  variable: "--font-inter-tight",
});

/* Photos of real Memo AI users, used with their permission. Anyone replacing
   these needs the same: consent from the person shown, not a stock or
   generated face — the banner presents them as actual users. */
const HERO_AVATARS = ["/avatars/student-1.jpg", "/avatars/student-3.jpg", "/avatars/student-2.jpg"];

export const metadata: Metadata = {
  alternates: {
    canonical: "/",
  },
};

/**
 * The structured description search engines read. Built per request rather
 * than once at module load, because `inLanguage`, the description and the
 * feature list all follow the language this visitor is being served.
 */
function buildHomepageJsonLd(locale: string, t: (key: MessageKey) => string) {
  return {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: SEO_BRAND_NAME,
    alternateName: BRAND_NAME,
    url: `${SEO_SITE_URL}/`,
    applicationCategory: "EducationalApplication",
    operatingSystem: "Web",
    inLanguage: locale,
    description: t("meta.description"),
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "EUR",
    },
    featureList: [
      t("landing.seo.featureNotes"),
      t("landing.seo.featureTranscripts"),
      t("landing.seo.featureSummaries"),
      t("landing.seo.featureFlashcards"),
      t("landing.seo.featureQuizzes"),
      t("landing.seo.featureChat"),
    ],
  };
}

export default async function HomePage() {
  if (hasPublicSupabaseEnv) {
    const user = await getOptionalUser();
    if (user) {
      redirect("/app");
    }
  }

  const { locale, t } = await getTranslations();

  /*
   * The giveaway standings, server-rendered so the section is complete on
   * the first paint; the board then polls on its own. A failure here is an
   * empty board, not a broken landing page.
   */
  const [leaderboard, referralCode] = await Promise.all([
    getGiveawayLeaderboard({ fallbackName: t("giveaway.anonymous") }).catch(() => null),
    readGiveawayReferralCookie().catch(() => null),
  ]);

  return (
    <main className={`landing-v2 ${interTight.variable}`}>
      <LandingScrollReveal />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(buildHomepageJsonLd(locale, t)).replace(/</g, "\\u003c"),
        }}
      />

      <LandingNav />

      <section id="top" className="landing-v2-hero" aria-labelledby="landing-public-title">
        <div className="landing-v2-hero-inner">
          <div className="landing-v2-hero-copy">
            <p className="landing-v2-hero-banner">
              {/* Decorative: the count beside them carries the meaning, so
                  screen readers get the sentence and skip the portraits. */}
              <span className="landing-v2-hero-banner-avatars" aria-hidden="true">
                {/* Eager and prioritised: they sit in the hero, and lazily
                    loaded portraits left three empty rings on first paint. */}
                {HERO_AVATARS.map((src) => (
                  <Image key={src} src={src} alt="" width={56} height={56} priority />
                ))}
              </span>
              <LandingUserCount />
            </p>
            <h1 id="landing-public-title" className="landing-v2-hero-title">
              {t("landing.hero.title")}
            </h1>
            <p className="landing-v2-hero-lead">{t("landing.hero.lead")}</p>
            <div className="landing-v2-hero-actions">
              <LandingLoadingLink href="/auth/continue" className="landing-cta landing-cta-hero landing-cta-light">
                {t("landing.cta.tryFree")}
              </LandingLoadingLink>
              <LandingLoadingLink href="/auth/continue" className="landing-cta landing-cta-hero landing-cta-dark">
                {t("landing.cta.signIn")}
              </LandingLoadingLink>
            </div>
            {/* A friend's code arrived with this visitor: say so where they
                are looking, and that there is nothing to type. */}
            {referralCode ? (
              <p className="landing-v2-hero-referral" role="status">
                <span aria-hidden="true">🎁</span>
                {t("landing.giveaway.referralBanner", { code: referralCode })}
              </p>
            ) : null}
          </div>

          <div
            className="landing-v2-hero-preview"
            aria-label={t("landing.hero.previewLabel", { brand: SEO_BRAND_NAME })}
          >
            <LandingTryCallout />
            <MemoAppPreview />
          </div>
        </div>
      </section>

      <section id="giveaway" className="landing-v2-section landing-v2-giveaway" aria-labelledby="landing-giveaway-title">
        <div className="landing-v2-giveaway-card" data-scroll-reveal="">
          <div className="landing-v2-giveaway-copy">
            <p className="landing-v2-giveaway-eyebrow">{t("landing.giveaway.eyebrow")}</p>
            <h2 id="landing-giveaway-title" className="landing-v2-giveaway-title">
              {t("landing.giveaway.title", { prize: GIVEAWAY_PRIZE_NAME })}
            </h2>
            <p className="landing-v2-giveaway-lead">
              {t("landing.giveaway.lead", { goal: GIVEAWAY_GOAL, prize: GIVEAWAY_PRIZE_NAME })}
            </p>

            <ol className="landing-v2-giveaway-steps">
              {(
                [
                  ["landing.giveaway.step1Title", "landing.giveaway.step1"],
                  ["landing.giveaway.step2Title", "landing.giveaway.step2"],
                  ["landing.giveaway.step3Title", "landing.giveaway.step3"],
                ] as const
              ).map(([titleKey, copyKey], index) => (
                <li key={titleKey}>
                  <span className="landing-v2-giveaway-step" aria-hidden="true">
                    {index + 1}
                  </span>
                  <span>
                    <strong>{t(titleKey, { goal: GIVEAWAY_GOAL })}</strong>
                    <span>{t(copyKey, { goal: GIVEAWAY_GOAL })}</span>
                  </span>
                </li>
              ))}
            </ol>

            <LandingLoadingLink href="/auth/continue" className="landing-cta landing-cta-hero landing-cta-light">
              {t("landing.giveaway.cta")}
            </LandingLoadingLink>
          </div>

          <div className="landing-v2-giveaway-prize">
            <GiveawayPhone
              scale={0.62}
              note={{
                title: t("giveaway.phone.noteTitle"),
                body: t("giveaway.phone.noteBody", { goal: GIVEAWAY_GOAL }),
              }}
            />
            <span className="landing-v2-giveaway-prize-tag">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/giveaway/trophy.png" alt="" width={64} height={64} />
              {t("giveaway.prize.tag", { goal: GIVEAWAY_GOAL })}
            </span>
          </div>
        </div>

        {leaderboard ? (
          <div className="landing-v2-giveaway-boardwrap" data-scroll-reveal="">
            <LandingGiveawayBoard initial={leaderboard} />
          </div>
        ) : null}
      </section>

      <section id="how-it-works" className="landing-v2-section" aria-labelledby="landing-workflow-title">
        <div className="landing-v2-section-head landing-v2-section-head-center" data-scroll-reveal="">
          <h2 id="landing-workflow-title" className="landing-v2-section-title">
            {t("landing.workflow.title")}
          </h2>
        </div>
        <LandingFlowDemo />
      </section>

      <section id="features" className="landing-v2-section" aria-labelledby="landing-feature-title">
        <div className="landing-v2-section-head" data-scroll-reveal="">
          <h2 id="landing-feature-title" className="landing-v2-section-title">
            {t("landing.features.title")}
          </h2>
        </div>
        <LandingFeatureShowcase />
      </section>

      <section id="faq" className="landing-v2-section" aria-labelledby="landing-faq-title">
        <div className="landing-v2-section-head" data-scroll-reveal="" style={{ marginBottom: "2.75rem" }}>
          <h2 id="landing-faq-title" className="landing-v2-section-title">
            {t("landing.faq.title")}
          </h2>
        </div>

        <LandingFaq />

        <div className="landing-v2-final-cta" data-scroll-reveal="">
          <h2>{t("landing.finalCta.title")}</h2>
          <p className="landing-v2-final-cta-lead">{t("landing.finalCta.lead")}</p>
          <LandingLoadingLink href="/auth/continue" className="landing-cta landing-cta-hero landing-cta-light">
            {t("landing.cta.tryFree")}
          </LandingLoadingLink>
          <p className="landing-v2-final-cta-note">{t("landing.finalCta.note")}</p>
          <ul className="landing-v2-final-cta-points">
            <li>{t("landing.finalCta.pointLanguage")}</li>
            <li>{t("landing.finalCta.pointSources")}</li>
            <li>{t("landing.finalCta.pointOwnership")}</li>
          </ul>
        </div>
      </section>

      <footer className="landing-v2-footer">
        <div className="landing-v2-footer-top">
          <div className="landing-v2-footer-brand">
            <span className="landing-v2-lockup">
              <Image
                src={BRAND_LOCKUP_SRC}
                alt={SEO_BRAND_NAME}
                width={BRAND_LOCKUP_WIDTH}
                height={BRAND_LOCKUP_HEIGHT}
              />
            </span>
            <p>{t("meta.tagline")}</p>
          </div>

          <nav className="landing-v2-footer-nav" aria-label={t("landing.footer.label")}>
            <div className="landing-v2-footer-group">
              <h2>{t("landing.footer.support")}</h2>
              <a href={`mailto:${BRAND_SUPPORT_EMAIL}`}>{BRAND_SUPPORT_EMAIL}</a>
              <Link href="/legal/terms-of-use">{t("landing.footer.terms")}</Link>
              <Link href="/legal/privacy-policy">{t("landing.footer.privacy")}</Link>
              <Link href="/legal/refund-policy">{t("landing.footer.refunds")}</Link>
            </div>
          </nav>
        </div>

        <div className="landing-v2-footer-bottom">
          <p>
            © {new Date().getFullYear()} {SEO_BRAND_NAME}
          </p>
        </div>
      </footer>
    </main>
  );
}
