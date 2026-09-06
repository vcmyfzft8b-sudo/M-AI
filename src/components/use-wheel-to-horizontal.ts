"use client";

import { useEffect } from "react";

import { chipRowDragScrollLeft, shouldStartChipRowDrag } from "@/lib/chip-row-drag";
import { wheelToHorizontalScroll } from "@/lib/wheel-to-horizontal";

/** Every row in the app that scrolls sideways carries this class. */
const CHIP_ROW = ".memo-chiprow";

/**
 * Gives the sideways rows the two things a mouse needs and the design took
 * away: the wheel pushes them along, and they can be grabbed and pulled.
 *
 * One pair of delegated listeners rather than a hook per row, for two reasons.
 * Every row wants the same behaviour, and `.memo-chiprow` already means "this
 * scrolls on one axis", so the class is the honest place to hang it. And a
 * listener held against a ref silently does nothing whenever the node it
 * captured is not the node on screen — a row that mounts a render later, or is
 * re-created — which is a failure with no symptom except the gesture not
 * working.
 *
 * Registered by hand and non-passive: React registers `onWheel` on the root as
 * passive, so `preventDefault` inside a React handler is ignored and the page
 * scrolls behind the row as well as the row moving.
 */
export function useChipRowWheelScroll() {
  useEffect(() => {
    const onWheel = (event: WheelEvent) => {
      const row = rowUnder(event.target);
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

    let drag: {
      row: HTMLElement;
      pointerId: number;
      start: { pointerX: number; scrollLeft: number };
      moved: boolean;
      userSelectWas: string;
    } | null = null;

    /*
     * A pointerup that ends a drag is still followed by a click on whichever
     * pill happens to be under it, which would change tab at the end of every
     * pull. It is swallowed by a flag rather than by a one-shot listener armed
     * on release: the browser is not obliged to dispatch that click in the same
     * task as the pointerup, so any listener torn down on a timer is a race that
     * happens to pass on this machine.
     *
     * Cleared at the start of the next gesture — pointer or key — so a flag set
     * by a drag that ended with no click at all cannot eat someone's next real
     * one.
     */
    let swallowNextClick = false;

    const onClickCapture = (event: MouseEvent) => {
      if (!swallowNextClick) {
        return;
      }

      swallowNextClick = false;
      event.stopPropagation();
      event.preventDefault();
    };

    const onPointerDown = (event: PointerEvent) => {
      swallowNextClick = false;

      const row = rowUnder(event.target);
      if (
        !row ||
        !shouldStartChipRowDrag({
          pointerType: event.pointerType,
          button: event.button,
          scrollWidth: row.scrollWidth,
          clientWidth: row.clientWidth,
        })
      ) {
        return;
      }

      drag = {
        row,
        pointerId: event.pointerId,
        start: { pointerX: event.clientX, scrollLeft: row.scrollLeft },
        moved: false,
        userSelectWas: "",
      };
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.pointerId) {
        return;
      }

      const next = chipRowDragScrollLeft(drag.start, event.clientX, drag.moved);
      if (next === null) {
        return;
      }

      if (!drag.moved) {
        drag.moved = true;
        /*
         * A drag across a row of buttons otherwise selects their labels, and the
         * row ends the gesture with half its text highlighted. Set on the row's
         * document rather than on the row, because the pointer spends most of a
         * long pull outside it — and put back exactly as found, so this cannot
         * quietly release a `user-select` somebody else was holding.
         */
        const { body } = drag.row.ownerDocument;
        drag.userSelectWas = body.style.userSelect;
        body.style.userSelect = "none";
        drag.row.classList.add("is-dragging");
      }

      // Keeps the browser's own text-drag and image-drag out of it.
      event.preventDefault();
      drag.row.scrollLeft = next;
    };

    const endDrag = () => {
      if (!drag) {
        return;
      }

      if (drag.moved) {
        drag.row.ownerDocument.body.style.userSelect = drag.userSelectWas;
        drag.row.classList.remove("is-dragging");
        // Only when the row actually moved, so a plain press on a pill lands.
        swallowNextClick = true;
      }

      drag = null;
    };

    const clearSwallow = () => {
      swallowNextClick = false;
    };

    document.addEventListener("wheel", onWheel, { passive: false });
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("pointermove", onPointerMove, { passive: false });
    document.addEventListener("pointerup", endDrag);
    document.addEventListener("pointercancel", endDrag);
    document.addEventListener("click", onClickCapture, { capture: true });
    // A keyboard activation arrives as a click with no pointer gesture in front
    // of it, so it needs its own way of clearing a stale flag.
    document.addEventListener("keydown", clearSwallow);

    return () => {
      document.removeEventListener("wheel", onWheel);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", endDrag);
      document.removeEventListener("pointercancel", endDrag);
      document.removeEventListener("click", onClickCapture, { capture: true });
      document.removeEventListener("keydown", clearSwallow);
    };
  }, []);
}

function rowUnder(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element ? target.closest<HTMLElement>(CHIP_ROW) : null;
}
