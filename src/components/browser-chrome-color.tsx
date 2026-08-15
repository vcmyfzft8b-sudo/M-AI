"use client";

import { useEffect } from "react";

import { readBottomEdgeColor, setThemeColorMeta } from "@/lib/browser-chrome-color";
import { subscribeToThemePreference } from "@/lib/theme";

/**
 * Keeps `theme-color` on the colour the app paints at the bottom of the screen,
 * for the browsers that read it — Chrome, older iOS Safari, installed web apps.
 *
 * iOS 26's Safari toolbar ignores `theme-color` and takes its tint from what
 * the page paints in the last sliver of the viewport instead, and it reads that
 * once at page load: measured on iOS 26.5, re-painting, re-inserting, scrolling
 * and collapsing the toolbar all leave the tint where it was. So nothing here
 * can move that bar after load. `.browser-chrome-tint` in globals.css handles it
 * from the other side, by running the bottom of every screen into --canvas so
 * the bar only ever needs one colour.
 */
export function BrowserChromeColor() {
  useEffect(() => {
    let frame = 0;

    function sample() {
      frame = 0;

      const color = readBottomEdgeColor();

      if (!color) {
        return;
      }

      setThemeColorMeta(color);
      document.documentElement.style.backgroundColor = color;
    }

    // A frame is the natural granularity here: dragging a sheet fires a flood
    // of style mutations, and one sample per painted frame is plenty.
    function schedule() {
      if (frame) {
        return;
      }

      frame = window.requestAnimationFrame(sample);
    }

    // Safari starts following the document colour only once it changes after
    // load; before that it sits on whatever it read off the page's pixels. Nudge
    // it off its starting value so the first sample always counts as a change.
    // The document colour is never visible — body paints --canvas over its own
    // box — so the nudge cannot be seen.
    document.documentElement.style.backgroundColor = "#010101";
    schedule();

    const observer = new MutationObserver(schedule);
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class", "style", "hidden", "open", "data-theme"],
    });

    const colorSchemeQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const unsubscribeFromTheme = subscribeToThemePreference(schedule);
    // Sheets slide in and out, so re-sample once the motion has settled as well
    // as the moment the DOM changes.
    const domEvents = [
      "scroll",
      "resize",
      "orientationchange",
      "transitionend",
      "animationend",
      "visibilitychange",
      "pageshow",
    ];

    for (const event of domEvents) {
      window.addEventListener(event, schedule, { passive: true, capture: true });
    }

    colorSchemeQuery.addEventListener("change", schedule);
    window.visualViewport?.addEventListener("resize", schedule);

    return () => {
      if (frame) {
        window.cancelAnimationFrame(frame);
      }

      observer.disconnect();
      unsubscribeFromTheme();
      colorSchemeQuery.removeEventListener("change", schedule);
      window.visualViewport?.removeEventListener("resize", schedule);

      for (const event of domEvents) {
        window.removeEventListener(event, schedule, { capture: true });
      }
    };
  }, []);

  return null;
}
