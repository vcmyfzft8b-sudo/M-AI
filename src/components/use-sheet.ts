"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

/** Past this much travel the sheet is let go rather than sprung back. */
const DISMISS_AFTER_PX = 110;

/**
 * How long the exit runs. Matches `.closing` in redesign.css, which is the
 * design's own `transform 0.26s cubic-bezier(0.4, 0, 0.9, 0.4)`.
 */
export const SHEET_CLOSE_MS = 260;

/**
 * A sheet swapped for another sheet cuts the exit slightly short, so the
 * incoming sheet's rise starts before the outgoing one has fully cleared.
 */
export const SHEET_SWAP_MS = 240;

/**
 * The redesign's phone breakpoint. Above it these overlays are centred dialogs
 * that the design closes on the spot, and `.closing` — which slides a sheet off
 * the bottom edge — is not defined at all.
 */
const PHONE_QUERY = "(max-width: 1099px)";

function isPhone() {
  return typeof window !== "undefined" && window.matchMedia(PHONE_QUERY).matches;
}

type SheetOptions = {
  /**
   * The sheet owns a scrolling list. Only the grabber may start a drag, so a
   * finger on the list pans it instead of dismissing the sheet.
   */
  scrollable?: boolean;
  /** While true the sheet refuses to close — a request in flight, typically. */
  locked?: boolean;
};

/**
 * One bottom sheet, moving the way the mobile design moves it.
 *
 * The design routes every dismissal — the X, the scrim, a cancel button, a
 * drag past the threshold — through a single `dismissSheet`, so a sheet always
 * leaves the same way: it drops out of frame under `.closing` and only then
 * unmounts. Closing instantly (or teleporting the sheet off-screen and
 * unmounting behind the gap) is what this exists to prevent.
 *
 * The rules about where a drag may start are the design's too, and each one
 * earns its place: a finger on a field or a link is doing something else; a
 * sheet that owns a scrolling list would otherwise be dismissed by every
 * attempt to pan it; and a button press is a press, unless the button *is* the
 * grabber. Only downward travel counts — dragging up would tear the sheet off
 * the top of the screen, which the design never does.
 */
export function useSheet(onClosed: () => void, options?: SheetOptions) {
  const [dragY, setDragY] = useState(0);
  const [closing, setClosing] = useState(false);

  const cleanupRef = useRef<(() => void) | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const closingRef = useRef(false);

  const scrollable = options?.scrollable ?? false;
  const locked = options?.locked ?? false;

  // Read through refs so `dismiss` keeps a stable identity: it is wired to
  // Escape handlers and scrim buttons that should not re-subscribe per render.
  const onClosedRef = useRef(onClosed);
  const lockedRef = useRef(locked);

  useEffect(() => {
    onClosedRef.current = onClosed;
    lockedRef.current = locked;
  });

  useEffect(
    () => () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
      }
      cleanupRef.current?.();
    },
    [],
  );

  /**
   * Play the exit, then close. `after` runs once the sheet is really gone, so
   * a caller can open the next sheet without the two overlapping.
   */
  const dismiss = useCallback((after?: () => void) => {
    if (lockedRef.current) {
      return;
    }

    if (closingRef.current) {
      return;
    }

    // On desktop there is no exit to wait for, and delaying the close would
    // just make the dialog feel slow to dismiss.
    if (!isPhone()) {
      setDragY(0);
      onClosedRef.current();
      after?.();
      return;
    }

    closingRef.current = true;
    setClosing(true);
    cleanupRef.current?.();

    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      closingRef.current = false;
      setClosing(false);
      setDragY(0);
      onClosedRef.current();
      after?.();
    }, SHEET_CLOSE_MS);
  }, []);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (closingRef.current || lockedRef.current) {
        return;
      }

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
      /*
       * A drag zone is somewhere a drag may start even on a scrolling sheet —
       * a header, say — but which still lets its own buttons be buttons. The
       * grabber alone is a 1.6rem target, which is a lot to ask of a thumb.
       */
      const inDragZone = isHandle || Boolean(target.closest("[data-drag-zone]"));

      if (scrollable && !inDragZone) {
        return;
      }

      if (target.closest("button, a, input, textarea, select") && !isHandle) {
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
          // The sheet stays where the finger left it and `.closing` carries it
          // the rest of the way; springing it back to 0 first would show a
          // hitch right before the exit.
          dismiss();
          return;
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
    [dismiss, scrollable],
  );

  return {
    /** True from the moment a dismissal starts until the sheet unmounts. */
    closing,
    dismiss,
    dragY,
    /**
     * Spread onto the sheet. While a finger is down the transition is off so
     * the sheet tracks it exactly; on release the spring in the stylesheet
     * carries it back. During the exit the inline transform is dropped so
     * `.closing` owns the movement.
     */
    dragProps: {
      onPointerDown,
      style:
        dragY && !closing
          ? { transform: `translateY(${dragY}px)`, transition: "none" }
          : undefined,
      "data-dragging": dragY && !closing ? "true" : undefined,
    },
  };
}

/** `"memo-sheet closing"` when closing, `"memo-sheet"` when not. */
export function sheetClass(base: string, closing: boolean) {
  return closing ? `${base} closing` : base;
}
