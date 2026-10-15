/**
 * When the browsing offer (`paywall-nudge.tsx`) opens: after every few screens
 * a free learner looks at without meeting a paywall. A screen is a new page or
 * a new tab on a note. Any paywall, the offer included, starts the count again.
 *
 * The count is this tab's own (sessionStorage), a convenience rather than a
 * record: losing it only means the next offer comes a few screens later. What
 * the offer is worth lives in the server's cookie, never here.
 */

/** Screens between two paywalls before a browsing offer opens. */
export const OFFER_EVERY_SCREENS = 4;

/** Screens looked at since the last paywall, in this tab. */
export const OFFER_SCREENS_KEY = "memo-offer-screens";

export function offerIsDue(screens: number) {
  return screens >= OFFER_EVERY_SCREENS;
}

/** Any paywall that opens starts the count to the next offer again. */
export function notePaywallShown() {
  try {
    window.sessionStorage.setItem(OFFER_SCREENS_KEY, "0");
  } catch {
    // Storage blocked: the count simply carries on.
  }
}

/** Counts one more screen; says whether the offer is due now. */
export function countOfferScreen() {
  try {
    const screens = (Number(window.sessionStorage.getItem(OFFER_SCREENS_KEY)) || 0) + 1;
    window.sessionStorage.setItem(OFFER_SCREENS_KEY, String(screens));
    return offerIsDue(screens);
  } catch {
    return false;
  }
}
