"use client";

import { useCallback, useEffect, useRef } from "react";

/** The fade plays out over the first 80px of scroll, as in the design. */
const RANGE_PX = 80;

/**
 * The phone library header, whose title fades out as it scrolls away. The
 * search field below it does not fold; it scrolls off at its full size.
 *
 * Progress is published as `--memo-head-p` (0 → 1) on the screen element
 * rather than held in React state — the header moves every frame, and
 * re-rendering the whole note list alongside it would be the one thing that
 * makes this stutter. Everything the value drives is expressed in CSS.
 *
 * Nothing here resizes and nothing is pinned: animating heights would change
 * the scroll metrics, which feeds back into the scroll position and makes the
 * header fight the scroller. Both elements simply scroll away with the list;
 * the fade is decoration on top of that.
 *
 * The header does not snap to either end of the range, either. Writing
 * `scrollTop` once the finger is gone reads as the list lurching on its own a
 * beat after you let go, which is worse than a title caught half-faded — and
 * a half-faded title is all that is left to look wrong now that the search
 * field no longer folds.
 */
export function useCollapsingHeader() {
  const scrollRef = useRef<HTMLElement | null>(null);
  const screenRef = useRef<HTMLElement | null>(null);
  const frameRef = useRef<number | null>(null);

  const publish = useCallback(() => {
    frameRef.current = null;

    const scroller = scrollRef.current;
    const screen = screenRef.current;

    if (!scroller || !screen) {
      return;
    }

    const progress = Math.max(0, Math.min(1, scroller.scrollTop / RANGE_PX));
    screen.style.setProperty("--memo-head-p", progress.toFixed(4));
  }, []);

  /* One style write per frame at most: the scroll event fires faster than the
     compositor draws, and the extra writes would all be thrown away. */
  const onScroll = useCallback(() => {
    if (frameRef.current === null) {
      frameRef.current = requestAnimationFrame(publish);
    }
  }, [publish]);

  useEffect(
    () => () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
      }
    },
    [],
  );

  const attachScroll = useCallback(
    (node: HTMLElement | null) => {
      const previous = scrollRef.current;

      if (previous && previous !== node) {
        previous.removeEventListener("scroll", onScroll);
      }

      scrollRef.current = node;

      if (node) {
        node.addEventListener("scroll", onScroll, { passive: true });
        publish();
      }
    },
    [onScroll, publish],
  );

  const attachScreen = useCallback(
    (node: HTMLElement | null) => {
      screenRef.current = node;
      publish();
    },
    [publish],
  );

  return { attachScroll, attachScreen };
}
