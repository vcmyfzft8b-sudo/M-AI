"use client";

import { useEffect } from "react";

import { wheelToHorizontalScroll } from "@/lib/wheel-to-horizontal";

/** Every row in the app that scrolls sideways carries this class. */
const CHIP_ROW = ".memo-chiprow";

/**
 * Lets a mouse wheel scroll any sideways row in the app — the note's pill row,
 * the chat suggestions, the tutor's voices.
 *
 * One delegated listener rather than a hook per row, for two reasons. Every row
 * wants the same behaviour, and `.memo-chiprow` already means "this scrolls on
 * one axis", so the class is the honest place to hang it. And a listener held
 * against a ref silently does nothing whenever the node it captured is not the
 * node on screen — a row that mounts a render later, or is re-created — which is
 * a failure with no symptom except the wheel not working.
 *
 * Registered by hand and non-passive: React registers `onWheel` on the root as
 * passive, so `preventDefault` inside a React handler is ignored and the page
 * scrolls behind the row as well as the row moving.
 */
export function useChipRowWheelScroll() {
  useEffect(() => {
    const onWheel = (event: WheelEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }

      const row = target.closest<HTMLElement>(CHIP_ROW);
      if (!row) {
        return;
      }

      const step = wheelToHorizontalScroll({
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        deltaMode: event.deltaMode,
        scrollLeft: row.scrollLeft,
        scrollWidth: row.scrollWidth,
        clientWidth: row.clientWidth,
      });

      if (step === null) {
        return;
      }

      event.preventDefault();
      row.scrollLeft += step;
    };

    document.addEventListener("wheel", onWheel, { passive: false });
    return () => document.removeEventListener("wheel", onWheel);
  }, []);
}
