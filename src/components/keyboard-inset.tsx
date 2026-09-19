"use client";

import { useEffect } from "react";

/**
 * Publishes the soft keyboard's height as `--memo-keyboard` on the document
 * element, which the phone layer reads through `--memo-kb`.
 *
 * The whole redesign layer is already written against that variable — sheets
 * are `inset: auto 0 var(--memo-kb) 0`, screen shells end at it, and every
 * sheet's `max-height` subtracts it — but nothing was ever setting it, so on a
 * phone the keyboard simply covered whatever was anchored to the bottom.
 *
 * `visualViewport` shrinks by exactly the keyboard's height, which is the
 * design's own measurement:
 *
 *     kb = innerHeight - visualViewport.height - visualViewport.offsetTop
 *
 * `offsetTop` is in there because iOS scrolls the visual viewport within the
 * layout viewport when a field near the bottom is focused; without it the
 * inset reads short by however far it scrolled.
 *
 * Two more measurements go with it, because the inset alone cannot place a
 * sheet on every browser. Mobile Safari does not shrink the layout viewport
 * when the keys come up — it keeps it at its full height and *pans* the visual
 * viewport within it — so a sheet on the bottom edge lands correctly (the
 * inset really is 0 there) while anything measured against the layout viewport
 * is measured against a screen far taller than the one you can see. The sheet
 * was allowed to be 428pt tall inside 404pt of visible screen and hung its
 * header 24pt off the top.
 *
 *   --memo-viewport      what is actually visible, top to bottom
 *   --memo-viewport-top  how far the visible area has been panned down
 *
 * There is no CSS unit for either: `dvh` answers for browser chrome, `%` for
 * the containing block, and both are the layout viewport.
 *
 * All three are written to the document element rather than into React state so
 * that nothing re-renders per frame while the keyboard animates, and so
 * portalled sheets — which mount outside the app shell — inherit them too.
 */
export function KeyboardInset() {
  useEffect(() => {
    const viewport = window.visualViewport;

    if (!viewport) {
      return;
    }

    const root = document.documentElement;
    let previous = "";

    const sync = () => {
      const inset = Math.max(
        0,
        Math.round(window.innerHeight - viewport.height - viewport.offsetTop),
      );
      const height = Math.round(viewport.height);
      const top = Math.max(0, Math.round(viewport.offsetTop));
      const next = `${inset}/${height}/${top}`;

      if (next === previous) {
        return;
      }

      previous = next;
      root.style.setProperty("--memo-keyboard", `${inset}px`);
      root.style.setProperty("--memo-viewport", `${height}px`);
      root.style.setProperty("--memo-viewport-top", `${top}px`);
    };

    sync();
    viewport.addEventListener("resize", sync);
    viewport.addEventListener("scroll", sync);

    return () => {
      viewport.removeEventListener("resize", sync);
      viewport.removeEventListener("scroll", sync);
      root.style.removeProperty("--memo-keyboard");
      root.style.removeProperty("--memo-viewport");
      root.style.removeProperty("--memo-viewport-top");
    };
  }, []);

  return null;
}
