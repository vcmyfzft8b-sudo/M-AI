/**
 * Whether the discount offer is mid-checkout, so coming back reopens it — and
 * on what deadline, so it comes back with the clock it left with.
 *
 * Leaving for Stripe is a navigation away from the app: the home screen is
 * torn down, and whether it comes back through Stripe's own "back" link, the
 * browser's back gesture, or a reload in the wrapper's web view decides
 * whether the `offer=1` on the cancel URL survives. Two of those three lose
 * it, and the offer the buyer never dismissed was gone when they returned.
 *
 * So the intent is written down before the redirect instead of being inferred
 * from the URL afterwards. The offer is the buyer's until they close it — the
 * countdown running out closes it too, and so does buying — and this is the
 * note that says it is still open.
 *
 * The prize's deadline rides along because the sheet has a countdown on it and
 * a restored sheet has nothing to draw until the server answers. Ten minutes
 * is the right guess for an offer that has just been won and the wrong one for
 * an offer being resumed, where it puts a minute back on a clock the buyer has
 * been watching. It is only a seed: `prizeExpiresAt` from the server still
 * overrules it, and the server is what actually enforces the window.
 *
 * `sessionStorage` is the right shelf for both: they survive the round trip
 * and the reload, and they do not follow the offer into a new tab or into next
 * week.
 */

const OFFER_RESUME_KEY = "memo-offer-resume";

type OfferResume = {
  /** True when checkout was opened from the offer and the offer never closed. */
  pending: boolean;
  /** When the prize lapses, as epoch milliseconds, or null if unknown. */
  expiresAt: number | null;
};

const NOT_PENDING: OfferResume = { pending: false, expiresAt: null };

/** What was written down before the last trip to checkout, if anything. */
export function readOfferResume(): OfferResume {
  if (typeof window === "undefined") {
    return NOT_PENDING;
  }

  try {
    // `null` is the absent key; an empty string is the note without a deadline.
    const raw = window.sessionStorage.getItem(OFFER_RESUME_KEY);

    if (raw === null) {
      return NOT_PENDING;
    }

    const expiresAt = Number.parseInt(raw, 10);

    return { pending: true, expiresAt: Number.isFinite(expiresAt) ? expiresAt : null };
  } catch {
    // A browser that refuses storage falls back to `offer=1` on the cancel URL.
    return NOT_PENDING;
  }
}

/** True when the offer should be put back — the common question, asked plainly. */
export function isOfferResumePending() {
  return readOfferResume().pending;
}

/**
 * Marks the offer as still open across a trip to Stripe.
 *
 * A deadline is only overwritten when one is offered, so the screen that puts
 * the sheet back can renew the note without having to know the prize's clock.
 */
export function markOfferResume(expiresAt?: number | null) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    const deadline = expiresAt ?? readOfferResume().expiresAt;
    window.sessionStorage.setItem(OFFER_RESUME_KEY, deadline === null ? "" : String(deadline));
  } catch {
    // Nothing to remember; the offer simply does not survive the round trip.
  }
}

/** Forgets it: the offer was closed, bought, or ran out. */
export function clearOfferResume() {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.sessionStorage.removeItem(OFFER_RESUME_KEY);
  } catch {
    // As above: nothing to forget.
  }
}
