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
  return `(function(){var e=document.currentScript&&document.currentScript.previousElementSibling;if(!e)return;for(var l=0;l<=${levels};l++){e.setAttribute("data-fit",String(l));if(e.scrollHeight<=e.clientHeight)break}})()`;
}
