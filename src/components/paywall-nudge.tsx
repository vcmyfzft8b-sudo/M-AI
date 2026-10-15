"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

import { countOfferScreen, noteOfferAccount } from "@/lib/paywall-offer-timing";
import { paywallPath } from "@/lib/paywall-reasons";

/**
 * The offer that finds a free learner while they browse.
 *
 * A learner who never runs into a limit would meet no paywall after the one at
 * the end of onboarding. Instead, every few things they open — a note, a page,
 * a tab on a note (`paywall-offer-timing.ts`) — that click opens the upgrade
 * screen as an offer (`?for=offer`) in place of what they tapped, exactly as a
 * limit would. Each one is a rung up the ladder (`paywall-ladder.ts`): 20 %,
 * then 30 %, then 40 %, which it then keeps. Closing it returns to where they
 * were; tapping again goes through, and the count starts again.
 *
 * Only a click opens it, never arriving on a page, going back or reloading.
 * Never on the screens where it would interrupt something that cannot be
 * resumed or has nothing to do with studying: a recording, settings, support.
 * Web only: the layout does not mount it in the app, which sells at Apple's
 * prices.
 */

/** Paths that neither count as browsing nor open an offer. */
const NOT_BROWSING = ["/app/start", "/app/new", "/app/settings", "/app/support", "/app/consent"];

/** Movement past which a press is a drag, not a tap. */
const DRAG_PX = 10;

/** What counts as opening something: a link in the app, a note row, a note tab. */
const OPENS = 'a[href], [role="link"], .memo-tabs button';

function isBrowsing(path: string) {
  return (path === "/app" || path.startsWith("/app/")) && !NOT_BROWSING.some((blocked) => path.startsWith(blocked));
}

/** Whether this click opens something new in the app. */
function opensSomething(target: Element, from: string) {
  if (target.matches(".memo-tabs button")) {
    return target.getAttribute("aria-current") !== "page";
  }

  if (target instanceof HTMLAnchorElement) {
    if (target.target === "_blank" || target.hasAttribute("download")) {
      return false;
    }

    const url = new URL(target.href, window.location.href);
    return url.origin === window.location.origin && isBrowsing(url.pathname) && url.pathname !== from;
  }

  // A row that opens a note on a phone.
  return true;
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

    // Where the press started: a click that ends a drag (a swiped row) opens
    // nothing, and the row ignores it too.
    let pressedAt: { x: number; y: number } | null = null;

    function onPointerDown(event: PointerEvent) {
      pressedAt = { x: event.clientX, y: event.clientY };
    }

    // In the capture phase: before the click does anything, and before it
    // re-renders which tab is current.
    function onClick(event: MouseEvent) {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }

      const dragged =
        pressedAt !== null && Math.hypot(event.clientX - pressedAt.x, event.clientY - pressedAt.y) > DRAG_PX;
      pressedAt = null;
      const target = event.target instanceof Element ? event.target.closest(OPENS) : null;

      if (
        dragged ||
        !target ||
        // A tap on a row with its actions showing closes them, not the row.
        target.closest(".memo-swipe-row.open") ||
        !opensSomething(target, pathname!) ||
        !countOfferScreen()
      ) {
        return;
      }

      // This click hits the offer instead of what it would have opened.
      event.preventDefault();
      event.stopPropagation();
      // A fresh address each time, so the router never shows an earlier offer
      // it kept; the price is the server's either way.
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
