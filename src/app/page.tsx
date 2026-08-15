import type { Metadata } from "next";
import { Inter_Tight } from "next/font/google";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";

import { LandingFaq } from "@/components/landing/landing-faq";
import { LandingFeatureShowcase } from "@/components/landing/landing-feature-showcase";
import { LandingFlowDemo } from "@/components/landing/landing-flow-demo";
import { LandingNav } from "@/components/landing/landing-nav";
import { LandingTryCallout } from "@/components/landing/landing-try-callout";
import { LandingUserCount } from "@/components/landing/landing-user-count";
import { MemoAppPreview } from "@/components/landing/memo-app-preview";
import { LandingLoadingLink } from "@/components/landing-loading-link";
import { LandingScrollReveal } from "@/components/landing-scroll-reveal";
import { getOptionalUser } from "@/lib/auth";
import {
  BRAND_LOCKUP_HEIGHT,
  BRAND_LOCKUP_SRC,
  BRAND_LOCKUP_WIDTH,
  BRAND_NAME,
  BRAND_SUPPORT_EMAIL,
  BRAND_TAGLINE,
  SEO_BRAND_NAME,
  SEO_SITE_DESCRIPTION,
  SEO_SITE_URL,
} from "@/lib/brand";
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

const HOMEPAGE_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: SEO_BRAND_NAME,
  alternateName: BRAND_NAME,
  url: `${SEO_SITE_URL}/`,
  applicationCategory: "EducationalApplication",
  operatingSystem: "Web",
  inLanguage: "sl",
  description: SEO_SITE_DESCRIPTION,
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "EUR",
  },
  featureList: [
    "AI zapiski predavanj",
    "Prepisi audio posnetkov",
    "Povzetki iz PDF-jev in dokumentov",
    "Flashcardi iz zapiskov",
    "Kvizi in testi za učenje",
    "AI klepet z gradivom",
  ],
};

export default async function HomePage() {
  if (hasPublicSupabaseEnv) {
    const user = await getOptionalUser();
    if (user) {
      redirect("/app");
    }
  }

  return (
    <main className={`landing-v2 ${interTight.variable}`}>
      <LandingScrollReveal />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(HOMEPAGE_JSON_LD).replace(/</g, "\\u003c"),
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
                {HERO_AVATARS.map((src) => (
                  <Image key={src} src={src} alt="" width={56} height={56} />
                ))}
              </span>
              <LandingUserCount />
            </p>
            <h1 id="landing-public-title" className="landing-v2-hero-title">
              Nikoli več ne piši zapiskov!
            </h1>
            <p className="landing-v2-hero-lead">
              Memo AI je tvoj AI notetaker za predavanja. Iz audio posnetkov, PDF-jev, dokumentov in
              povezav pripravi zapiske, prepise, flashcarde, kvize, teste in AI chat.
            </p>
            <div className="landing-v2-hero-actions">
              <LandingLoadingLink href="/auth/continue" className="landing-cta landing-cta-hero landing-cta-light">
                Preizkusi za 0 €
              </LandingLoadingLink>
              <LandingLoadingLink href="/auth/continue" className="landing-cta landing-cta-hero landing-cta-dark">
                Prijavi se
              </LandingLoadingLink>
            </div>
          </div>

          <div className="landing-v2-hero-preview" aria-label={`Predogled aplikacije ${SEO_BRAND_NAME}`}>
            <LandingTryCallout />
            <MemoAppPreview />
          </div>
        </div>
      </section>

      <section className="landing-v2-section" aria-labelledby="landing-workflow-title">
        <div className="landing-v2-section-head landing-v2-section-head-center" data-scroll-reveal="">
          <h2 id="landing-workflow-title" className="landing-v2-section-title">
            Memo AI vse poenostavi.
          </h2>
        </div>
        <LandingFlowDemo />
      </section>

      <section className="landing-v2-section" aria-labelledby="landing-feature-title">
        <div className="landing-v2-section-head" data-scroll-reveal="">
          <h2 id="landing-feature-title" className="landing-v2-section-title">
            Zajemi, uredi in se uči hitreje
          </h2>
        </div>
        <LandingFeatureShowcase />
      </section>

      <section id="examples" className="landing-v2-section" aria-labelledby="landing-faq-title">
        <div className="landing-v2-section-head" data-scroll-reveal="" style={{ marginBottom: "2.75rem" }}>
          <h2 id="landing-faq-title" className="landing-v2-section-title">
            Pogosta vprašanja
          </h2>
        </div>

        <LandingFaq />

        <div className="landing-v2-final-cta" data-scroll-reveal="">
          <h2>Naloži prvo predavanje.</h2>
          <p className="landing-v2-final-cta-lead">
            Uro dolgo predavanje je obdelano v nekaj minutah – prepis, zapiski, flashcarde in kviz
            nastanejo skupaj.
          </p>
          <LandingLoadingLink href="/auth/continue" className="landing-cta landing-cta-hero landing-cta-light">
            Preizkusi za 0 €
          </LandingLoadingLink>
          <p className="landing-v2-final-cta-note">3 dni brezplačno · plačaš šele, če nadaljuješ</p>
          <ul className="landing-v2-final-cta-points">
            <li>Deluje v slovenščini</li>
            <li>Zvok, PDF, dokumenti in povezave</li>
            <li>Posnetki ostanejo tvoji</li>
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
            <p>{BRAND_TAGLINE}</p>
          </div>

          <nav className="landing-v2-footer-nav" aria-label="Noga">
            <div className="landing-v2-footer-group">
              <h2>Podpora</h2>
              <a href={`mailto:${BRAND_SUPPORT_EMAIL}`}>{BRAND_SUPPORT_EMAIL}</a>
              <Link href="/legal/terms-of-use">Pogoji uporabe</Link>
              <Link href="/legal/privacy-policy">Politika zasebnosti</Link>
              <Link href="/legal/refund-policy">Politika vračil</Link>
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
