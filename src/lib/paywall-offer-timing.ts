/**
 * When the browsing offer (`paywall-nudge.tsx`) may open. Pure, so the rules
 * can be tested and tuned in one place.
 */

/** Screens looked at in this visit before an offer may open. */
export const OFFER_AFTER_SCREENS = 3;
/** Quiet time after any paywall, this one included. */
export const OFFER_QUIET_MS = 15 * 60 * 1000;
/** Time between two browsing offers. */
export const OFFER_GAP_MS = 12 * 60 * 60 * 1000;

/** Whether an offer may open now; pure, so the rules can be tested. */
export function offerIsDue({
  now,
  screens,
  lastPaywall,
  lastOffer,
}: {
  now: number;
  screens: number;
  lastPaywall: number;
  lastOffer: number;
}) {
  return (
    screens >= OFFER_AFTER_SCREENS &&
    now - lastPaywall >= OFFER_QUIET_MS &&
    now - lastOffer >= OFFER_GAP_MS
  );
}

/** When any paywall last opened, in this browser (localStorage). */
export const LAST_PAYWALL_KEY = "memo-paywall-last-shown";

/** Any paywall that opens restarts the quiet time. */
export function notePaywallShown(now = Date.now()) {
  try {
    window.localStorage.setItem(LAST_PAYWALL_KEY, String(now));
  } catch {
    // Storage blocked: the offer just comes on the old schedule.
  }
}
