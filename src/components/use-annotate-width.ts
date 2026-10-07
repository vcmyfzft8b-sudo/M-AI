"use client";

import { useCallback, useEffect, useRef } from "react";

import {
  CHAT_SLOT_REM,
  TIGHT_SAVINGS_REM,
  annotateDockFit,
  type AnnotateDockFit,
} from "@/lib/annotate-dock-fit";

/**
 * The highlight label animates its width, so a single measurement taken when the
 * toolbar appears reads the size it had *before* the animation. Follow it for the
 * length of the transition instead.
 */
const FOLLOW_MS = 480;

/** Ignore sub-pixel churn, as the design does, so the pill does not jitter. */
const HYSTERESIS_PX = 3;

/**
 * The annotation pill hugs its buttons.
 *
 * `.memo-dock-pill.annotating` is `width: var(--annot-w, 14rem)`, and nothing
 * was ever setting `--annot-w` — so the pill sat at the 14rem fallback and left
 * a band of note text showing between it and the chat bar. The design measures
 * the row instead: the distance from the layer's left edge to the right edge of
 * its last visible child, plus the layer's left padding mirrored on the right so
 * both ends read the same.
 *
 * Only children that are actually on screen and in the row count. The colour
 * swatches float above the pill (`position: absolute`) since Oct 2026, so they
 * never widen it and opening them needs no remeasure.
 *
 * The value is written as a custom property rather than held in state: the pill
 * is remeasured every commit and through a 480ms follow loop, and re-rendering
 * the note body at that rate is exactly what makes this stutter.
 *
 * It also decides how much of the row fits (`data-fit`, see
 * `annotate-dock-fit.ts`): when the buttons are wider than the room beside the
 * chat button, the label folds into its icon, and on the narrowest phones the
 * buttons close up too, so the dock never cuts its last button off.
 */
export function useAnnotateWidth(annotating: boolean) {
  const pillRef = useRef<HTMLDivElement | null>(null);
  const layerRef = useRef<HTMLDivElement | null>(null);
  const lastRef = useRef(0);
  const fitRef = useRef<AnnotateDockFit>("full");
  const followRef = useRef<number | null>(null);
  const followUntilRef = useRef(0);

  /*
   * Which of the three fits the row needs. Worked out from the row as it is
   * drawn now, undoing whatever the current fit has taken off it, so the answer
   * does not depend on the answer: a folded label is measured at its natural
   * width (`scrollWidth`), and a tight row is credited what tight saved.
   */
  const fit = useCallback((pill: HTMLDivElement, layer: HTMLDivElement, width: number) => {
    const room = roomFor(pill);
    const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const label = layer.querySelector<HTMLElement>(".memo-annotate-label");
    const labelNow = label
      ? label.getBoundingClientRect().width + (Number.parseFloat(getComputedStyle(label).marginLeft) || 0)
      : 0;
    const labelFull = label ? label.scrollWidth + 0.4 * rem : 0;
    const icons = width - labelNow + (fitRef.current === "tight" ? TIGHT_SAVINGS_REM * rem : 0);
    const next = annotateDockFit({ icons, label: labelFull, room });

    if (next === fitRef.current) {
      return;
    }

    fitRef.current = next;
    pill.dataset.fit = next;
    // The label and the buttons animate into the new fit; follow them so the
    // pill settles on their final width rather than the first frame's.
    followUntilRef.current = performance.now() + FOLLOW_MS;
    if (followRef.current === null) {
      followRef.current = requestAnimationFrame(followTick.current);
    }
  }, []);

  const followTick = useRef<() => void>(() => {});

  const measure = useCallback(() => {
    const pill = pillRef.current;
    const layer = layerRef.current;

    if (!pill || !layer || !annotating) {
      return;
    }

    const styles = getComputedStyle(layer);
    const padLeft = Number.parseFloat(styles.paddingLeft) || 0;

    const visible = Array.from(layer.children).filter((child) => {
      const childStyles = getComputedStyle(child);

      return (
        // The colours float above the pill (position: absolute) and take no room in it.
        childStyles.position !== "absolute" &&
        Number.parseFloat(childStyles.maxWidth) !== 0 &&
        childStyles.opacity !== "0" &&
        child.getBoundingClientRect().width > 2
      );
    });

    if (!visible.length) {
      return;
    }

    const left = layer.getBoundingClientRect().left;
    const right = visible[visible.length - 1]!.getBoundingClientRect().right;
    const width = Math.ceil(right - left + padLeft);

    fit(pill, layer, width);

    if (Math.abs(lastRef.current - width) <= HYSTERESIS_PX) {
      return;
    }

    lastRef.current = width;
    pill.style.setProperty("--annot-w", `${width}px`);
  }, [annotating, fit]);

  followTick.current = () => {
    measure();
    followRef.current =
      performance.now() < followUntilRef.current ? requestAnimationFrame(followTick.current) : null;
  };

  // Every commit, mirroring the design's own componentDidUpdate: the label and
  // the swatch row both animate their width, and the marker colour can change
  // underneath them.
  useEffect(measure);

  useEffect(() => {
    if (!annotating) {
      lastRef.current = 0;
      fitRef.current = "full";
      pillRef.current?.style.removeProperty("--annot-w");
      delete pillRef.current?.dataset.fit;
      return;
    }

    followUntilRef.current = performance.now() + FOLLOW_MS;
    followRef.current = requestAnimationFrame(followTick.current);

    // A rotation or a resized window changes the room, not the row.
    const onResize = () => measure();
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      if (followRef.current !== null) {
        cancelAnimationFrame(followRef.current);
        followRef.current = null;
      }
    };
  }, [annotating, measure]);

  return { pillRef, layerRef };
}

/**
 * The widest the dock may be. On a phone that is its line less the chat
 * button (`max-width: calc(100% - 4.1rem)`); on desktop it has no cap.
 *
 * The line is the nearest ancestor that draws a box: the pill is portalled
 * into a `display: contents` slot, which has no width of its own.
 */
function roomFor(pill: HTMLElement) {
  if (getComputedStyle(pill).maxWidth === "none") {
    return Number.POSITIVE_INFINITY;
  }

  let line = pill.parentElement;

  while (line && getComputedStyle(line).display === "contents") {
    line = line.parentElement;
  }

  if (!line) {
    return Number.POSITIVE_INFINITY;
  }

  const styles = getComputedStyle(line);
  const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;

  return (
    line.clientWidth -
    (Number.parseFloat(styles.paddingLeft) || 0) -
    (Number.parseFloat(styles.paddingRight) || 0) -
    CHAT_SLOT_REM * rem
  );
}
