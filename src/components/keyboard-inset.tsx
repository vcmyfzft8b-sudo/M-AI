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
    let published = 0;
    /** +1 while the keys are coming up, -1 while they are going away, 0 at rest. */
    let direction = 0;

    const measure = () =>
      Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop));

    const isTyping = () => {
      const active = document.activeElement;

      return (
        active instanceof HTMLElement &&
        (active.isContentEditable ||
          active instanceof HTMLInputElement ||
          active instanceof HTMLTextAreaElement ||
          active instanceof HTMLSelectElement)
      );
    };

    const sync = () => {
      const raw = measure();
      /*
       * The two halves of the measurement do not land on the same frame. While
       * the keyboard retracts, `height` can have grown back before `offsetTop`
       * has returned to zero, and the subtraction between them dips and
       * recovers — which the sheet followed faithfully, jumping down and up
       * again. A keyboard only travels one way at a time, so once a direction
       * is set the reading is held to it and the wobble never reaches the page.
       */
      const inset =
        direction > 0 ? Math.max(published, raw) : direction < 0 ? Math.min(published, raw) : raw;
      const height = Math.round(viewport.height);
      const top = Math.max(0, Math.round(viewport.offsetTop));
      const next = `${inset}/${height}/${top}`;

      if (next === previous) {
        return false;
      }

      previous = next;
      published = inset;
      root.style.setProperty("--memo-keyboard", `${inset}px`);
      root.style.setProperty("--memo-viewport", `${height}px`);
      root.style.setProperty("--memo-viewport-top", `${top}px`);
      return true;
    };

    /*
     * Whether to leave a field its clearance above the keys.
     *
     * Focus alone said yes the instant you tapped the field and no the instant
     * you left it — so on the way out the clearance vanished in one step while
     * the keys were still halfway down the screen, which is the jump you saw.
     * It stays on until the viewport has finished moving as well.
     *
     * Focus has to be part of it because the inset cannot carry this on its
     * own: mobile Safari shrinks the layout viewport to sit above the keys, so
     * there the inset is legitimately 0 the whole time the keyboard is up.
     */
    const publishUp = () => {
      const up = isTyping() || direction !== 0 || published > 0 ? 1 : 0;
      root.style.setProperty("--memo-keyboard-up", `${up}`);
    };

    /*
     * iOS reports the viewport while the keyboard animates, but not on every
     * frame — so a sheet driven straight off those events moves in steps. A
     * CSS transition was the first answer and the wrong one: it cannot know the
     * keyboard's duration or curve, so it lagged behind the keys on the way up
     * and carried on after they had gone on the way down, and it animated
     * padding, which lays the sheet out again every frame.
     *
     * Sampling the viewport each frame instead means the sheet is driven by the
     * keyboard's own movement rather than an imitation of it: it tracks exactly,
     * at whatever the display refreshes at. The loop runs only while the number
     * is still moving and stops once it has held for a few frames, so it costs
     * nothing at rest.
     */
    let frame = 0;
    let settled = 0;

    const follow = () => {
      const moved = sync();
      settled = moved ? 0 : settled + 1;

      if (settled < 5) {
        // ~5 frames of stillness is the keyboard having arrived, not a pause.
        frame = requestAnimationFrame(follow);
        publishUp();
        return;
      }

      frame = 0;
      direction = 0;
      publishUp();
    };

    const track = () => {
      if (!frame) {
        // Which way this run is going, decided once and held for its duration.
        direction = Math.sign(measure() - published);
        settled = 0;
        frame = requestAnimationFrame(follow);
      }

      sync();
      publishUp();
    };

    sync();
    publishUp();
    viewport.addEventListener("resize", track);
    viewport.addEventListener("scroll", track);
    document.addEventListener("focusin", track);
    document.addEventListener("focusout", track);

    return () => {
      if (frame) {
        cancelAnimationFrame(frame);
      }

      viewport.removeEventListener("resize", track);
      viewport.removeEventListener("scroll", track);
      document.removeEventListener("focusin", track);
      document.removeEventListener("focusout", track);
      root.style.removeProperty("--memo-keyboard-up");
      root.style.removeProperty("--memo-keyboard");
      root.style.removeProperty("--memo-viewport");
      root.style.removeProperty("--memo-viewport-top");
    };
  }, []);

  return null;
}
