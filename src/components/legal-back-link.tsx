"use client";

import type { MouseEvent, ReactNode } from "react";

import {
  shouldHandleLinkNavigation,
  useNavigationFeedback,
} from "@/components/navigation-loading";

/**
 * The way out of a public legal document.
 *
 * These pages are opened from everywhere — the landing footer, the sign-in
 * card, the iOS consent screen, in-app settings — so one fixed destination is
 * wrong almost everywhere: sending a reader "home" from Settings throws away
 * the screen they were on, and in the iOS wrapper "/" is the sign-in page.
 * When there is history to return to, the arrow simply returns to it.
 *
 * It stays a real `<a href>` so a crawler, a middle click and a cold open from
 * a search result all still reach the home page. The history check happens in
 * the click handler rather than in render or an effect: it only has an answer
 * on the client, and asking for it at the moment of the click is also the only
 * moment the answer is current.
 *
 * Going back is instant — the browser has the previous page — but the fallback
 * is a whole new document, so that branch is routed through the app's
 * navigation feedback instead: the progress bar paints in the click frame,
 * which is the only sign the tap landed inside the iOS wrapper, where there is
 * no browser chrome to show one.
 */
export function LegalBackLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: ReactNode;
}) {
  const navigationFeedback = useNavigationFeedback();

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    // Anything the browser would open elsewhere (or has already handled) is
    // not this navigation and must keep the link's own href.
    if (!shouldHandleLinkNavigation(event)) {
      return;
    }

    if (window.history.length > 1) {
      event.preventDefault();
      window.history.back();
      return;
    }

    if (navigationFeedback) {
      event.preventDefault();
      navigationFeedback.navigateWithFeedback(href);
    }
  }

  return (
    <a href={href} className={className} onClick={handleClick}>
      {children}
    </a>
  );
}
