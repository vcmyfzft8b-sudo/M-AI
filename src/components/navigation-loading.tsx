"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { DashboardLoading } from "@/components/dashboard-loading";
import { LectureWorkspaceLoading } from "@/components/lecture-loading";
import { SettingsLoading } from "@/components/settings-loading";
import { SupportArticleLoading, SupportIndexLoading } from "@/components/support-loading";
import { useCreatorDemoBasePath } from "@/components/creator-demo/creator-demo-context";
import { getVisibleAppHeaderBottom, getVisibleAppSidebarRight } from "@/lib/app-header-offset";
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
/**
 * True while the newly committed route is still showing its own loading.tsx skeleton under the
 * overlay. Route skeletons carry data-route-skeleton; the overlay renders the same components,
 * so anything inside the overlay itself does not count.
 */
function routeSkeletonStillMounted() {
  return [...document.querySelectorAll("[data-route-skeleton]")].some(
    (element) => !element.closest("[data-navigation-overlay]"),
  );
}

type NavigationFeedback = {
  navigateWithFeedback: (href: string) => void;
  isNavigating: boolean;
};

const NavigationFeedbackContext = createContext<NavigationFeedback | null>(null);

/**
 * Owns the overlay for a whole layout segment. The overlay must NOT be rendered by the page that
 * starts the navigation: that page unmounts the instant the new route commits, taking the overlay
 * with it and exposing the target's loading.tsx skeleton mid-stream — the two-skeletons flicker.
 * Hosted here, in the persistent layout, the overlay lives until the destination's real content
 * has mounted.
 */
export function NavigationFeedbackProvider({ children }: { children: ReactNode }) {
  const { navigateWithFeedback, overlay, isNavigating } = useInstantNavigationState();

  return (
    <NavigationFeedbackContext.Provider value={{ navigateWithFeedback, isNavigating }}>
      {children}
      {overlay}
    </NavigationFeedbackContext.Provider>
  );
}

/**
 * Navigation with instant skeleton feedback. Consumers under a NavigationFeedbackProvider (every
 * /app and /creator page) share the layout-hosted overlay; the returned `overlay` is then null
 * and rendering it is a no-op, which keeps existing call sites unchanged. Without a provider it
 * falls back to owning the overlay locally.
 */
export function useInstantNavigation() {
  const context = useContext(NavigationFeedbackContext);
  const local = useInstantNavigationState({ disabled: context != null });

  if (context) {
    return { ...context, overlay: null as ReactNode };
  }

  return local;
}

function useInstantNavigationState(options?: { disabled?: boolean }) {
  const disabled = options?.disabled === true;
  const router = useRouter();
  const currentPathname = usePathname();
  const demoBasePath = useCreatorDemoBasePath();
  const frameRef = useRef<number | null>(null);
  const [pending, setPending] = useState<{
    href: string;
    top: number;
    left: number;
    fromPathname: string;
  } | null>(null);

  // A navigation that lands somewhere other than the target (a redirect, another click) must
  // release the overlay immediately — holding a skeleton for a page we are not on is the glitch.
  if (
    pending &&
    currentPathname !== pending.fromPathname &&
    getPathnameFromHref(pending.href) !== currentPathname
  ) {
    setPending(null);
  }

  // The target committed. The URL flips while the route is still streaming its loading.tsx,
  // and dropping the overlay at that moment swaps one skeleton for a second copy of itself at a
  // slightly different layout position — the visible "skeletons switching" flicker. Hold the
  // overlay until the route skeleton underneath has unmounted, i.e. real content exists.
  const landedOnTarget =
    pending != null && getPathnameFromHref(pending.href) === currentPathname;

  useEffect(() => {
    if (!landedOnTarget) {
      return;
    }

    let frameId: number;

    const releaseWhenContentReady = () => {
      if (routeSkeletonStillMounted()) {
        frameId = window.requestAnimationFrame(releaseWhenContentReady);
        return;
      }

      setPending(null);
    };

    frameId = window.requestAnimationFrame(releaseWhenContentReady);

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [landedOnTarget]);

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
    if (disabled || targetPathname === currentPathname || !getNavigationSkeleton(href, demoBasePath)) {
      router.push(href);
      return;
    }

    setPending({
      href,
      top: getVisibleAppHeaderBottom(),
      left: getVisibleAppSidebarRight(),
      fromPathname: currentPathname,
    });

    // Double rAF guarantees the skeleton is painted before the router starts.
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null;
        router.push(href);
      });
    });
  }

  const skeleton = pending ? getNavigationSkeleton(pending.href, demoBasePath) : null;
  // The overlay lives inside the persistent shell content container whenever one exists, so it
  // inherits exactly the width, centering and padding the real page content gets — a skeleton
  // that is wider or narrower than the content it stands in for reads as a layout jump. The
  // fixed-position portal into body remains only as a fallback for pages without the shell.
  const contentHost =
    pending && typeof document !== "undefined"
      ? document.querySelector<HTMLElement>(".app-shell-content")
      : null;
  const overlay =
    pending && skeleton
      ? contentHost
        ? createPortal(
            <div
              className="navigation-loading-overlay-in-content"
              data-navigation-overlay=""
              role="status"
            >
              {skeleton}
            </div>,
            contentHost,
          )
        : createPortal(
            /*
             * `memo-portal` carries the redesign's token block. The fallback
             * portals onto `document.body`, outside the `.memo` shell, where
             * `--bg` and the `--memo-safe-*` insets are undefined — which makes
             * every `calc()` built on them invalid and collapses the skeleton
             * into a narrow, transparent box. This is the same wrapper
             * `MemoPortal` uses for sheets, for the same reason.
             */
            <div
              className="navigation-loading-overlay memo-portal"
              data-navigation-overlay=""
              role="status"
              style={{ top: `${pending.top}px`, left: `${pending.left}px` }}
            >
              {skeleton}
            </div>,
            document.body,
          )
      : null;

  return { navigateWithFeedback, overlay, isNavigating: pending != null };
}
