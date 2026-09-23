"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef } from "react";
import { clearVisitorCookie, readAnalyticsConsent } from "@/lib/analytics-consent";

/**
 * Sends the visitor beacon that powers the admin dashboard's traffic and
 * "online now" panels.
 *
 * One `view` per navigation, then a `heartbeat` while the tab stays visible so
 * a reader who sits on one page still counts as online.
 */

const HEARTBEAT_INTERVAL_MS = 60_000;

function postBeacon(path: string, event: "view" | "heartbeat") {
  if (!readAnalyticsConsent()) return;
  const body = JSON.stringify({
    path,
    referrer: event === "view" ? document.referrer || null : null,
    event,
  });

  // `keepalive` lets the request survive the navigation that triggered it.
  void fetch("/api/track", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => {
    // Analytics is best effort and must never disturb the page.
  }).finally(() => {
    // A response already in flight can set its cookie after withdrawal.
    if (!readAnalyticsConsent()) clearVisitorCookie();
  });
}

function VisitTrackerInner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const lastPathRef = useRef<string | null>(null);

  const search = searchParams?.toString() ?? "";
  const fullPath = search ? `${pathname}?${search}` : pathname;

  useEffect(() => {
    if (!pathname || pathname.startsWith("/admin")) {
      return;
    }

    // React strict mode mounts effects twice in development; without this the
    // first page view of every navigation would be double counted.
    if (lastPathRef.current === fullPath) {
      return;
    }

    lastPathRef.current = fullPath;
    postBeacon(fullPath, "view");
  }, [fullPath, pathname]);

  useEffect(() => {
    if (!pathname || pathname.startsWith("/admin")) {
      return;
    }

    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        postBeacon(fullPath, "heartbeat");
      }
    }, HEARTBEAT_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [fullPath, pathname]);

  return null;
}

export function VisitTracker() {
  // `useSearchParams` forces the nearest boundary to render on the client, so
  // it is isolated here to keep the rest of the tree statically rendered.
  return (
    <Suspense fallback={null}>
      <VisitTrackerInner />
    </Suspense>
  );
}
