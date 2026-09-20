import type { Metadata } from "next";

import { OfflineApp } from "@/components/offline/offline-app";

export const metadata: Metadata = {
  title: "Offline",
  robots: {
    index: false,
    follow: false,
  },
};

/**
 * The document the service worker keeps so the app has something to open with
 * no connection.
 *
 * It is fetched and cached while the app is online, and then handed back for
 * any navigation that fails — under the address that was asked for, so the
 * screen it draws is decided inside `OfflineApp` from `location`. Nothing here
 * touches the database or the session: whatever this page renders is served to
 * whoever opens the app next on this device, so it must be the same bytes for
 * everyone and every screen must be drawn from the per-account store in the
 * browser instead.
 *
 * Reachable directly too. `/offline` with a connection shows the library as it
 * was last saved, which is the honest preview of what the app looks like
 * without one.
 */
export default function OfflinePage() {
  return <OfflineApp />;
}
