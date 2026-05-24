import type { CSSProperties } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { BrandLogo } from "@/components/brand-logo";
import { LandingLoadingLink } from "@/components/landing-loading-link";
import { LandingScrollReveal } from "@/components/landing-scroll-reveal";
import { LandingStoryPreview } from "@/components/landing-story-preview";
import { LanguageSwitcher } from "@/components/language-switcher";
import { getOptionalUser } from "@/lib/auth";
import { BRAND_NAME, SEO_BRAND_NAME, SEO_SITE_URL } from "@/lib/brand";
import {
  type AppLocale,
  getDictionary,
  getLocalizedPublicPath,
} from "@/lib/i18n";
import { hasPublicSupabaseEnv } from "@/lib/public-env";

function buildHomepageJsonLd(locale: AppLocale) {
  const dictionary = getDictionary(locale);

  return {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: SEO_BRAND_NAME,
    alternateName: BRAND_NAME,
    url: `${SEO_SITE_URL}${getLocalizedPublicPath(locale)}`,
    applicationCategory: "EducationalApplication",
    operatingSystem: "Web",
    inLanguage: locale === "cs-CZ" ? "cs" : "sl",
    description: dictionary.brand.seoDescription,
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "EUR",
    },
    featureList: dictionary.landing.featureCards.map((feature) => feature.title),
  };
}

export async function LandingPageContent({ locale }: { locale: AppLocale }) {
  const dictionary = getDictionary(locale);
  const landing = dictionary.landing;

  if (hasPublicSupabaseEnv) {
    const user = await getOptionalUser();
    if (user) {
      redirect("/app");
    }
  }

  return (
    <main className="landing-shell landing-public-page">
      <LandingScrollReveal />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(buildHomepageJsonLd(locale)).replace(/</g, "\\u003c"),
        }}
      />
      <header className="landing-public-nav">
        <Link href={getLocalizedPublicPath(locale)} className="landing-public-brand" aria-label={`${dictionary.common.home} ${BRAND_NAME}`}>
          <BrandLogo subtitle="" priority />
        </Link>
        <nav className="landing-public-links" aria-label={dictionary.appShell.mainNavigation}>
          <LanguageSwitcher compact />
          <LandingLoadingLink href="/auth/continue" className="landing-public-nav-cta">
            {landing.navCta}
          </LandingLoadingLink>
        </nav>
      </header>

      <section className="landing-public-hero" aria-labelledby="landing-public-title">
        <div className="landing-public-hero-inner">
          <div className="landing-public-hero-copy">
            <div className="landing-hero-proof" aria-label={landing.benefitsLabel}>
              <div className="landing-hero-proof-track">
                <div className="landing-hero-proof-group">
                  {landing.proofItems.map((item) => (
                    <span key={item}>{item}</span>
                  ))}
                </div>
                <div className="landing-hero-proof-group" aria-hidden="true">
                  {landing.proofItems.map((item) => (
                    <span key={item}>{item}</span>
                  ))}
                </div>
              </div>
            </div>
            <h1 id="landing-public-title">{landing.heroTitle}</h1>
            <p>{landing.heroCopy}</p>
            <div className="landing-public-actions">
              <LandingLoadingLink href="/auth/continue" className="landing-public-cta primary">
                {landing.primaryCta}
              </LandingLoadingLink>
              <LandingLoadingLink href="/auth/continue" className="landing-public-cta secondary">
                {landing.secondaryCta}
              </LandingLoadingLink>
            </div>
          </div>
          <LandingStoryPreview slides={landing.story.slides} labels={landing.story} />
        </div>
      </section>

      <section className="landing-public-section" aria-labelledby="landing-workflow-title">
        <div className="landing-public-section-heading" data-scroll-reveal>
          <p className="landing-section-pill">{landing.workflowEyebrow}</p>
          <h2 id="landing-workflow-title">{landing.workflowTitle}</h2>
        </div>

        <div className="landing-workflow-grid">
          {landing.workflowSteps.map((step, index) => (
            <article
              key={step.title}
              className="landing-workflow-item"
              data-scroll-reveal
              style={{ "--reveal-delay": `${index * 80}ms` } as CSSProperties}
            >
              <span className="landing-workflow-icon">{step.icon}</span>
              <h3>{step.title}</h3>
              <p>{step.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-public-section landing-feature-section" aria-labelledby="landing-feature-title">
        <div className="landing-public-section-heading" data-scroll-reveal>
          <p className="landing-section-pill">{landing.featuresEyebrow}</p>
          <h2 id="landing-feature-title">{landing.featuresTitle}</h2>
        </div>

        <div className="landing-feature-grid">
          {landing.featureCards.map((feature, index) => (
            <article
              key={feature.title}
              className="landing-feature-large-card"
              data-scroll-reveal
              style={{ "--reveal-delay": `${index * 55}ms` } as CSSProperties}
            >
              <span className="landing-feature-large-icon">{feature.icon}</span>
              <h3>{feature.title}</h3>
              <p>{feature.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-public-section" id="examples" aria-labelledby="landing-examples-title">
        <div className="landing-public-section-heading" data-scroll-reveal>
          <p className="landing-section-pill">{landing.examplesEyebrow}</p>
          <h2 id="landing-examples-title">{landing.examplesTitle}</h2>
        </div>

        <div className="landing-example-grid">
          {landing.studyExamples.map((example, index) => (
            <article
              key={example.label}
              className="landing-example-card"
              data-scroll-reveal
              style={{ "--reveal-delay": `${index * 70}ms` } as CSSProperties}
            >
              <p className="landing-example-label">{example.label}</p>
              <h3>{example.title}</h3>
              <p>{example.detail}</p>
              <span>{example.meta}</span>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
