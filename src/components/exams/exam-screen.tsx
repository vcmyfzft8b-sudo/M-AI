"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

import { Msym } from "@/components/msym";
import { useInstantNavigation } from "@/components/navigation-loading";
import { useT } from "@/components/i18n-provider";

/**
 * The frame every exam screen shares, built the way the app's other full screens are.
 *
 * Phone: a fixed `.memo-screen` with one scroller, a floating round back (or close) button and
 * the screen's name centred in the bar, and the `cta` pinned to the bottom.
 *
 * Desktop: the rail is the navigation, so a screen the rail opens (`backLabel` omitted) has no
 * back control at all, as Settings has none. A screen deeper than that gets a small labelled
 * link above its title that says where it goes ("← Izpiti"), rather than an unlabelled circle.
 * The `cta` sits under the content at its natural width, held at the bottom of the window while
 * the page scrolls; `ctaOnDesktop={false}` leaves it to the screen's own header instead.
 */
export function ExamScreen({
  backHref,
  backIcon = "arrow_back",
  backLabel,
  historyBack = false,
  refreshOnBack = false,
  title,
  trailing,
  cta,
  ctaOnDesktop = true,
  header,
  children,
  className,
}: {
  backHref: string;
  backIcon?: "arrow_back" | "close";
  /** The destination's name, shown on desktop. Omit on screens the rail itself opens. */
  backLabel?: string;
  /** Go back to wherever the learner came from when there is somewhere to go back to. */
  historyBack?: boolean;
  /**
   * Reload the screen it goes back to. Set it where the learner may have changed what that
   * screen shows (a lesson or mock was saved): the router keeps rendered pages for a minute.
   */
  refreshOnBack?: boolean;
  title?: string;
  trailing?: ReactNode;
  cta?: ReactNode;
  ctaOnDesktop?: boolean;
  /** Replaces the bar entirely, for a flow that draws its own (setup: back arrow + progress). */
  header?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const t = useT();
  const router = useRouter();
  const { navigateWithFeedback, overlay, isNavigating } = useInstantNavigation();

  function goBack() {
    if (historyBack && window.history.length > 1) {
      router.back();
      return;
    }

    navigateWithFeedback(backHref, refreshOnBack ? { refresh: true } : undefined);
  }

  return (
    <>
      {overlay}
      <div className={["memo-screen memo-exam-screen", className ?? ""].filter(Boolean).join(" ")}>
        {header ? <div className="memo-exam-topbar memo-exam-topbar-custom">{header}</div> : null}
        <div
          className={`memo-exam-topbar ${backLabel ? "" : "no-desktop-back"}`.trim()}
          hidden={Boolean(header)}
        >
          <button
            type="button"
            className="memo-close-button memo-exam-back-round"
            aria-label={backIcon === "close" ? t("common.close") : t("common.back")}
            aria-busy={isNavigating}
            onClick={goBack}
          >
            <Msym name={backIcon} size="1.45rem" fill={false} weight={500} />
          </button>
          {backLabel ? (
            <button type="button" className="memo-exam-crumb" aria-busy={isNavigating} onClick={goBack}>
              <Msym name="arrow_back" size="1.15rem" fill={false} weight={500} />
              <span>{backLabel}</span>
            </button>
          ) : null}
          {title ? <span className="memo-exam-topbar-title">{title}</span> : <span />}
          <span className="memo-exam-topbar-trailing">{trailing}</span>
        </div>

        <div className="memo-screen-scroll">
          <div className={`memo-page memo-exam-page ${cta ? "has-cta" : ""}`.trim()}>{children}</div>
        </div>

        {cta ? (
          <div className={`memo-exam-cta ${ctaOnDesktop ? "" : "phone-only"}`.trim()}>{cta}</div>
        ) : null}
      </div>
    </>
  );
}
