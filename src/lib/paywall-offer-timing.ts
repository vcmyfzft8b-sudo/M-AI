/**
 * When the browsing offer (`paywall-nudge.tsx`) opens: on every fourth tap on
 * anything in the app (a note, a tab, settings, a button of any kind) since
 * the last paywall. Any paywall, the offer included, starts the count again.
 *
 * The count is this tab's own (sessionStorage), a convenience rather than a
 * record: losing it only means the next offer comes a few screens later. What
 * the offer is worth lives on the account, never here.
 */

/** The tap that opens the offer: this many since the last paywall. */
export const OFFER_EVERY_SCREENS = 4;

/** Taps since the last paywall, in this tab. */
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

/** Counts one more tap; says whether this one opens the offer. */
export function countOfferScreen() {
  try {
    const screens = (Number(window.sessionStorage.getItem(OFFER_SCREENS_KEY)) || 0) + 1;
    window.sessionStorage.setItem(OFFER_SCREENS_KEY, String(screens));
    return offerIsDue(screens);
  } catch {
    return false;
  }
}

/** This tab's paywall visits already counted, newest last. */
const COUNTED_VISITS_KEY = "memo-paywall-visits";

/** The account this tab's counts belong to. */
const ACCOUNT_KEY = "memo-offer-account";

/**
 * Starts this tab's counts afresh when another account signs in on it, so
 * nothing one account did carries over to the next (the ladder itself lives
 * on the account, `paywall-moments.ts`).
 */
export function noteOfferAccount(userId: string) {
  try {
    if (window.sessionStorage.getItem(ACCOUNT_KEY) === userId) {
      return;
    }

    window.sessionStorage.removeItem(OFFER_SCREENS_KEY);
    window.sessionStorage.removeItem(COUNTED_VISITS_KEY);
    // The wheel offer a previous account left open for its checkout round trip.
    window.sessionStorage.removeItem("memo-offer-resume");
    window.sessionStorage.setItem(ACCOUNT_KEY, userId);
  } catch {
    // Storage blocked: there are no counts to carry over either.
  }
}

/**
 * Whether this visit to the paywall was already counted as a moment, and
 * notes it if not. A visit is the address and its place in this tab's
 * history: a reload, or returning to it through history, is the same visit;
 * opening the same paywall again later is a new one.
 */
export function paywallVisitCounted() {
  try {
    const visit = `${window.location.pathname}${window.location.search}#${window.history.length}`;
    const visits: unknown = JSON.parse(window.sessionStorage.getItem(COUNTED_VISITS_KEY) ?? "[]");
    const list = Array.isArray(visits) ? visits.filter((item): item is string => typeof item === "string") : [];

    if (list.includes(visit)) {
      return true;
    }

    window.sessionStorage.setItem(COUNTED_VISITS_KEY, JSON.stringify([...list, visit].slice(-30)));
    return false;
  } catch {
    return false;
  }
}
