"use client";

import { useEffect, useState } from "react";

import { readOnlineCountAction } from "@/app/admin/(dashboard)/actions";
import { ONLINE_REFRESH_SECONDS } from "@/lib/admin/refresh";

import { useVisibleInterval } from "./auto-refresh";
import { formatExact } from "./ui";

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

  useVisibleInterval(() => {
    readOnlineCountAction().then(setCount, (error: unknown) => {
      // The last good number stays up and the next tick tries again; logged
      // so a session that has quietly expired is not mistaken for a live one.
      console.error("Online count poll failed", error);
    });
  }, ONLINE_REFRESH_SECONDS);

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem" }}>
      {formatExact(count)}
      {count > 0 && (
        <span className="admin-dot" data-pulse="true" style={{ color: "var(--green)" }} />
      )}
    </span>
  );
}
