"use client";

import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

/** Past this much travel the sheet is let go rather than sprung back. */
const DISMISS_AFTER_PX = 110;

/**
 * Drag-to-dismiss for the phone's bottom sheets, following the redesign.
 *
 * The rules about where a drag may start are the design's, and each one earns
 * its place: a finger on a field or a link is doing something else; a sheet
 * that owns a scrolling list would otherwise be dismissed by every attempt to
 * pan it, so there only the grabber starts a drag; and a button press is a
 * press, unless the button *is* the grabber.
 *
 * Only downward travel counts — dragging up would tear the sheet off the
 * bottom of the screen, which the design never does.
 */
export function useSheetDrag(onDismiss: () => void, options?: { scrollable?: boolean }) {
  const [dragY, setDragY] = useState(0);
  const cleanupRef = useRef<(() => void) | null>(null);
  const scrollable = options?.scrollable ?? false;

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.pointerType === "mouse" && event.button !== 0) {
        return;
      }

      const target = event.target;

      if (!(target instanceof Element)) {
        return;
      }

      if (target.closest("input, textarea, select, a")) {
        return;
      }

      const isHandle = Boolean(target.closest("[data-drag-handle]"));

      if (scrollable && !isHandle) {
        return;
      }

      if (target.closest("button") && !isHandle) {
        return;
      }

      cleanupRef.current?.();

      const startY = event.clientY;

      const move = (moveEvent: PointerEvent) => {
        setDragY(Math.max(0, moveEvent.clientY - startY));
      };

      const end = (endEvent: PointerEvent) => {
        cleanupRef.current?.();

        if (Math.max(0, endEvent.clientY - startY) > DISMISS_AFTER_PX) {
          onDismiss();
        }

        setDragY(0);
      };

      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", end);
      window.addEventListener("pointercancel", end);

      cleanupRef.current = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", end);
        window.removeEventListener("pointercancel", end);
        cleanupRef.current = null;
      };
    },
    [onDismiss, scrollable],
  );

  return {
    onPointerDown,
    /**
     * Spread onto the sheet. While a finger is down the transition is off so
     * the sheet tracks it exactly; on release the spring in the stylesheet
     * carries it back.
     */
    dragProps: {
      onPointerDown,
      style: dragY ? { transform: `translateY(${dragY}px)`, transition: "none" } : undefined,
      "data-dragging": dragY ? "true" : undefined,
    },
    dragY,
  };
}
