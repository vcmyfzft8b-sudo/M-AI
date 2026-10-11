import Image from "next/image";
import type { ReactNode } from "react";

import { InstantLink } from "@/components/instant-link";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { creatorFont } from "@/components/ugc/creator-font";
import { BRAND_LOCKUP_HEIGHT, BRAND_LOCKUP_SRC, BRAND_LOCKUP_WIDTH, SEO_BRAND_NAME } from "@/lib/brand";

/**
 * The creator terms on the program's own chrome: the bar from the campaign page, the document in
 * a card, and whatever the page puts under it (the acceptance form on a join link).
 */
export function CreatorTermsView({
  label,
  homeHref,
  intro,
  markdown,
  children,
}: {
  label: string;
  /** The campaign page the logo goes back to. */
  homeHref: string;
  intro?: ReactNode;
  markdown: string;
  children?: ReactNode;
}) {
  return (
    <div className={`memo-cp memo-cp-terms-page ${creatorFont.className}`}>
      <header className="memo-cp-nav">
        <InstantLink href={homeHref} className="memo-cp-brand" aria-label={SEO_BRAND_NAME}>
          <Image
            src={BRAND_LOCKUP_SRC}
            alt={SEO_BRAND_NAME}
            width={BRAND_LOCKUP_WIDTH}
            height={BRAND_LOCKUP_HEIGHT}
            className="memo-cp-lockup"
            priority
          />
          <span className="memo-cp-brand-label">{label}</span>
        </InstantLink>
      </header>

      <div className="memo-cp-doc">
        {intro}
        <article className="memo-cp-card memo-cp-doc-body">
          <MarkdownRenderer content={markdown} />
        </article>
        {children}
      </div>
    </div>
  );
}
