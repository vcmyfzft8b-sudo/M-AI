"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

import { countOfferScreen, noteOfferAccount } from "@/lib/paywall-offer-timing";
import { paywallPath } from "@/lib/paywall-reasons";

/**
 * The offer that finds a free learner while they use the app.
 *
 * A learner who never runs into a limit would meet no paywall after the one at
 * the end of onboarding. Instead every seventh tap on anything in the app (a
 * note, a tab, the mind map, new note, settings, a button of any kind;
 * `paywall-offer-timing.ts`) opens the upgrade screen as an offer
 * (`?for=offer`) in place of what it would have done, exactly as a limit
 * would. Each one is a rung up the ladder (`paywall-ladder.ts`): 20 %, then
 * 30 %, then 40 %, which it then keeps. Closing it returns to where they were;
 * tapping again goes through, and the count starts again.
 *
 * Only a tap counts, never arriving on a page, going back, reloading or typing.
 * Nothing counts or opens while something live would be cut off (a recording
 * or an upload under way, a tutor session: `data-offer-hold`), nor inside a
 * paywall, the wheel or its offer. Web only: the layout does not mount it in
 * the app, which sells at Apple's prices.
 */

/** Paths where taps neither count nor open an offer: the paywall itself, consent. */
const NOT_BROWSING = ["/app/start", "/app/consent"];

/** Movement past which a press is a drag, not a tap. */
const DRAG_PX = 10;

/**
 * Anything that can be pressed. Fields that take typing are not taps, and a
 * label is not either: the browser passes its click on to its own control,
 * which counts it, so a label would count the one tap twice.
 */
const TAPPABLE = [
  "a[href]",
  "button",
  "summary",
  '[role="button"]',
  '[role="link"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="switch"]',
  '[role="checkbox"]',
  '[role="radio"]',
  'input[type="checkbox"]',
  'input[type="radio"]',
  'input[type="button"]',
  'input[type="submit"]',
].join(", ");

/** Where a tap already belongs to an offer, or to something live. */
const NEVER_HERE = "[data-offer-hold], .memo-wheel-sheet, .memo-offer-sheet, .memo-paywall-shell";

function isBrowsing(path: string) {
  return (path === "/app" || path.startsWith("/app/")) && !NOT_BROWSING.some((blocked) => path.startsWith(blocked));
}

export function PaywallNudge({ userId }: { userId: string }) {
  const pathname = usePathname();
  const router = useRouter();

  // A different account on this tab starts its own count.
  useEffect(() => {
    noteOfferAccount(userId);
  }, [userId]);

  useEffect(() => {
    if (!pathname || !isBrowsing(pathname)) {
      return;
    }

    // Where the press started: a click that ends a drag (a swiped row) is not
    // a tap, and the row ignores it too.
    let pressedAt: { x: number; y: number } | null = null;
    // An offer is on its way: taps until it arrives neither count nor open
    // another, which on a slow connection stacked several offers in history.
    let opening = false;

    function onPointerDown(event: PointerEvent) {
      pressedAt = { x: event.clientX, y: event.clientY };
    }

    // In the capture phase: before the click does anything.
    function onClick(event: MouseEvent) {
      // `detail` is 0 for a click no finger made: Enter sending a form, or a
      // key pressing a focused button. Typing is not tapping.
      if (event.detail === 0 || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }

      const dragged =
        pressedAt !== null && Math.hypot(event.clientX - pressedAt.x, event.clientY - pressedAt.y) > DRAG_PX;
      pressedAt = null;
      const target = event.target instanceof Element ? event.target.closest(TAPPABLE) : null;

      if (
        opening ||
        dragged ||
        !target ||
        target.matches(":disabled, [aria-disabled='true']") ||
        // A tap on a row with its actions showing closes them, not the row.
        target.closest(".memo-swipe-row.open") ||
        target.closest(NEVER_HERE) ||
        // A recording, an upload or a tutor session is live somewhere on the page.
        document.querySelector("[data-offer-hold]") ||
        !countOfferScreen()
      ) {
        return;
      }

      // This tap hits the offer instead of what it would have done.
      event.preventDefault();
      event.stopPropagation();
      // A fresh address each time, so the router never shows an earlier offer
      // it kept; the price is the server's either way.
      opening = true;
      router.push(`${paywallPath("offer", pathname!)}&t=${Date.now()}`);
    }

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("click", onClick, true);
    };
  }, [pathname, router]);

  return null;
}
