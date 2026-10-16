"use client";

import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

/**
 * Steps a screen down through compact levels (`data-fit` on the element, one
 * level per number up to `levels`) until it needs no scrolling, so a paywall
 * or an offer sheet is one screen on any phone, in any language.
 *
 * The element must be the scroller whose overflow decides. It runs before paint
 * after every render, so no level is ever seen, and again when the element
 * changes size and once the fonts have loaded, which changes how tall text sets.
 * Past the last level everything shrinks together; only a screen too short even
 * for half size (a phone on its side) is left to scroll (`data-fit-scroll`).
 */
export function fitToScreen(element: HTMLElement | null, levels: number) {
  if (!element) {
    return;
  }

  // Self-contained on purpose: `fitScreenScript` sends this very function to
  // the page as text, so it may use nothing from outside itself.
  element.style.removeProperty("--fit-squeeze");
  delete element.dataset.fitScroll;

  for (let level = 0; level <= levels; level += 1) {
    element.dataset.fit = String(level);

    if (element.scrollHeight <= element.clientHeight) {
      return;
    }
  }

  // Past the last level, everything on the screen shrinks together by just
  // enough, so it is still one screen: the screen never scrolls.
  let squeeze = 1;

  for (let pass = 0; pass < 6 && element.scrollHeight > element.clientHeight; pass += 1) {
    squeeze = Math.max(0.5, squeeze * (element.clientHeight / element.scrollHeight) - 0.005);
    element.style.setProperty("--fit-squeeze", String(squeeze));
  }

  // Never clip what cannot be reached: the shell scrolls again rather than hide
  // the button below the edge.
  if (element.scrollHeight > element.clientHeight) {
    element.dataset.fitScroll = "";
  }
}

export function useFitScreen(ref: RefObject<HTMLElement | null>, levels: number) {
  // The element being watched: a sheet's body appears and goes as it opens and
  // closes, so it is picked up whenever it changes, not only on mount.
  const watched = useRef<{ element: HTMLElement; observer: ResizeObserver } | null>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    fitToScreen(element, levels);

    if (watched.current?.element === element) {
      return;
    }

    watched.current?.observer.disconnect();
    watched.current = null;

    if (element) {
      const refit = () => fitToScreen(element, levels);
      // The screen and what is on it: a stylesheet or an image arriving late
      // grows the content without resizing the screen.
      const observer = new ResizeObserver(refit);
      observer.observe(element);
      for (const child of Array.from(element.children)) {
        observer.observe(child);
      }
      void document.fonts?.ready.then(refit);
      watched.current = { element, observer };
    }
  });

  useEffect(() => () => watched.current?.observer.disconnect(), []);
}

/**
 * The same steps as `fitToScreen`, as a script the server puts right after the
 * element, so a page loaded fresh is fitted as it is first drawn rather than
 * once the app has started. It runs after the stylesheets, as scripts in the
 * page do; the app's own fitting takes over from there.
 */
export function fitScreenScript(levels: number) {
  return `(${fitToScreen.toString()})(document.currentScript && document.currentScript.previousElementSibling, ${levels})`;
}
