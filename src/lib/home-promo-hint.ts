/**
 * Which promo card the home screen last showed, remembered for the next visit.
 *
 * The card slot is decided on the server, so it cannot exist until the home
 * screen's data arrives — and the route shows its skeleton in the meantime.
 * The skeleton is the whole screen except that one card, which made the card
 * look like the slow part of a page that had already loaded: everything else
 * was in place and the gift appeared half a second later.
 *
 * So the last answer is kept here and the skeleton draws it straight away. It
 * is a hint, not a source of truth — the real card replaces it the moment the
 * screen renders, and the two are the same card in the same place, so a stale
 * hint corrects itself without anything moving.
 */

export const HOME_PROMO_HINT_KEY = "memo-home-promo";

/** The promo card the home screen shows in the library view, or none. */
export type HomePromoHint = "wheel" | "upgrade" | "none";

/**
 * Applies the hint the skeleton reads.
 *
 * Both halves matter: `localStorage` carries it to the next cold start, and
 * the attribute is what the CSS actually matches — the inline script in the
 * root layout only sets it once, so a card that changes mid-session (a spin
 * taken, a subscription bought) has to move the attribute itself.
 */
export function rememberHomePromo(hint: HomePromoHint) {
  if (typeof document === "undefined") {
    return;
  }

  if (hint === "none") {
    delete document.documentElement.dataset.homePromo;
  } else {
    document.documentElement.dataset.homePromo = hint;
  }

  try {
    window.localStorage.setItem(HOME_PROMO_HINT_KEY, hint);
  } catch {
    // A browser that refuses storage still gets the card, just not early.
  }
}
