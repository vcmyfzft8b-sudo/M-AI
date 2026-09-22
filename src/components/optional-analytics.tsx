"use client";

import { useEffect, useSyncExternalStore } from "react";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { VisitTracker } from "@/components/visit-tracker";
import { clearVisitorCookie, readAnalyticsConsent, subscribeToAnalyticsConsent } from "@/lib/analytics-consent";

export function useAnalyticsConsent() {
  return useSyncExternalStore(subscribeToAnalyticsConsent, readAnalyticsConsent, () => false);
}

// The injected vendor scripts can outlive React unmount. Check the current
// choice for every event, including events queued before withdrawal or expiry.
function onlyWithConsent<T>(event: T): T | null {
  return readAnalyticsConsent() ? event : null;
}

export function OptionalAnalytics() {
  const allowed = useAnalyticsConsent();
  useEffect(() => { if (!allowed) clearVisitorCookie(); }, [allowed]);
  if (!allowed) return null;
  return <>
    <VisitTracker />
    <Analytics beforeSend={onlyWithConsent} />
    <SpeedInsights beforeSend={onlyWithConsent} />
  </>;
}
