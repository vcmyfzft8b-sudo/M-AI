"use client";

import { useEffect } from "react";

import { readBottomEdgeColor, setThemeColorMeta } from "@/lib/browser-chrome-color";
import { subscribeToThemePreference } from "@/lib/theme";

/**
 * Settles the colour of the browser's own bottom bar.
 *
 * A page cannot set that colour. iOS 26 Safari ignores `theme-color` outright,
 * and picks the bar's tint one of two ways instead: by reading the page's pixels
 * once at load, or by following the document background colour. Which one wins
 * is not stable — the same build, page and device produced a black bar on one
 * load and a grey one on the next.
 *
 * So rather than trying to steer it, both inputs are given the same answer. The
 * `.browser-chrome-tint` strip in globals.css ends every screen on
 * --browser-bar-surface, and the document background is set to that same value
 * here. Whichever path Safari takes, it arrives at the colour the app already
 * ends on.
 *
 * `theme-color` is still kept in step with what the app actually paints at the
 * bottom, for the browsers that do read it: Chrome, older iOS Safari, and
 * installed web apps.
 */
export function BrowserChromeColor() {
  useEffect(() => {
    let frame = 0;

    function sample() {
      frame = 0;

      const color = readBottomEdgeColor();

      if (color) {
        setThemeColorMeta(color);
      }

      const barSurface = window
        .getComputedStyle(document.documentElement)
        .getPropertyValue("--browser-bar-surface")
        .trim();

      if (barSurface && document.documentElement.style.backgroundColor !== barSurface) {
        document.documentElement.style.backgroundColor = barSurface;
      }
    }

    // A frame is the natural granularity here: dragging a sheet fires a flood
    // of style mutations, and one sample per painted frame is plenty.
    function schedule() {
      if (frame) {
        return;
      }

      frame = window.requestAnimationFrame(sample);
    }

    sample();

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

  return <div className="browser-chrome-tint" aria-hidden="true" />;
}
