"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  Suspense,
  useEffect,
  useSyncExternalStore,
  type ComponentProps,
} from "react";

/**
 * Navigation feedback for the dashboard.
 *
 * `loading.tsx` covers moving between pages, but most of this dashboard's
 * navigation only changes a query parameter — the range, the charted metric, a
 * filter, the chart's daily/cumulative view. That re-renders the same route
 * segment, so no loading file fires and a click looked like nothing had
 * happened until the server answered a second later.
 *
 * Two things now say the click landed. The control itself dims, and a hairline
 * fills across the top of the page. The bar is deliberately *not* rendered
 * inside the link: on a phone the nav lives in a drawer that closes the moment
 * a link is tapped, and a bar owned by that link would unmount with it, leaving
 * the tap looking ignored exactly where the wait is longest. The link only
 * reports into the store below, and one bar mounted in the layout reads it.
 */

let navigating = false;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

function isNavigating() {
  return navigating;
}

/** The server never renders the bar; it has nothing to be pending about. */
function isNavigatingOnServer() {
  return false;
}

/**
 * Report that a control has started a navigation.
 *
 * Exported because not every navigation goes through a link — the filter row
 * and the search box push a new URL from an event handler.
 */
export function startNavigation() {
  if (navigating) {
    return;
  }

  navigating = true;
  emit();
}

function endNavigation() {
  if (!navigating) {
    return;
  }

  navigating = false;
  emit();
}

/** A link that has been clicked but whose page has not arrived yet. */
function PendingMarker() {
  const { pending } = useLinkStatus();

  useEffect(() => {
    if (pending) {
      startNavigation();
    }
  }, [pending]);

  if (!pending) {
    return null;
  }

  // `useLinkStatus` can only be read from inside the link, so it cannot set an
  // attribute on the anchor. The marker stands in for one, and the stylesheet
  // dims the control around it with `:has()`.
  return <span className="admin-pending-marker" aria-hidden="true" />;
}

export function PendingLink({
  children,
  onClick,
  ...props
}: ComponentProps<typeof Link>) {
  /**
   * The click, not the render, is what starts the bar.
   *
   * `PendingMarker` alone is not enough: the mobile drawer closes on tap, so
   * its link unmounts in the same commit and the pending render — with the
   * effect that would have reported it — never happens. Reading the click
   * directly covers that, and every other link too.
   */
  function handleClick(event: React.MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);

    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      props.target === "_blank"
    ) {
      return;
    }

    // A link back to the page you are already on commits nothing, so nothing
    // would ever clear the bar but the timeout.
    if (typeof props.href === "string") {
      try {
        if (new URL(props.href, window.location.href).href === window.location.href) {
          return;
        }
      } catch {
        // A malformed href is the router's problem, not this bar's.
      }
    }

    startNavigation();
  }

  return (
    <Link {...props} prefetch={props.prefetch ?? false} onClick={handleClick}>
      {children}
      <PendingMarker />
    </Link>
  );
}

function ProgressBar() {
  const active = useSyncExternalStore(
    subscribe,
    isNavigating,
    isNavigatingOnServer,
  );
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const url = `${pathname}?${searchParams}`;

  // The App Router only swaps the URL once the new page has committed, so
  // arriving somewhere is the signal that the navigation is over.
  useEffect(() => {
    endNavigation();
  }, [url]);

  // A navigation that never commits — a dropped request, or a link back to the
  // page you are already on — must not leave the bar running for ever.
  useEffect(() => {
    if (!active) {
      return;
    }

    const timer = window.setTimeout(endNavigation, 20_000);

    return () => window.clearTimeout(timer);
  }, [active]);

  if (!active) {
    return null;
  }

  return (
    <>
      <span className="admin-progress" aria-hidden="true" />
      <span className="sr-only" role="status">
        Loading
      </span>
    </>
  );
}

/**
 * The dashboard-wide loading bar. Mount once, in the layout.
 *
 * `useSearchParams` suspends while the router works out the query string, and
 * a suspended progress bar is worse than none, so it gets its own boundary.
 */
export function NavigationProgress() {
  return (
    <Suspense fallback={null}>
      <ProgressBar />
    </Suspense>
  );
}
