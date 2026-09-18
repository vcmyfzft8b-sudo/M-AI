"use client";

import { useEffect, useState } from "react";

import { readOnlineCountAction } from "@/app/admin/(dashboard)/actions";
import { ONLINE_REFRESH_SECONDS } from "@/lib/admin/refresh";

/**
 * The "online now" figure, kept live on its own.
 *
 * Polls a server action for the count alone rather than refreshing the page:
 * the number is worthless if stale, but nothing else on the overview moves
 * minute to minute. Polling pauses while the tab is hidden and catches up as
 * soon as it is shown again.
 */
export function OnlineNow({ initial }: { initial: number }) {
  const [count, setCount] = useState(initial);

  // A fresh server render (the page's own refresh) wins over a stale poll.
  useEffect(() => {
    setCount(initial);
  }, [initial]);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    const poll = async () => {
      if (document.visibilityState !== "visible") {
        return;
      }

      try {
        const next = await readOnlineCountAction();

        if (!cancelled) {
          setCount(next);
        }
      } catch {
        // Leave the last good number in place; the next tick tries again.
      }
    };

    const start = () => {
      window.clearInterval(timer);
      timer = window.setInterval(poll, ONLINE_REFRESH_SECONDS * 1000);
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void poll();
        start();
      }
    };

    start();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem" }}>
      {new Intl.NumberFormat("en-US").format(count)}
      {count > 0 && (
        <span className="admin-dot" data-pulse="true" style={{ color: "var(--green)" }} />
      )}
    </span>
  );
}
