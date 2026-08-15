"use client";

import { useEffect } from "react";

import { readBottomEdgeColor, setThemeColorMeta } from "@/lib/browser-chrome-color";
import { subscribeToThemePreference } from "@/lib/theme";

/**
 * Makes the browser's own chrome take on the colour the app paints at the
 * bottom of the screen, so a sheet that runs to the bottom flows into the
 * browser bar instead of ending in a seam.
 *
 * Two things are needed, because browsers disagree on where that colour comes
 * from. `theme-color` covers the ones that read it (Chrome, older iOS Safari,
 * installed web apps). iOS 26's floating Safari toolbar ignores it and
 * instead takes on whatever the page paints in the last sliver of the viewport
 * — hence the tint strip, which simply continues the bottom-most colour into
 * that sliver. It is invisible in the page itself: it is painted in the exact
 * colour of what sits underneath it.
 */
export function BrowserChromeColor() {
  useEffect(() => {
    let frame = 0;
    const tint = document.createElement("div");
    tint.className = "browser-chrome-tint";
    tint.setAttribute("aria-hidden", "true");
    document.body.appendChild(tint);

    function sample() {
      frame = 0;

      const color = readBottomEdgeColor();

      if (!color) {
        return;
      }

      setThemeColorMeta(color);

      if (tint.style.backgroundColor !== color) {
        tint.style.backgroundColor = color;
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

      tint.remove();
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
