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
 * It is written to the document element rather than into React state so that
 * nothing re-renders per frame while the keyboard animates, and so portalled
 * sheets — which mount outside the app shell — inherit it too.
 */
export function KeyboardInset() {
  useEffect(() => {
    const viewport = window.visualViewport;

    if (!viewport) {
      return;
    }

    const root = document.documentElement;
    let previous = -1;

    const sync = () => {
      const inset = Math.max(
        0,
        Math.round(window.innerHeight - viewport.height - viewport.offsetTop),
      );

      if (inset === previous) {
        return;
      }

      previous = inset;
      root.style.setProperty("--memo-keyboard", `${inset}px`);
    };

    sync();
    viewport.addEventListener("resize", sync);
    viewport.addEventListener("scroll", sync);

    return () => {
      viewport.removeEventListener("resize", sync);
      viewport.removeEventListener("scroll", sync);
      root.style.removeProperty("--memo-keyboard");
    };
  }, []);

  return null;
}
