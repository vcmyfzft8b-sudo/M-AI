import "server-only";

import { headers } from "next/headers";

/**
 * Detects requests coming from the iOS app shell.
 *
 * The wrapper appends `MemoiOS/<version>` to its user agent (see `AppConfig` in `ios/`), which
 * is the only signal available before any JavaScript runs — and the only one available to an
 * API route at all.
 *
 * This gates in-app purchasing. App Store Guideline 3.1.1 requires digital content used in an
 * iOS app to be sold through In-App Purchase; offering Stripe Checkout there is a rejection,
 * and being a web view is not an exemption. So the app hides every purchase surface, and the
 * checkout endpoint refuses native callers outright — a client-side check alone would be
 * bypassable and would still leave the API reachable.
 *
 * The web is untouched: Stripe Checkout stays exactly as it is for browsers.
 */
const NATIVE_USER_AGENT_TOKEN = "MemoiOS/";

export function isNativeAppUserAgent(userAgent: string | null | undefined) {
  return Boolean(userAgent?.includes(NATIVE_USER_AGENT_TOKEN));
}

/** Server components and route handlers. */
export async function isNativeAppRequest() {
  const headerStore = await headers();
  return isNativeAppUserAgent(headerStore.get("user-agent"));
}

/** Route handlers that already hold a `Request`. */
export function isNativeAppFetchRequest(request: Request) {
  return isNativeAppUserAgent(request.headers.get("user-agent"));
}
