"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { Msym } from "@/components/msym";
import { useInstantNavigation } from "@/components/navigation-loading";
import { useT } from "@/components/i18n-provider";
import { cameFromAppPath } from "@/lib/app-history";

/*
 * The screen's bottom bar, for a part of the screen that owns its own buttons (a written answer's
 * "Preveri", the tutor's "Začni"): they render there, where every other screen's "Nadaljuj" sits,
 * rather than wherever the content happens to end.
 */
const ExamCtaSlot = createContext<{ slot: HTMLElement | null; open: boolean }>({ slot: null, open: false });

/**
 * Puts `children` in the screen's bottom bar. Until the bar has mounted (the first, server-drawn
 * frame) it draws nothing rather than drawing them inline and moving them a frame later; on a
 * screen whose bar holds its own buttons it draws them inline.
 */
export function ExamCta({ children }: { children: ReactNode }) {
  const { slot, open } = useContext(ExamCtaSlot);

  if (!open) {
    return <div className="memo-exam-cta-inline">{children}</div>;
  }

  return slot ? createPortal(children, slot) : null;
}

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
  /**
   * Step back rather than navigate when the page before this one, in this tab, was `backHref`'s:
   * the router then shows it as it was left. Arriving any other way (an e-mail link, a sign-in, a
   * reload) there is no page of ours behind, and stepping back would leave the app.
   */
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
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  const slotOpen = !cta;
  const ctaSlot = useMemo(() => ({ slot, open: slotOpen }), [slot, slotOpen]);

  function goBack() {
    if (historyBack && cameFromAppPath(backHref)) {
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
          <div className={`memo-page memo-exam-page ${cta ? "has-cta" : ""}`.trim()}>
            <ExamCtaSlot.Provider value={ctaSlot}>{children}</ExamCtaSlot.Provider>
          </div>
        </div>

        {cta ? (
          <div className={`memo-exam-cta ${ctaOnDesktop ? "" : "phone-only"}`.trim()}>{cta}</div>
        ) : (
          <div className="memo-exam-cta memo-exam-cta-slot" ref={setSlot} />
        )}
      </div>
    </>
  );
}
