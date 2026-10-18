"use client";

import type { CSSProperties } from "react";

import { Tape } from "@/components/paywall-notebook";

/**
 * A plan's sticky note with pills for its words. Each pill sits in the line
 * the real note uses (its name, the struck old price, the price, the small
 * print), so the note is exactly as tall as the one that replaces it.
 */
export function PlanSkeleton({ index, discounted }: { index: number; discounted: boolean }) {
  return (
    <span className="memo-nb-plan memo-nb-skel-plan" style={{ "--i": index } as CSSProperties}>
      <Tape tone="mint" />
      <span className="memo-nb-plan-name">
        <span className="app-loading-pill memo-nb-skel-line" style={{ width: "4.5rem" }} />
      </span>
      {discounted ? (
        <span className="memo-nb-plan-was memo-nb-skel-was">
          <span className="app-loading-pill memo-nb-skel-line" style={{ width: "2.6rem" }} />
        </span>
      ) : null}
      <span className="memo-nb-plan-price">
        <span className="app-loading-pill memo-nb-skel-line" style={{ width: "6.2rem" }} />
      </span>
      <span className="memo-nb-plan-detail">
        <span className="app-loading-pill memo-nb-skel-line block" style={{ width: "90%" }} />
        {discounted ? <span className="app-loading-pill memo-nb-skel-line block" style={{ width: "60%" }} /> : null}
      </span>
    </span>
  );
}
