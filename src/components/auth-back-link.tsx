"use client";

import { useState, type MouseEvent } from "react";

import { useT } from "@/components/i18n-provider";
import { Msym } from "@/components/msym";

/**
 * The way out of the auth pages, back to the landing page.
 *
 * It is a plain `<a>` on purpose — the landing page is a different shell and
 * wants a fresh document — which means the click hands control to the browser
 * and React can no longer say anything. On a slow connection that is a second
 * of a page that looks like it ignored the tap, so the arrow becomes a
 * spinner in the click frame and stays one until the document is replaced.
 *
 * The label is the accessible name rather than visible text: this is the app's
 * round icon button, the same control the note header and every sheet use.
 */
export function AuthBackLink({
  href = "/",
  className = "memo-auth-back",
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
    <a
      href={href}
      className={className}
      aria-label={label ?? t("common.back")}
      aria-busy={isLeaving}
      onClick={handleClick}
    >
      <Msym
        name={isLeaving ? "progress_activity" : "arrow_back"}
        fill={false}
        weight={500}
        className={isLeaving ? "memo-spin" : undefined}
      />
    </a>
  );
}
