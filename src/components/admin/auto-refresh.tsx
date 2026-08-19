"use client";

import { useEffect, useState } from "react";
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
export function AutoRefresh({
  /** Pages showing live presence poll on the faster beat. */
  live = false,
}: {
  live?: boolean;
}) {
  const router = useRouter();
  const [refreshedAt, setRefreshedAt] = useState<number>(() => Date.now());

  const intervalSeconds = live ? ONLINE_REFRESH_SECONDS : DASHBOARD_REFRESH_SECONDS;

  useEffect(() => {
    let timer: number | undefined;

    const refresh = () => {
      setRefreshedAt(Date.now());
      router.refresh();
    };

    const start = () => {
      window.clearInterval(timer);
      timer = window.setInterval(() => {
        if (document.visibilityState === "visible") {
          refresh();
        }
      }, intervalSeconds * 1000);
    };

    const onVisibility = () => {
      if (document.visibilityState !== "visible") {
        return;
      }

      // Catch up immediately if the tab was hidden past a whole interval,
      // rather than showing stale numbers until the next tick.
      if (Date.now() - refreshedAt >= intervalSeconds * 1000) {
        refresh();
      }

      start();
    };

    start();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // `refreshedAt` deliberately excluded: it changes on every refresh and
    // would otherwise restart the interval each time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, intervalSeconds]);

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
