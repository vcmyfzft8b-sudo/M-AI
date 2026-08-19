"use client";

import Link, { useLinkStatus } from "next/link";
import type { ComponentProps } from "react";

/**
 * A link that shows it has been clicked.
 *
 * `loading.tsx` covers moving between pages, but most of this dashboard's
 * navigation only changes a query parameter — the range, the charted metric, a
 * filter. That re-renders the same route segment, so no loading file fires and
 * a click looked like nothing had happened until the server answered a second
 * later.
 *
 * `useLinkStatus` reports the pending state of the nearest link, but it can
 * only be read from *inside* that link, so it cannot set an attribute on the
 * anchor itself. Instead a marker element is rendered while pending, and the
 * stylesheet dims the control with `:has()`. The marker also carries the
 * fixed-position progress bar, so the page shows movement the instant a
 * control is pressed.
 */
function PendingMarker() {
  const { pending } = useLinkStatus();

  if (!pending) {
    return null;
  }

  return (
    <>
      <span className="admin-pending-marker" aria-hidden="true" />
      <span className="admin-progress" aria-hidden="true" />
      <span className="sr-only" role="status">
        Loading
      </span>
    </>
  );
}

export function PendingLink({
  children,
  ...props
}: ComponentProps<typeof Link>) {
  return (
    <Link {...props} prefetch={props.prefetch ?? false}>
      {children}
      <PendingMarker />
    </Link>
  );
}
