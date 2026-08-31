"use client";

import { ChevronLeft, Loader2 } from "lucide-react";
import { useState, type MouseEvent } from "react";

import { useT } from "@/components/i18n-provider";

/**
 * The way out of the auth pages, back to the landing page.
 *
 * It is a plain `<a>` on purpose — the landing page is a different shell and
 * wants a fresh document — which means the click hands control to the browser
 * and React can no longer say anything. On a slow connection that is a second
 * of a page that looks like it ignored the tap, so the chevron becomes a
 * spinner in the click frame and stays one until the document is replaced.
 */
export function AuthBackLink({
  href = "/",
  className = "app-back-button",
  label,
}: {
  href?: string;
  className?: string;
  label?: string;
}) {
  const t = useT();
  const [isLeaving, setIsLeaving] = useState(false);

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    // Anything the browser would open elsewhere (or has already been handled)
    // is not this navigation, and must not put the link in a state nothing
    // will ever clear.
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }

    setIsLeaving(true);
  }

  return (
    <a href={href} className={className} aria-busy={isLeaving} onClick={handleClick}>
      {isLeaving ? (
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
      ) : (
        <ChevronLeft className="h-5 w-5" aria-hidden="true" />
      )}
      {label ?? t("common.back")}
    </a>
  );
}
