"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

import { LAST_PAYWALL_KEY, offerIsDue } from "@/lib/paywall-offer-timing";
import { paywallPath } from "@/lib/paywall-reasons";

/**
 * The offer that finds a free learner while they browse.
 *
 * A learner who never runs into a limit never meets a paywall after the one at
 * the end of onboarding. This shows them the upgrade screen now and then
 * anyway, as an offer (`?for=offer`), and every one of them moves the learner a
 * rung up the ladder (`paywall-ladder.ts`): 20 %, then 30 %, then 40 %, after
 * which it keeps showing the 40 % it reached. A feature limit met after an offer
 * starts from the better rung too.
 *
 * It opens only on the way back to the home screen after the learner has looked
 * at a few screens, never in the middle of a note, a recording or settings; it
 * stays away for a while after any paywall, the browsing offers included, so
 * two paywalls never come back to back. Web only: the layout does not mount it
 * in the app, which sells at Apple's prices.
 *
 * The clocks are this browser's own (localStorage), a convenience rather than a
 * record: losing them only means an offer comes a little sooner. What the offer
 * is worth lives in the server's cookie, never here.
 */

const LAST_OFFER_KEY = "memo-offer-last-shown";
const SCREENS_KEY = "memo-offer-screens";

/** Paths an offer must never interrupt or count as browsing. */
const NOT_BROWSING = ["/app/start", "/app/new", "/app/settings", "/app/support", "/app/consent"];

function readNumber(storage: Storage, key: string) {
  const value = Number(storage.getItem(key));
  return Number.isFinite(value) ? value : 0;
}

export function PaywallNudge() {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!pathname || NOT_BROWSING.some((path) => pathname.startsWith(path))) {
      return;
    }

    let due = false;
    const now = Date.now();

    try {
      const screens = readNumber(window.sessionStorage, SCREENS_KEY) + 1;
      window.sessionStorage.setItem(SCREENS_KEY, String(screens));

      due =
        pathname === "/app" &&
        document.visibilityState === "visible" &&
        offerIsDue({
          now,
          screens,
          lastPaywall: readNumber(window.localStorage, LAST_PAYWALL_KEY),
          lastOffer: readNumber(window.localStorage, LAST_OFFER_KEY),
        });

      if (due) {
        window.sessionStorage.setItem(SCREENS_KEY, "0");
        window.localStorage.setItem(LAST_OFFER_KEY, String(now));
      }
    } catch {
      return;
    }

    if (!due) {
      return;
    }

    // Recorded before it opens, so the screen shows the rung it just reached.
    // Not cancelled by a re-render (the offer is already spent by then); it only
    // checks the learner is still on the home screen before opening.
    void fetch("/api/billing/paywall-view", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "offer" }),
    })
      .then((response) =>
        response.ok ? (response.json() as Promise<{ advanced?: boolean; seen?: unknown[] }>) : null,
      )
      .then((body) => {
        if (!body || window.location.pathname !== "/app") {
          return;
        }

        /*
         * Each rung gets its own address. The client router keeps a rendered
         * page for a while, and the second offer at the first one's address
         * came back with the first one's price; the server still reads the
         * price from the cookie, never from this.
         */
        const href = `${paywallPath("offer", "/app")}&rung=${body.seen?.length ?? 0}`;
        router.push(body.advanced ? `${href}&better=1` : href);
      })
      .catch(() => null);
  }, [pathname, router]);

  return null;
}
