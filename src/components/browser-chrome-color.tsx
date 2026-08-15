"use client";

import { useEffect } from "react";

import {
  toComparableHex,
  readBottomEdgeColor,
  setThemeColorMeta,
} from "@/lib/browser-chrome-color";
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
 * So rather than trying to steer it, both inputs are given the same answer, per
 * screen. A screen showing nothing but the app's own background leaves both on
 * the canvas colour, and the bar comes out black in dark mode. A screen with a
 * sheet up puts --browser-bar-surface on the document and shades the last sliver
 * of the page into it, and the bar comes out on that raised tint. Whichever path
 * Safari takes, it arrives at the colour the app already ends on.
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

      const styles = window.getComputedStyle(document.documentElement);
      const canvas = styles.getPropertyValue("--canvas").trim();
      const barSurface = styles.getPropertyValue("--browser-bar-surface").trim();

      // Anything other than the plain canvas at the bottom means something is
      // raised over the page — a sheet, in practice. Safari's own reading of the
      // document colour makes the same distinction: it keeps the bar black for
      // the canvas and lifts it to one fixed tint for anything else, so there is
      // no point handing it the sheet's exact colour.
      const raised = Boolean(color) && color !== toComparableHex(canvas);
      const next = raised ? barSurface : canvas;

      document.documentElement.classList.toggle("browser-bar-raised", raised);

      if (next && document.documentElement.style.backgroundColor !== next) {
        document.documentElement.style.backgroundColor = next;
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
