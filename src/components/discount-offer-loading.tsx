"use client";

import { useLayoutEffect, useRef } from "react";

import { useT } from "@/components/i18n-provider";
import { MemoPortal } from "@/components/memo-portal";
import { HAND_FONT, NotebookSpiral, Ticket } from "@/components/paywall-notebook";
import { PlanSkeleton } from "@/components/paywall-plan-skeleton";
import { useFitScreen } from "@/components/use-fit-screen";

/** Compact levels the wheel's and the offer's pages may step down to (`redesign.css`). */
export const SHEET_FIT_LEVELS = 4;

/**
 * Whether a skeleton below was on screen when the sheet it stands for
 * arrived. The sheet then takes its place as it stands, without opening a
 * second time: the skeleton already opened (`discount-offer.tsx`).
 */
export const discountOfferSkeleton = { shown: false };

/**
 * The daily wheel's page, or the prize's offer sheet, while its code loads.
 *
 * The sheet is fetched on demand (`home-dashboard.tsx`), and until it came the
 * screen showed only the thin progress bar at the top. These are the same
 * pages built from their own classes — the paper, the spiral, the close
 * button, the wheel on its stand, the dynamite timer, the coupon, the two
 * sticky-note plans, the coral button — with pills where the words go and the
 * real headline set in the page's ink, so nothing moves when the page lands.
 */
export function DiscountOfferLoading({ sheet, restored = false }: { sheet: "wheel" | "offer"; restored?: boolean }) {
  const t = useT();
  const bodyRef = useRef<HTMLDivElement | null>(null);
  useFitScreen(bodyRef, SHEET_FIT_LEVELS);

  useLayoutEffect(() => {
    discountOfferSkeleton.shown = true;
    // The sheet reads this as it first renders, before this cleanup runs; a
    // skeleton closed before its sheet came must not leave the next one
    // opening without its entrance.
    return () => {
      discountOfferSkeleton.shown = false;
    };
  }, []);

  return (
    <MemoPortal>
      <div className="memo-scrim" aria-hidden="true" />
      {sheet === "wheel" ? (
        <div className={`memo-sheet-full memo-wheel-sheet memo-nb-paper memo-nb-skeleton ${HAND_FONT.variable}`} role="status" aria-busy="true" aria-label={t("common.loading")}>
          <NotebookSpiral />
          <div className="memo-wheel-close-row">
            <span className="memo-close-button" />
          </div>

          <div className="memo-wheel-body" ref={bodyRef} aria-hidden="true">
            <h1 className="memo-wheel-title memo-nb-title memo-nb-ghost-text">
              <span>{t("offer.wheelTitle").replaceAll("*", "")}</span>
            </h1>
            {/* The squiggle under the headline: its room, undrawn. */}
            <svg className="memo-wheel-squiggle" width="150" height="16" viewBox="0 0 150 16" />
            <p className="memo-wheel-sub memo-nb-ghost-text">
              <span className="memo-nb-ghost-line">{t("offer.wheelIdle")}</span>
            </p>

            <div className="memo-wheel">
              <span className="app-loading-pill memo-nb-ghost memo-nb-skel-disc" />
              <span className="memo-nb-stand" />
              <span className="app-loading-pill memo-nb-ghost memo-nb-skel-cheer" />
            </div>

            {/* Unseen until a win on the real page, but it holds its room. */}
            <div className="memo-wheel-prize memo-nb-off">
              <p>{t("offer.prizeAmount")}</p>
              <p>{t("offer.prizeCaption")}</p>
            </div>

            <p className="memo-nb-tap">
              <span className="app-loading-pill" style={{ width: "6rem", height: "1.1rem" }} />
            </p>

            <span className="memo-nb-cta memo-wheel-cta memo-nb-skel-cta" />
          </div>
        </div>
      ) : (
        <div className={`memo-sheet-full memo-offer-sheet memo-nb-paper memo-nb-skeleton ${HAND_FONT.variable}${restored ? " restored" : ""}`} role="status" aria-busy="true" aria-label={t("common.loading")}>
          <div className="memo-grab-wide">
            <span className="light" />
          </div>
          <div className="memo-offer-head">
            <span className="memo-offer-close" />
          </div>

          <div className="memo-offer-body" ref={bodyRef} aria-hidden="true">
            <div className="memo-nb-tnt">
              <span className="app-loading-pill memo-nb-ghost memo-nb-skel-tnt" />
            </div>

            <div className="memo-nb-skel-ticket memo-nb-ghost-text">
              <Ticket percent={50} off={t("paywall.offer.off")} note={t("paywall.offer.firstPayment")} />
            </div>
            <h1 className="memo-nb-title memo-nb-ghost-text">
              <span>{t("offer.prizeTitle").replaceAll("*", "")}</span>
            </h1>

            <div className="memo-offer-plans">
              <div className="memo-nb-plans">
                <PlanSkeleton index={0} discounted />
                <PlanSkeleton index={1} discounted />
              </div>
              <span className="memo-nb-cta memo-offer-cta memo-nb-skel-cta" />
              <p className="memo-offer-fine memo-nb-ghost-text">
                <span className="memo-nb-ghost-line">{t("offer.fine")}</span>
              </p>
            </div>
          </div>
        </div>
      )}
    </MemoPortal>
  );
}
