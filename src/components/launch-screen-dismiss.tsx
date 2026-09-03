"use client";

import { useEffect } from "react";

/**
 * Ends the launch screen, by marking the document launched. The fade itself is
 * CSS keyed off `[data-launched]` — see redesign.css.
 *
 * An attribute on <html> rather than unmounting the element: the theme script
 * in the layout already writes to this element, React never owns its
 * attributes, and a launch screen that is removed from the tree the moment the
 * app hydrates cannot fade out.
 *
 * The moment chosen is one frame after hydration. Hydration is the first point
 * at which the app is genuinely running, and the frame after it is the first
 * one whose paint includes whatever hydration produced — so the screen
 * underneath is finished before the one on top of it starts to go. The timeout
 * is for the case where that frame never comes: a backgrounded tab does not run
 * `requestAnimationFrame`, and a launch screen that outlives the launch is a
 * worse bug than the one this fixes.
 */
export function LaunchScreenDismiss() {
  useEffect(() => {
    const launched = () => {
      document.documentElement.dataset.launched = "";
    };

    const frame = requestAnimationFrame(launched);
    const fallback = window.setTimeout(launched, 400);

    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(fallback);
    };
  }, []);

  return null;
}
