"use client";

import { useEffect, type RefObject } from "react";

import { wheelToHorizontalScroll } from "@/lib/wheel-to-horizontal";

/**
 * Lets a mouse wheel scroll a sideways row (`.memo-chiprow` and friends).
 *
 * Attached by hand rather than through `onWheel`, because React registers wheel
 * listeners on the root as passive: `preventDefault` inside a React handler is
 * ignored with a console warning, so the page would scroll behind the row as
 * well as the row moving.
 */
export function useWheelToHorizontal(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const row = ref.current;
    if (!row) {
      return;
    }

    const onWheel = (event: WheelEvent) => {
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

    row.addEventListener("wheel", onWheel, { passive: false });
    return () => row.removeEventListener("wheel", onWheel);
  }, [ref]);
}
