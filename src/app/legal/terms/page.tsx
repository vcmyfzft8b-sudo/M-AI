import type { Metadata } from "next";
import Link from "next/link";

import { MarkdownRenderer } from "@/components/markdown-renderer";
import { BRAND_NAME, PUBLIC_PRIVACY_POLICY_PATH, PUBLIC_SUPPORT_PATH } from "@/lib/brand";
import { getHelpArticle } from "@/lib/help-center";

export const metadata: Metadata = {
  title: "Pogoji uporabe",
  alternates: {
    canonical: "/legal/terms",
  },
};

export default function PublicTermsOfUsePage() {
  const article = getHelpArticle("terms-of-use");
  const content = article?.content.replace(/^# .+\n+/, "") ?? "";

  return (
    <main className="legal-page">
      <nav className="legal-nav" aria-label="Pravne strani">
        <Link href="/">{BRAND_NAME}</Link>
        <span aria-hidden="true">/</span>
        <Link href={PUBLIC_SUPPORT_PATH}>Podpora</Link>
      </nav>

      <article className="legal-card">
        <p className="dashboard-overline">Pogoji</p>
        <h1>Pogoji uporabe</h1>
        <div className="markdown">
          <MarkdownRenderer content={content} />
        </div>
      </article>

      <div className="legal-link-grid">
        <Link href={PUBLIC_PRIVACY_POLICY_PATH}>Politika zasebnosti</Link>
        <Link href={PUBLIC_SUPPORT_PATH}>Kontakt in podpora</Link>
      </div>
    </main>
  );
}
