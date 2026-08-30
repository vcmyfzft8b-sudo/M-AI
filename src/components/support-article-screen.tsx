"use client";

import { useRouter } from "next/navigation";

import { MarkdownRenderer } from "@/components/markdown-renderer";
import { Msym } from "@/components/msym";

/** A single help article, on the redesign's page chrome. */
export function SupportArticleScreen({
  category,
  title,
  content,
  backHref = "/app/support",
}: {
  category: string;
  title: string;
  content: string;
  backHref?: string;
}) {
  const router = useRouter();

  return (
    <div className="memo-support-screen">
      <div className="memo-settings-topbar memo-only-mobile flex">
        <button
          type="button"
          aria-label="Nazaj"
          className="memo-m-round"
          onClick={() => router.push(backHref)}
        >
          <Msym name="arrow_back" size="1.5rem" fill={false} weight={500} />
        </button>
      </div>

      <div className="memo-page">
        <div className="memo-breadcrumb memo-only-desktop">
          <button type="button" onClick={() => router.push(backHref)}>
            Pomoč
          </button>
          <Msym name="chevron_right" size="1.1rem" fill={false} weight={400} />
          <span className="memo-breadcrumb-current">{category}</span>
        </div>

        <h1 className="memo-article-title">{title}</h1>

        <div className="memo-help-intro memo-article-body">
          <MarkdownRenderer content={content} />
        </div>
      </div>
    </div>
  );
}
