"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import { useT } from "@/components/i18n-provider";
import { Msym } from "@/components/msym";
import { nextStop, stickInput } from "@/lib/palace/navigation";
import type { PalaceSnapshot } from "@/lib/palace/game";
import type { PalaceLayout } from "@/lib/palace/layout";

/*
 * The parts of the palace's HUD that the app (`lecture-palace.tsx`) and the
 * landing page's demo of it (`landing-palace-screen.tsx`) both draw, kept here
 * so the two cannot drift: the touch stick, the pointer to the next stop and
 * the line that follows a card.
 */

/* Closer than this, the stop is in view and the pointer only gets in the way. */
const NEXT_STOP_HIDE_DISTANCE = 4;
/* How long the word after a card stays up; the CSS animation runs as long. */
const TOAST_MS = 2200;

type Knob = { x: number; y: number; originX: number; originY: number; running: boolean };

/**
 * The left thumb's stick. `toPoint` places a pointer in the coordinates the
 * knob is drawn in: the window for the app's fixed stage, the stage itself for
 * the landing's phone. `onMove` gets the walk; pushed past the rim, it runs.
 */
export function usePalaceStick({
  onMove,
  toPoint = (event) => ({ x: event.clientX, y: event.clientY }),
}: {
  onMove: (forward: number, right: number, running: boolean) => void;
  toPoint?: (event: ReactPointerEvent<HTMLElement>) => { x: number; y: number };
}) {
  const stickRef = useRef<{ pointerId: number; originX: number; originY: number } | null>(null);
  const [knob, setKnob] = useState<Knob | null>(null);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (stickRef.current) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    const point = toPoint(event);

    stickRef.current = { pointerId: event.pointerId, originX: point.x, originY: point.y };
    setKnob({ ...point, originX: point.x, originY: point.y, running: false });
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const stick = stickRef.current;

    if (!stick || stick.pointerId !== event.pointerId) return;

    const point = toPoint(event);
    const input = stickInput(point.x - stick.originX, point.y - stick.originY);

    onMove(input.forward, input.right, input.running);
    setKnob({
      x: stick.originX + input.knobX,
      y: stick.originY + input.knobY,
      originX: stick.originX,
      originY: stick.originY,
      running: input.running,
    });
  };

  const end = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (stickRef.current?.pointerId !== event.pointerId) return;

    stickRef.current = null;
    onMove(0, 0, false);
    setKnob(null);
  };

  /* The game closed under the thumb: forget it, so the next visit starts clean. */
  const reset = useCallback(() => {
    stickRef.current = null;
    setKnob(null);
  }, []);

  return {
    knob,
    reset,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: end,
      onPointerCancel: end,
      onLostPointerCapture: end,
    },
  };
}

export function PalaceStick({ stick }: { stick: ReturnType<typeof usePalaceStick> }) {
  const { knob, handlers } = stick;

  return (
    <div className="memo-palace-stick" {...handlers}>
      {/* A base at rest, so the stick is somewhere you can see rather than
          somewhere you have to know about. */}
      <span className="memo-palace-stick-base" data-active={knob ? "true" : undefined} aria-hidden="true" />
      {knob ? (
        <>
          {/* The ring goes where the thumb landed, so the knob is always inside one. */}
          <span
            className="memo-palace-stick-ring"
            data-running={knob.running ? "true" : undefined}
            style={{ left: `${knob.originX}px`, top: `${knob.originY}px` }}
            aria-hidden="true"
          />
          <span
            className="memo-palace-knob"
            data-running={knob.running ? "true" : undefined}
            style={{ left: `${knob.x}px`, top: `${knob.y}px` }}
          />
        </>
      ) : null}
    </div>
  );
}

/**
 * Which way the next stop is, as an arrow under the score. The corner map says
 * the same, but at a phone's size it is a glance away from the street; this
 * sits next to the count you are trying to raise. `update` is for the frame
 * callback: it writes to the DOM, not to state, because it changes every frame.
 * A plain object rather than refs, so the component can be handed it in render.
 */
class NextStopPointer {
  private parts: { element: HTMLElement; arrow: SVGSVGElement; distance: HTMLElement; label: (distance: number) => string } | null = null;
  private shown = { visible: false, distance: -1 };

  /** Called by `PalaceNextStop` once its elements exist, and with null when they go. */
  mount(parts: NextStopPointer["parts"]) {
    this.parts = parts;
    this.shown = { visible: false, distance: -1 };
    /* The cache starts hidden, so the element must too, or a remount leaves a stale arrow up. */
    if (parts) parts.element.dataset.visible = "false";
  }

  update = (
    snapshot: PalaceSnapshot,
    layout: PalaceLayout | null,
    collected: ReadonlySet<string>,
    selectedId: string | null = null,
  ) => {
    const parts = this.parts;

    if (!parts || !layout) return;

    const next = nextStop(snapshot, layout.stations, collected, selectedId);
    const visible = Boolean(next) && !snapshot.nearStationId && (next?.distance ?? 0) > NEXT_STOP_HIDE_DISTANCE;
    const shown = this.shown;

    if (visible !== shown.visible) {
      parts.element.dataset.visible = String(visible);
      shown.visible = visible;
    }
    if (!visible || !next) return;

    parts.arrow.style.setProperty("rotate", `${next.angle}deg`);

    const rounded = next.distance < 100 ? Math.round(next.distance) : Math.round(next.distance / 10) * 10;

    if (rounded !== shown.distance) {
      shown.distance = rounded;
      parts.distance.textContent = `${rounded} m`;
      parts.element.setAttribute("aria-label", parts.label(rounded));
    }
  };
}

export function usePalaceNextStop() {
  const [pointer] = useState(() => new NextStopPointer());

  return pointer;
}

export function PalaceNextStop({ pointer }: { pointer: NextStopPointer }) {
  const t = useT();
  const elementRef = useRef<HTMLSpanElement | null>(null);
  const arrowRef = useRef<SVGSVGElement | null>(null);
  const distanceRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const element = elementRef.current;
    const arrow = arrowRef.current;
    const distance = distanceRef.current;

    if (!element || !arrow || !distance) return;

    pointer.mount({ element, arrow, distance, label: (metres) => t("palace.next", { distance: metres }) });

    return () => pointer.mount(null);
  }, [pointer, t]);

  return (
    <span ref={elementRef} className="memo-palace-next" data-visible="false" role="img">
      <svg ref={arrowRef} className="memo-palace-next-arrow" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3 19 20 12 16 5 20Z" />
      </svg>
      <span ref={distanceRef} />
    </span>
  );
}

export type PalaceToastKind = "collected" | "moved";

/**
 * What the last answer did, said once its card has gone: queued while the card
 * is up (`queue`), shown when it closes (`flush`).
 */
export function usePalaceToast() {
  const pendingRef = useRef<PalaceToastKind | null>(null);
  const [toast, setToast] = useState<{ kind: PalaceToastKind; id: number } | null>(null);

  useEffect(() => {
    if (!toast) return;

    const timer = window.setTimeout(() => setToast((current) => (current?.id === toast.id ? null : current)), TOAST_MS);

    return () => window.clearTimeout(timer);
  }, [toast]);

  const queue = useCallback((kind: PalaceToastKind | null) => {
    pendingRef.current = kind;
  }, []);

  const flush = useCallback(() => {
    const kind = pendingRef.current;

    pendingRef.current = null;
    if (kind) setToast({ kind, id: Date.now() });
  }, []);

  return { toast, queue, flush };
}

export function PalaceToast({ toast }: { toast: ReturnType<typeof usePalaceToast>["toast"] }) {
  const t = useT();

  if (!toast) return null;

  return (
    <p key={toast.id} className={`memo-palace-toast ${toast.kind}`} role="status">
      <Msym name={toast.kind === "collected" ? "check_circle" : "explore"} size="1.15rem" fill />
      {t(toast.kind === "collected" ? "palace.toast.collected" : "palace.toast.moved")}
    </p>
  );
}
