import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { BrandLogo } from "@/components/brand-logo";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { BRAND_NAME, SEO_BRAND_NAME } from "@/lib/brand";
import { getHelpArticle, splitArticleFinePrint } from "@/lib/help-center";

/**
 * Public home for the legal documents. They also exist under /app/support, but
 * that whole tree sits behind requireUser(), so signed-out visitors following a
 * "Pogoji uporabe" link were bounced into onboarding. These routes live outside
 * /app and are deliberately limited to the documents below — no other help
 * article is reachable here.
 */
const PUBLIC_LEGAL_SLUGS = ["terms-of-use", "privacy-policy", "refund-policy"] as const;

function getPublicLegalArticle(slug: string) {
  if (!PUBLIC_LEGAL_SLUGS.includes(slug as (typeof PUBLIC_LEGAL_SLUGS)[number])) {
    return null;
  }

  return getHelpArticle(slug);
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
  const article = getPublicLegalArticle(slug);

  if (!article) {
    return {};
  }

  return {
    title: article.title,
    description: `${article.title} — ${SEO_BRAND_NAME}`,
    alternates: { canonical: `/legal/${article.slug}` },
  };
}

export default async function LegalPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const article = getPublicLegalArticle(slug);

  if (!article) {
    notFound();
  }

  const content = article.content.replace(/^# .+\n+/, "");
  const { body, finePrint } = splitArticleFinePrint(content);

  return (
    <main className="landing-shell landing-public-page">
      <header className="landing-public-nav">
        <Link href="/" className="landing-public-brand" aria-label={`Domov ${BRAND_NAME}`}>
          <BrandLogo subtitle="" priority />
        </Link>
        <nav className="landing-public-links" aria-label="Glavna navigacija">
          <Link href="/" className="landing-public-nav-cta">
            Nazaj na domačo stran
          </Link>
        </nav>
      </header>

      <article className="legal-page">
        <h1 className="legal-page-title">{article.title}</h1>
        <div className="legal-page-body markdown">
          <MarkdownRenderer content={body} />
        </div>
      </article>

      <footer className="landing-public-footer">
        <div className="landing-public-footer-bottom">
          <p>
            © {new Date().getFullYear()} {SEO_BRAND_NAME}
          </p>
          <p className="landing-public-footer-legal-links">
            {otherLegalArticles(article.slug).map((other) => (
              <Link key={other.slug} href={`/legal/${other.slug}`}>
                {other.title}
              </Link>
            ))}
          </p>
        </div>
      </footer>

      {finePrint ? (
        <aside className="legal-page-fineprint markdown">
          <MarkdownRenderer content={finePrint} />
        </aside>
      ) : null}
    </main>
  );
}

/** Every public legal document except the one being read, for the footer cross-links. */
function otherLegalArticles(currentSlug: string) {
  return PUBLIC_LEGAL_SLUGS.filter((slug) => slug !== currentSlug)
    .map((slug) => getHelpArticle(slug))
    .filter((article) => article !== null);
}
