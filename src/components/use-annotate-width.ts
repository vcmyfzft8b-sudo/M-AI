"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * The swatch row animates its width, so a single measurement taken at the
 * moment the palette is toggled reads the size it had *before* the animation.
 * Follow it for the length of the transition instead.
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
 * Only children that are actually on screen count. The swatch row is always in
 * the tree and collapses to `max-width: 0`, so measuring the row's full extent
 * would size the pill for swatches nobody can see.
 *
 * The palette-open state is excluded because the design gives it a width of its
 * own (`calc(100% - 0.7rem)`); measuring then would fight that.
 *
 * The value is written as a custom property rather than held in state: the pill
 * is remeasured every commit and through a 480ms follow loop, and re-rendering
 * the note body at that rate is exactly what makes this stutter.
 */
export function useAnnotateWidth(annotating: boolean, paletteOpen: boolean) {
  const pillRef = useRef<HTMLDivElement | null>(null);
  const layerRef = useRef<HTMLDivElement | null>(null);
  const lastRef = useRef(0);
  const followRef = useRef<number | null>(null);

  const measure = useCallback(() => {
    const pill = pillRef.current;
    const layer = layerRef.current;

    if (!pill || !layer || !annotating || paletteOpen) {
      return;
    }

    const styles = getComputedStyle(layer);
    const padLeft = Number.parseFloat(styles.paddingLeft) || 0;

    const visible = Array.from(layer.children).filter((child) => {
      const childStyles = getComputedStyle(child);

      return (
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

    if (Math.abs(lastRef.current - width) <= HYSTERESIS_PX) {
      return;
    }

    lastRef.current = width;
    pill.style.setProperty("--annot-w", `${width}px`);
  }, [annotating, paletteOpen]);

  // Every commit, mirroring the design's own componentDidUpdate: the label and
  // the swatch row both animate their width, and the marker colour can change
  // underneath them.
  useEffect(measure);

  useEffect(() => {
    if (!annotating) {
      lastRef.current = 0;
      pillRef.current?.style.removeProperty("--annot-w");
      return;
    }

    const until = performance.now() + FOLLOW_MS;

    const tick = () => {
      measure();
      followRef.current =
        performance.now() < until ? requestAnimationFrame(tick) : null;
    };

    followRef.current = requestAnimationFrame(tick);

    return () => {
      if (followRef.current !== null) {
        cancelAnimationFrame(followRef.current);
        followRef.current = null;
      }
    };
  }, [annotating, paletteOpen, measure]);

  return { pillRef, layerRef };
}
