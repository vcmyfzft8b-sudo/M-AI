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
 * Past the last level it scrolls rather than clip anything.
 */
export function fitToScreen(element: HTMLElement | null, levels: number) {
  if (!element) {
    return;
  }

  for (let level = 0; level <= levels; level += 1) {
    element.dataset.fit = String(level);

    if (element.scrollHeight <= element.clientHeight) {
      return;
    }
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
      const observer = new ResizeObserver(refit);
      observer.observe(element);
      void document.fonts?.ready.then(refit);
      watched.current = { element, observer };
    }
  });

  useEffect(() => () => watched.current?.observer.disconnect(), []);
}
