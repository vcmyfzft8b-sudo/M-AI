"use client";

import type { CSSProperties, ReactNode } from "react";
import { useLayoutEffect, useRef, useState } from "react";

/*
 * An app screen, drawn at the width the app draws it and shrunk to the slot it is given.
 *
 * The landing's demos render the product's own markup (see `app/landing-app-scope.tsx`), and
 * that markup is sized for a phone: a pill is 3.1rem tall, a note row 5.4rem. Re-laying it out
 * smaller would be a second design; scaling the whole screen keeps the app's proportions, so the
 * demo is the app at a distance rather than a likeness of it.
 *
 * - `width` is the screen's natural width in CSS pixels — a phone, 390, unless the slot is wider.
 * - With `fill`, the frame takes its parent's height and gives the screen whatever that is at
 *   natural scale, so a screen that lays out against its own height (a study card, a sphere)
 *   gets a real one. Without it, the frame is as tall as the scaled screen.
 *
 * Never scales up: a slot wider than `width` gets the screen at 1:1, centred.
 */
export function LandingScaledFrame({
  width = 390,
  fill = false,
  className,
  style,
  children,
}: {
  width?: number;
  fill?: boolean;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ scale: number; outerHeight: number; innerHeight: number } | null>(null);

  useLayoutEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;

    if (!outer || !inner) {
      return;
    }

    const measure = () => {
      const scale = Math.min(1, outer.clientWidth / width) || 1;
      const next = {
        scale,
        outerHeight: fill ? outer.clientHeight : 0,
        /* offsetHeight is the untransformed height, which is the one to multiply. */
        innerHeight: fill ? 0 : inner.offsetHeight,
      };

      setBox((current) =>
        current &&
        Math.abs(current.scale - next.scale) < 0.001 &&
        current.outerHeight === next.outerHeight &&
        current.innerHeight === next.innerHeight
          ? current
          : next,
      );
    };

    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(outer);
    observer.observe(inner);

    return () => observer.disconnect();
  }, [fill, width]);

  const scale = box?.scale ?? 1;

  return (
    <div
      ref={outerRef}
      className={className}
      style={{
        position: "relative",
        width: "100%",
        height: fill ? "100%" : box ? `${box.innerHeight * scale}px` : undefined,
        overflow: "hidden",
        ...style,
      }}
    >
      <div
        ref={innerRef}
        style={{
          position: fill ? "absolute" : "relative",
          top: 0,
          left: "50%",
          width: `${width}px`,
          height: fill && box ? `${box.outerHeight / scale}px` : fill ? "100%" : undefined,
          transform: `translateX(-50%) scale(${scale})`,
          transformOrigin: "top center",
          /* Hidden until measured, so a server-rendered frame never flashes at full size. */
          visibility: box ? "visible" : "hidden",
        }}
      >
        {children}
      </div>
    </div>
  );
}
