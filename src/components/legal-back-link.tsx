"use client";

import type { MouseEvent, ReactNode } from "react";

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
  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    // Anything the browser would open elsewhere (or has already handled) is
    // not this navigation and must keep the link's own href.
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      window.history.length <= 1
    ) {
      return;
    }

    event.preventDefault();
    window.history.back();
  }

  return (
    <a href={href} className={className} onClick={handleClick}>
      {children}
    </a>
  );
}
