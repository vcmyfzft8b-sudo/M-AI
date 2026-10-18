"use client";

import type { CSSProperties } from "react";

import { NotebookSpiral, Tape } from "@/components/paywall-notebook";
import { paywallAccentStyle } from "@/components/paywall-hero";
import type { PaywallReason } from "@/lib/paywall-reasons";

/**
 * A paywall while it loads: the notebook page itself, with pills where the
 * words go.
 *
 * Built from the paywall's own classes — the paper, the spiral, the close
 * row, the two sticky-note plans, the coral button — so every part lands where
 * the real one will and nothing moves when it arrives. Before this the route
 * fell back to the home screen's skeleton, so a tap on a locked feature
 * flashed a list of notes before the paywall. A feature's paywall is washed in
 * that feature's colour here too; which scene it draws is not known yet, so
 * the scene's place is held by a card and Memo.
 */
export function PaywallLoading({ reason = null }: { reason?: PaywallReason | null }) {
  return (
    <main className="app-start-shell" data-route-skeleton="" aria-busy="true">
      <section
        className="app-start-panel app-start-panel-paywall memo-paywall-shell memo-nb-paper memo-nb-skeleton"
        data-reason={reason ?? undefined}
        style={paywallAccentStyle(reason)}
        aria-hidden="true"
      >
        <NotebookSpiral />
        <div className="app-start-dismiss-row">
          <span className="memo-close-button app-start-close-button" />
        </div>

        <div className="memo-nb-skel-scene">
          <span className="memo-nb-skel-card">
            <Tape />
            <span className="app-loading-pill" style={{ width: "70%" }} />
            <span className="app-loading-pill" style={{ width: "90%" }} />
            <span className="app-loading-pill" style={{ width: "55%" }} />
          </span>
          <span className="memo-nb-skel-memo app-loading-pill" />
        </div>

        <div className="memo-nb-skel-title">
          <span className="app-loading-pill" style={{ width: "15rem" }} />
          <span className="app-loading-pill" style={{ width: "10rem" }} />
        </div>

        <div className="memo-nb-skel-checks">
          {[5.5, 6.5, 5].map((width, index) => (
            <span key={index} className="app-loading-pill" style={{ width: `${width}rem` }} />
          ))}
        </div>

        <div className="memo-nb-plans">
          {[0, 1].map((index) => (
            <span key={index} className="memo-nb-plan memo-nb-skel-plan" style={{ "--i": index } as CSSProperties}>
              <Tape tone="mint" />
              <span className="app-loading-pill" style={{ width: "4.5rem" }} />
              <span className="app-loading-pill memo-nb-skel-price" />
              <span className="app-loading-pill" style={{ width: "85%" }} />
            </span>
          ))}
        </div>

        {/* The plain paywall carries the trial's timeline; a feature's, one line. */}
        {reason ? (
          <span className="memo-nb-skel-due app-loading-pill" />
        ) : (
          <div className="memo-nb-skel-timeline">
            {[0, 1, 2].map((index) => (
              <span key={index}>
                <span className="app-loading-pill memo-nb-skel-dot" />
                <span className="app-loading-pill" style={{ width: "3.2rem" }} />
                <span className="app-loading-pill" style={{ width: "4.2rem", height: "0.6rem" }} />
              </span>
            ))}
          </div>
        )}

        <span className="memo-paywall-cta memo-nb-skel-cta" />
      </section>
    </main>
  );
}
