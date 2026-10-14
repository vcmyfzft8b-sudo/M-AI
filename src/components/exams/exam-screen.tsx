"use client";

import type { ReactNode } from "react";

import { Msym } from "@/components/msym";
import { useInstantNavigation } from "@/components/navigation-loading";
import { useT } from "@/components/i18n-provider";

/**
 * The frame every exam screen shares, built the way the app's other full screens are: on the
 * phone a fixed `.memo-screen` with one scroller and a floating top bar, on desktop a page in the
 * shell's main column. An optional `cta` is pinned to the bottom on the phone and sits under the
 * content on desktop.
 */
export function ExamScreen({
  backHref,
  backIcon = "arrow_back",
  title,
  trailing,
  cta,
  children,
  className,
}: {
  backHref: string;
  backIcon?: "arrow_back" | "close";
  title?: string;
  trailing?: ReactNode;
  cta?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const t = useT();
  const { navigateWithFeedback, overlay, isNavigating } = useInstantNavigation();

  return (
    <>
      {overlay}
      <div className={["memo-screen memo-exam-screen", className ?? ""].filter(Boolean).join(" ")}>
        <div className="memo-exam-topbar">
          <button
            type="button"
            className="memo-close-button"
            aria-label={backIcon === "close" ? t("common.close") : t("common.back")}
            aria-busy={isNavigating}
            onClick={() => navigateWithFeedback(backHref)}
          >
            <Msym name={backIcon} size="1.45rem" fill={false} weight={500} />
          </button>
          {title ? <span className="memo-exam-topbar-title">{title}</span> : <span />}
          <span className="memo-exam-topbar-trailing">{trailing}</span>
        </div>

        <div className="memo-screen-scroll">
          <div className={`memo-page memo-exam-page ${cta ? "has-cta" : ""}`.trim()}>{children}</div>
        </div>

        {cta ? <div className="memo-exam-cta">{cta}</div> : null}
      </div>
    </>
  );
}
