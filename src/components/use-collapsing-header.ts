"use client";

import { useCallback, useEffect, useRef } from "react";

/** The collapse plays out over the first 80px of scroll, as in the design. */
const RANGE_PX = 80;

/** Past this the header settles closed rather than open. */
const SNAP_MIDPOINT_PX = 32;

/** ~8 still frames (~130ms) means momentum and any animation have finished. */
const STABLE_FRAMES = 8;

const SNAP_DURATION_MS = 260;

/**
 * The phone library header, which folds as it scrolls away: the title fades
 * out and the search field collapses from its top edge.
 *
 * Progress is published as `--memo-head-p` (0 → 1) on the screen element
 * rather than held in React state — the header moves every frame, and
 * re-rendering the whole note list alongside it would be the one thing that
 * makes this stutter. Everything the value drives is expressed in CSS.
 *
 * The collapse is transform-only for the same reason it is in the design:
 * animating heights would change the scroll metrics, which feeds back into
 * the scroll position and makes the header fight the scroller. Both elements
 * simply scroll away with the list; the fold is decoration on top of that.
 *
 * On release the header settles to whichever end is nearer, so a scroll that
 * stops mid-range does not leave it frozen half-folded. A finger back on the
 * list cancels that, since animating under a live gesture fights it.
 */
export function useCollapsingHeader() {
  const scrollRef = useRef<HTMLElement | null>(null);
  const screenRef = useRef<HTMLElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const idleRef = useRef<number | null>(null);
  const snapRef = useRef<number | null>(null);
  const snappingRef = useRef(false);

  const cancelSnap = useCallback(() => {
    if (idleRef.current !== null) {
      cancelAnimationFrame(idleRef.current);
      idleRef.current = null;
    }

    if (snapRef.current !== null) {
      cancelAnimationFrame(snapRef.current);
      snapRef.current = null;
      snappingRef.current = false;

      if (scrollRef.current) {
        scrollRef.current.style.scrollBehavior = "";
      }
    }
  }, []);

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

  /**
   * Its own tween, with smooth scrolling forced off: the stylesheet's
   * `scroll-behavior: smooth` would otherwise animate every step this writes
   * and fight it.
   */
  const runSnap = useCallback((scroller: HTMLElement, target: number) => {
    const from = scroller.scrollTop;
    const distance = target - from;

    if (!distance) {
      return;
    }

    snappingRef.current = true;
    const previousBehavior = scroller.style.scrollBehavior;
    scroller.style.scrollBehavior = "auto";
    const start = performance.now();

    const step = (now: number) => {
      const t = Math.min(1, (now - start) / SNAP_DURATION_MS);
      const eased = 1 - Math.pow(1 - t, 3);
      scroller.scrollTop = from + distance * eased;

      if (t < 1) {
        snapRef.current = requestAnimationFrame(step);
        return;
      }

      scroller.scrollTop = target;
      scroller.style.scrollBehavior = previousBehavior;
      snapRef.current = null;
      snappingRef.current = false;
    };

    snapRef.current = requestAnimationFrame(step);
  }, []);

  const queueSnap = useCallback(
    (scroller: HTMLElement) => {
      if (snappingRef.current || idleRef.current !== null) {
        return;
      }

      let stable = 0;
      let last = scroller.scrollTop;

      const tick = () => {
        const top = scroller.scrollTop;
        stable = Math.abs(top - last) < 0.5 ? stable + 1 : 0;
        last = top;

        if (stable < STABLE_FRAMES) {
          idleRef.current = requestAnimationFrame(tick);
          return;
        }

        idleRef.current = null;

        if (top > 0 && top < RANGE_PX) {
          runSnap(scroller, top > SNAP_MIDPOINT_PX ? RANGE_PX : 0);
        }
      };

      idleRef.current = requestAnimationFrame(tick);
    },
    [runSnap],
  );

  const onScroll = useCallback(() => {
    if (frameRef.current === null) {
      frameRef.current = requestAnimationFrame(publish);
    }

    if (scrollRef.current) {
      queueSnap(scrollRef.current);
    }
  }, [publish, queueSnap]);

  useEffect(
    () => () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
      }
      cancelSnap();
    },
    [cancelSnap],
  );

  const attachScroll = useCallback(
    (node: HTMLElement | null) => {
      const previous = scrollRef.current;

      if (previous && previous !== node) {
        previous.removeEventListener("scroll", onScroll);
        previous.removeEventListener("pointerdown", cancelSnap);
      }

      scrollRef.current = node;

      if (node) {
        node.addEventListener("scroll", onScroll, { passive: true });
        node.addEventListener("pointerdown", cancelSnap);
        publish();
      }
    },
    [cancelSnap, onScroll, publish],
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
