"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { DashboardLoading } from "@/components/dashboard-loading";
import { LectureWorkspaceLoading } from "@/components/lecture-loading";
import { SettingsLoading } from "@/components/settings-loading";
import { SupportArticleLoading, SupportIndexLoading } from "@/components/support-loading";
import { useCreatorDemoBasePath } from "@/components/creator-demo/creator-demo-context";
import { getVisibleAppHeaderBottom } from "@/lib/app-header-offset";
import { mapAppHref, unmapDemoPathname } from "@/lib/creator-demo/paths";

/**
 * If a navigation never lands (offline, crashed transition), release the
 * overlay so the current page becomes usable again.
 */
const NAVIGATION_FAILSAFE_MS = 12000;

function getPathnameFromHref(href: string) {
  const cutIndex = href.search(/[?#]/);
  return cutIndex === -1 ? href : href.slice(0, cutIndex);
}

/** Skeleton matching what the target route will render, or null if it has none. */
function getNavigationSkeleton(href: string, demoBasePath: string | null): ReactNode | null {
  const pathname = unmapDemoPathname(getPathnameFromHref(href), demoBasePath);

  if (pathname.startsWith("/app/lectures/")) {
    return <LectureWorkspaceLoading />;
  }

  if (pathname === "/app/support") {
    return <SupportIndexLoading />;
  }

  if (pathname.startsWith("/app/support/")) {
    return <SupportArticleLoading />;
  }

  if (pathname === "/app/settings") {
    return <SettingsLoading />;
  }

  if (pathname === "/app") {
    return <DashboardLoading />;
  }

  return null;
}

/** True when a plain left-click that should get instant loading feedback. */
export function shouldHandleLinkNavigation(event: MouseEvent<HTMLAnchorElement>) {
  return (
    !event.defaultPrevented &&
    event.button === 0 &&
    !event.metaKey &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    event.currentTarget.target !== "_blank"
  );
}

/**
 * Client-side navigation with instant skeleton feedback: paints the target
 * route's loading skeleton as a full-screen overlay in the click frame, then
 * hands the browser one frame to render it before router.push starts fetching.
 */
export function useInstantNavigation() {
  const router = useRouter();
  const currentPathname = usePathname();
  const demoBasePath = useCreatorDemoBasePath();
  const frameRef = useRef<number | null>(null);
  const [pending, setPending] = useState<{ href: string; top: number } | null>(null);

  // Navigation landed → drop the overlay (state adjustment during render).
  if (pending && getPathnameFromHref(pending.href) === currentPathname) {
    setPending(null);
  }

  useEffect(() => {
    if (!pending) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setPending(null);
    }, NAVIGATION_FAILSAFE_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [pending]);

  useEffect(
    () => () => {
      if (frameRef.current != null) {
        window.cancelAnimationFrame(frameRef.current);
      }
    },
    [],
  );

  function navigateWithFeedback(rawHref: string) {
    const href = mapAppHref(rawHref, demoBasePath);
    const targetPathname = getPathnameFromHref(href);

    // Same page (e.g. only the query changes) or a route without a skeleton:
    // navigate normally, an overlay would flash or lie about the destination.
    if (targetPathname === currentPathname || !getNavigationSkeleton(href, demoBasePath)) {
      router.push(href);
      return;
    }

    setPending({ href, top: getVisibleAppHeaderBottom() });

    // Double rAF guarantees the skeleton is painted before the router starts.
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null;
        router.push(href);
      });
    });
  }

  const skeleton = pending ? getNavigationSkeleton(pending.href, demoBasePath) : null;
  const overlay =
    pending && skeleton
      ? createPortal(
          <div
            className="navigation-loading-overlay"
            role="status"
            style={{ top: `${pending.top}px` }}
          >
            {skeleton}
          </div>,
          document.body,
        )
      : null;

  return { navigateWithFeedback, overlay, isNavigating: pending != null };
}
