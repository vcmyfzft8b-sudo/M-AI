import type { Metadata } from "next";
import Link from "next/link";

import { MarkdownRenderer } from "@/components/markdown-renderer";
import { BRAND_NAME, PUBLIC_SUPPORT_PATH, PUBLIC_TERMS_OF_USE_PATH } from "@/lib/brand";
import { getHelpArticle } from "@/lib/help-center";

export const metadata: Metadata = {
  title: "Politika zasebnosti",
  alternates: {
    canonical: "/legal/privacy",
  },
};

export default function PublicPrivacyPolicyPage() {
  const article = getHelpArticle("privacy-policy");
  const content = article?.content.replace(/^# .+\n+/, "") ?? "";

  return (
    <main className="legal-page">
      <nav className="legal-nav" aria-label="Pravne strani">
        <Link href="/">{BRAND_NAME}</Link>
        <span aria-hidden="true">/</span>
        <Link href={PUBLIC_SUPPORT_PATH}>Podpora</Link>
      </nav>

      <article className="legal-card">
        <p className="dashboard-overline">Zasebnost</p>
        <h1>Politika zasebnosti</h1>
        <div className="markdown">
          <MarkdownRenderer content={content} />
        </div>
      </article>

      <div className="legal-link-grid">
        <Link href={PUBLIC_TERMS_OF_USE_PATH}>Pogoji uporabe</Link>
        <Link href={PUBLIC_SUPPORT_PATH}>Kontakt in podpora</Link>
      </div>
    </main>
  );
}
