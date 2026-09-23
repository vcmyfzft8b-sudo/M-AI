"use client";

import { useT } from "@/components/i18n-provider";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { Msym } from "@/components/msym";
import { useInstantNavigation } from "@/components/navigation-loading";
import type { ReactNode } from "react";

/** A single help article, on the redesign's page chrome. */
export function SupportArticleScreen({
  category,
  title,
  content,
  backHref = "/app/support",
  children,
}: {
  category: string;
  title: string;
  content: string;
  backHref?: string;
  children?: ReactNode;
}) {
  const t = useT();
  const { navigateWithFeedback, overlay: navigationOverlay, isNavigating } = useInstantNavigation();

  return (
    <div className="memo-support-screen">
      {navigationOverlay}
      <div className="memo-settings-topbar memo-only-mobile flex">
        <button
          type="button"
          aria-label={t("common.back")}
          className="memo-m-round"
          aria-busy={isNavigating}
          onClick={() => navigateWithFeedback(backHref)}
        >
          <Msym name="arrow_back" size="1.5rem" fill={false} weight={500} />
        </button>
      </div>

      <div className="memo-screen-scroll">
        <div className="memo-page">
          <div className="memo-breadcrumb memo-only-desktop">
            <button type="button" aria-busy={isNavigating} onClick={() => navigateWithFeedback(backHref)}>
              {t("help.title")}
            </button>
            <Msym name="chevron_right" size="1.1rem" fill={false} weight={400} />
            <span className="memo-breadcrumb-current">{category}</span>
          </div>

          <h1 className="memo-article-title">{title}</h1>

          <div className="memo-help-intro memo-article-body">
            <MarkdownRenderer content={content} />
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
