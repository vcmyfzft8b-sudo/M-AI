import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { BrandLogo } from "@/components/brand-logo";
import { LegalBackLink } from "@/components/legal-back-link";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { Msym } from "@/components/msym";
import { BRAND_NAME, SEO_BRAND_NAME } from "@/lib/brand";
import { getHelpArticle, splitArticleFinePrint } from "@/lib/help-center";
import { SOURCE_LOCALE, type Locale } from "@/lib/i18n/locales";
import { getLocale, getTranslations } from "@/lib/i18n/server";

/**
 * Public home for the legal documents. They also exist under /app/support, but
 * that whole tree sits behind requireUser(), so signed-out visitors following a
 * "Pogoji uporabe" link were bounced into onboarding. These routes live outside
 * /app and are deliberately limited to the documents below — no other help
 * article is reachable here.
 */
const PUBLIC_LEGAL_SLUGS = ["terms-of-use", "privacy-policy", "refund-policy"] as const;

function getPublicLegalArticle(slug: string, locale: Locale) {
  if (!PUBLIC_LEGAL_SLUGS.includes(slug as (typeof PUBLIC_LEGAL_SLUGS)[number])) {
    return null;
  }

  return getHelpArticle(slug, locale);
}

export function generateStaticParams() {
  return PUBLIC_LEGAL_SLUGS.map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const article = getPublicLegalArticle(slug, await getLocale());

  if (!article) {
    return {};
  }

  return {
    title: article.title,
    description: `${article.title} — ${SEO_BRAND_NAME}`,
    alternates: { canonical: `/legal/${article.slug}` },
  };
}

/**
 * A legal document on the app's own chrome rather than the landing page's.
 *
 * These pages are read inside the product far more often than from the
 * marketing site — from the sign-in card, from the iOS consent screen, from
 * Settings — and the landing bar they used to wear was a different design
 * altogether: a black CTA pill and a marketing lockup on a page that is
 * otherwise a help article. This is the same screen the in-app reader draws
 * (see `SupportArticleScreen`): the floating top row, one scroller, the title,
 * and the document in a card.
 *
 * It matters twice over in the iOS wrapper, whose web view runs edge to edge.
 * The landing bar was pinned to `top: 0` with no inset, so the lockup and the
 * CTA were drawn underneath the status bar and sliced in half by it. The phone
 * frame below reads `--memo-safe-top`, exactly as every other screen does.
 */
export default async function LegalPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { locale, t } = await getTranslations();
  const article = getPublicLegalArticle(slug, locale);

  if (!article) {
    notFound();
  }

  const content = article.content.replace(/^# .+\n+/, "");
  const { body, finePrint } = splitArticleFinePrint(content);
  const others = otherLegalArticles(article.slug, locale);

  return (
    /*
     * The `.memo` wrapper is not the screen: below the breakpoint the screen is
     * a fixed frame that starts under the status bar, and something has to
     * paint the strip above it — so the wrapper stays in normal flow and owns
     * the page background, exactly as the app shell does for every other
     * screen.
     */
    <main className="memo memo-legal">
      <div className="memo-legal-screen">
        <div className="memo-legal-topbar">
          <Link href="/" className="memo-legal-brand" aria-label={t("nav.homeBrand", { brand: BRAND_NAME })}>
            <BrandLogo subtitle="" priority />
          </Link>
          <LegalBackLink href="/" className="memo-legal-back">
            <Msym name="arrow_back" fill={false} weight={500} />
            <span className="memo-legal-back-label">{t("common.back")}</span>
          </LegalBackLink>
        </div>

        <div className="memo-screen-scroll">
          <article className="memo-page memo-legal-page">
            <h1 className="memo-article-title">{article.title}</h1>

            <div className="memo-help-intro memo-article-body memo-legal-body">
              <MarkdownRenderer content={body} />
            </div>

            {/* Named by the heading rather than by a repeat of it: an aria-label
                saying the same words made a screen reader announce "Other
                documents" twice, once for the landmark and once for the h2. */}
            <h2 id="legal-other-documents" className="memo-legal-more-heading">
              {t("legal.otherDocuments")}
            </h2>
            <nav className="memo-legal-more" aria-labelledby="legal-other-documents">
              {others.map((other) => (
                <Link key={other.slug} href={`/legal/${other.slug}`} className="memo-settings-row">
                  <span className="memo-settings-copy">
                    <span className="memo-settings-title">{other.title}</span>
                  </span>
                  <Msym name="chevron_right" fill={false} weight={400} />
                </Link>
              ))}
            </nav>

            {/*
              * Below the document, and only on a translation: these were drafted
              * in Slovenian, and a translated clause that reads slightly
              * differently must not be the one a dispute turns on. Saying so is
              * ordinary practice for multilingual terms and is what makes the
              * translations safe to publish.
              */}
            {finePrint || locale !== SOURCE_LOCALE ? (
              <aside className="memo-legal-fineprint">
                {finePrint ? <MarkdownRenderer content={finePrint} /> : null}
                {locale === SOURCE_LOCALE ? null : (
                  <p className="memo-legal-prevailing">{t("legal.prevailingNotice")}</p>
                )}
              </aside>
            ) : null}

            <p className="memo-legal-copyright">
              © {new Date().getFullYear()} {SEO_BRAND_NAME}
            </p>
          </article>
        </div>
      </div>
    </main>
  );
}

/** Every public legal document except the one being read, for the cross-links. */
function otherLegalArticles(currentSlug: string, locale: Locale) {
  return PUBLIC_LEGAL_SLUGS.filter((slug) => slug !== currentSlug)
    .map((slug) => getHelpArticle(slug, locale))
    .filter((article) => article !== null);
}
