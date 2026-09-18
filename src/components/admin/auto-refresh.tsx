"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

import {
  DASHBOARD_REFRESH_SECONDS,
  ONLINE_REFRESH_SECONDS,
} from "@/lib/admin/refresh";

/**
 * Keeps a dashboard left open on a screen current.
 *
 * `router.refresh()` re-runs the server components and swaps in new data
 * without losing scroll position or the open forms. Refreshing pauses while the
 * tab is hidden and catches up on return: a background tab would otherwise
 * spend Stripe and Vercel calls all day for nobody to read.
 */
/**
 * Runs `tick` every `seconds` while the tab is visible.
 *
 * Ticks are skipped while the tab is hidden. When it is shown again the
 * interval restarts and, if a whole period has passed since the last tick,
 * one runs at once rather than leaving stale numbers up until the next beat.
 * `tick` is read through a ref, so a new closure never restarts the interval.
 */
export function useVisibleInterval(tick: () => void, seconds: number) {
  const tickRef = useRef(tick);

  useEffect(() => {
    tickRef.current = tick;
  });

  useEffect(() => {
    let timer: number | undefined;
    let lastTick = Date.now();

    const run = () => {
      lastTick = Date.now();
      tickRef.current();
    };

    const start = () => {
      window.clearInterval(timer);
      timer = window.setInterval(() => {
        if (document.visibilityState === "visible") {
          run();
        }
      }, seconds * 1000);
    };

    const onVisibility = () => {
      if (document.visibilityState !== "visible") {
        return;
      }

      if (Date.now() - lastTick >= seconds * 1000) {
        run();
      }

      start();
    };

    start();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [seconds]);
}

export function AutoRefresh({
  /** Pages showing live presence poll on the faster beat. */
  live = false,
}: {
  live?: boolean;
}) {
  const router = useRouter();

  useVisibleInterval(
    () => router.refresh(),
    live ? ONLINE_REFRESH_SECONDS : DASHBOARD_REFRESH_SECONDS,
  );

  return null;
}

/** Shows when the page last pulled fresh numbers. */
export function RefreshedLabel({ live = false }: { live?: boolean }) {
  const minutes = Math.round(
    (live ? ONLINE_REFRESH_SECONDS : DASHBOARD_REFRESH_SECONDS) / 60,
  );

  return (
    <span className="admin-help">
      {live
        ? `Live · refreshes every ${minutes === 1 ? "minute" : `${minutes} minutes`}`
        : `Refreshes every ${minutes} minutes`}
    </span>
  );
}
