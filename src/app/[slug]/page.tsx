import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { BrandLogo } from "@/components/brand-logo";
import { LandingLoadingLink } from "@/components/landing-loading-link";
import { BRAND_NAME, SEO_BRAND_NAME } from "@/lib/brand";
import {
  getSeoBreadcrumbJsonLd,
  getSeoPublicPage,
  getSeoSoftwareJsonLd,
  SEO_PUBLIC_PAGES,
} from "@/lib/seo-pages";

type SeoPageProps = {
  params: Promise<{
    slug: string;
  }>;
};

export function generateStaticParams() {
  return SEO_PUBLIC_PAGES.map((page) => ({
    slug: page.slug,
  }));
}

export async function generateMetadata({ params }: SeoPageProps): Promise<Metadata> {
  const { slug } = await params;
  const page = getSeoPublicPage(slug);

  if (!page) {
    return {};
  }

  return {
    title: page.title,
    description: page.description,
    alternates: {
      canonical: `/${page.slug}`,
    },
    openGraph: {
      title: `${page.title} | ${SEO_BRAND_NAME}`,
      description: page.description,
      url: `/${page.slug}`,
      siteName: SEO_BRAND_NAME,
      locale: "sl_SI",
      type: "website",
    },
    twitter: {
      card: "summary",
      title: `${page.title} | ${SEO_BRAND_NAME}`,
      description: page.description,
    },
  };
}

export default async function SeoPublicPage({ params }: SeoPageProps) {
  const { slug } = await params;
  const page = getSeoPublicPage(slug);

  if (!page) {
    notFound();
  }

  const jsonLd = [getSeoSoftwareJsonLd(page), getSeoBreadcrumbJsonLd(page)];

  return (
    <main className="landing-shell landing-public-page seo-public-page">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c"),
        }}
      />
      <header className="landing-public-nav">
        <Link href="/" className="landing-public-brand" aria-label={`Domov ${BRAND_NAME}`}>
          <BrandLogo subtitle="" priority />
        </Link>
        <nav className="landing-public-links" aria-label="Glavna navigacija">
          <Link href="/">Domov</Link>
          <LandingLoadingLink href="/auth/continue" className="landing-public-nav-cta">
            Preizkusi za 0 €
          </LandingLoadingLink>
        </nav>
      </header>

      <section className="seo-public-hero" aria-labelledby="seo-public-title">
        <div className="seo-public-hero-copy">
          <p className="landing-section-pill">{page.eyebrow}</p>
          <h1 id="seo-public-title">{page.h1}</h1>
          <p>{page.intro}</p>
          <div className="landing-public-actions">
            <LandingLoadingLink href="/auth/continue" className="landing-public-cta primary">
              {page.ctaLabel}
            </LandingLoadingLink>
            <Link href="/" className="landing-public-cta secondary">
              Poglej Memo AI
            </Link>
          </div>
        </div>

        <aside className="seo-public-summary" aria-label="Kaj Memo ustvari">
          <p>{page.primaryKeyword}</p>
          <ul>
            {page.outputs.slice(0, 5).map((output) => (
              <li key={output}>{output}</li>
            ))}
          </ul>
        </aside>
      </section>

      <section className="landing-public-section seo-public-section" aria-labelledby="seo-use-cases-title">
        <div className="landing-public-section-heading">
          <p className="landing-section-pill">Za študente</p>
          <h2 id="seo-use-cases-title">Kdaj je uporabno?</h2>
        </div>
        <div className="seo-public-grid">
          {page.useCases.map((useCase) => (
            <article key={useCase} className="seo-public-card">
              <h3>{useCase}</h3>
              <p>
                Memo AI ohrani povezavo med izvorno snovjo, zapiski in vajami, zato lahko isto
                gradivo uporabiš za branje, ponavljanje in vprašanja.
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-public-section seo-public-section" aria-labelledby="seo-inputs-title">
        <div className="seo-public-columns">
          <div>
            <p className="landing-section-pill">Viri</p>
            <h2 id="seo-inputs-title">Kaj lahko naložiš?</h2>
            <ul className="seo-public-list">
              {page.inputs.map((input) => (
                <li key={input}>{input}</li>
              ))}
            </ul>
          </div>

          <div>
            <p className="landing-section-pill">Rezultati</p>
            <h2>Kaj dobiš?</h2>
            <ul className="seo-public-list">
              {page.outputs.map((output) => (
                <li key={output}>{output}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="landing-public-section seo-public-section" aria-labelledby="seo-keywords-title">
        <div className="seo-public-keywords">
          <div>
            <p className="landing-section-pill">Iskanja</p>
            <h2 id="seo-keywords-title">Memo pokriva povezane načine iskanja</h2>
          </div>
          <div className="seo-public-keyword-list">
            {page.searchTerms.map((term) => (
              <span key={term}>{term}</span>
            ))}
          </div>
        </div>
      </section>

      <section className="landing-public-section seo-public-section" aria-labelledby="seo-consent-title">
        <div className="seo-public-note">
          <h2 id="seo-consent-title">Pomembno pri snemanju in gradivu</h2>
          <p>{page.consentNote}</p>
        </div>
      </section>

      <section className="seo-public-final-cta" aria-labelledby="seo-final-cta-title">
        <h2 id="seo-final-cta-title">Preizkusi {SEO_BRAND_NAME} na svojem gradivu</h2>
        <p>
          Začni z enim predavanjem, PDF-jem ali besedilom in preveri, kako hitro lahko iz snovi
          dobiš zapiske, flashcarde, kvize in AI chat.
        </p>
        <LandingLoadingLink href="/auth/continue" className="landing-public-cta primary">
          Preizkusi za 0 €
        </LandingLoadingLink>
      </section>

    </main>
  );
}
