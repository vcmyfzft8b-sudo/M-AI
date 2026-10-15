"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import { countOfferScreen } from "@/lib/paywall-offer-timing";
import { paywallPath } from "@/lib/paywall-reasons";

/**
 * The offer that finds a free learner while they browse.
 *
 * A learner who never runs into a limit would meet no paywall after the one at
 * the end of onboarding. Instead, every few screens they look at — a new page,
 * or a new tab on a note (`paywall-offer-timing.ts`) — the upgrade screen opens
 * as an offer (`?for=offer`), and each one is a rung up the ladder
 * (`paywall-ladder.ts`): 20 %, then 30 %, then 40 %, which it then keeps.
 * Closing it returns to where they were and the count starts again.
 *
 * Never on the screens where an offer would interrupt something that cannot be
 * resumed or has nothing to do with studying: a recording, settings, support.
 * Web only: the layout does not mount it in the app, which sells at Apple's
 * prices.
 */

/** Paths that neither count as browsing nor open an offer. */
const NOT_BROWSING = ["/app/start", "/app/new", "/app/settings", "/app/support", "/app/consent"];

/** A note's tab row: switching tabs is looking at a new screen. */
const NOTE_TAB = ".memo-tabs button";

export function PaywallNudge() {
  const pathname = usePathname();
  const router = useRouter();
  // The page last counted, so an effect that runs twice counts it once.
  const counted = useRef<string | null>(null);

  useEffect(() => {
    if (!pathname || NOT_BROWSING.some((path) => pathname.startsWith(path))) {
      counted.current = null;
      return;
    }

    function openOffer() {
      // A fresh address each time, so the router never shows an earlier offer
      // it kept; the price is the server's either way.
      router.push(`${paywallPath("offer", pathname)}&t=${Date.now()}`);
    }

    // A new page is a screen.
    if (counted.current !== pathname) {
      counted.current = pathname;

      if (countOfferScreen()) {
        openOffer();
        return;
      }
    }

    // So is a new tab on a note, which does not change the address. Read in
    // the capture phase, before the click re-renders which tab is current.
    function onClick(event: MouseEvent) {
      const tab = event.target instanceof Element ? event.target.closest(NOTE_TAB) : null;

      if (!tab || tab.getAttribute("aria-current") === "page" || !countOfferScreen()) {
        return;
      }

      // Let the tab open first, so the offer lands on top of what they chose.
      window.setTimeout(() => {
        if (window.location.pathname === pathname) {
          openOffer();
        }
      }, 700);
    }

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [pathname, router]);

  return null;
}
