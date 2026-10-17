import type { ReactNode } from "react";

import { AnimatedLockup } from "@/components/animated-lockup";
import { InstantLink } from "@/components/instant-link";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { creatorFont } from "@/components/ugc/creator-font";
import { SEO_BRAND_NAME } from "@/lib/brand";

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
          <AnimatedLockup className="memo-cp-lockup" priority />
          <span className="memo-cp-brand-label">{label}</span>
        </InstantLink>
      </header>

      <div className="memo-cp-doc">
        {intro}
        <article className="memo-cp-card memo-cp-doc-body" id="terms">
          <MarkdownRenderer content={markdown} />
        </article>
        {children}
      </div>
    </div>
  );
}
