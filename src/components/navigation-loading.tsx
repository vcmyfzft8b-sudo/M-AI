"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useTransition,
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

/**
 * How long the router waits for the overlay to paint before starting anyway.
 * Two frames at 60Hz plus room for a slow one — and, on a hidden document
 * where no frame ever comes, the whole of the wait.
 */
const NAVIGATION_PAINT_FLOOR_MS = 64;

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
    // The demo shows the same home screen but is a public page; the promo hint
    // on this browser belongs to whoever signed in on it, not to the demo.
    return <DashboardLoading promoPlaceholder={!demoBasePath} />;
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
  /**
   * Pathname the pending navigation is headed for, or null when none is in
   * flight. A page that has to take itself apart before it is replaced (the
   * note screen's chat column, which lives outside the overlay) compares this
   * with its own path: while the destination is still this page, the
   * navigation is the one that arrived here, not one leaving.
   */
  navigatingTo: string | null;
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
  const { navigateWithFeedback, overlay, isNavigating, navigatingTo } = useInstantNavigationState();

  return (
    <NavigationFeedbackContext.Provider
      value={{ navigateWithFeedback, isNavigating, navigatingTo }}
    >
      {children}
      {overlay}
    </NavigationFeedbackContext.Provider>
  );
}

/**
 * The layout-hosted feedback, or null outside a provider. `InstantLink` uses this rather than
 * `useInstantNavigation` because it renders no overlay of its own: without a provider there is
 * nothing to show the fallback overlay in, so the link must stay an ordinary link instead of
 * delaying the push for a skeleton nobody will see.
 */
export function useNavigationFeedback() {
  return useContext(NavigationFeedbackContext);
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
  const cancelPaintWaitRef = useRef<(() => void) | null>(null);
  const [isRouting, startRouting] = useTransition();
  // Whether the transition below has actually begun, so that the ~two frames
  // between the click and `router.push` are not read as a finished navigation.
  const [routingStarted, setRoutingStarted] = useState(false);
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

  // The comparison above cannot see a destination that redirects straight back
  // to where the click came from: the URL never changes, so the target is
  // never reached and nowhere else is either, and the overlay would stand
  // until the failsafe. Routing inside a transition gives the signal that
  // catches it — the router has finished, and we are not where we were going.
  if (isRouting && !routingStarted) {
    setRoutingStarted(true);
  }

  if (!isRouting && routingStarted) {
    setRoutingStarted(false);

    if (pending && getPathnameFromHref(pending.href) !== currentPathname) {
      setPending(null);
    }
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
      cancelPaintWaitRef.current?.();
    },
    [],
  );

  /**
   * Runs `start` once the overlay has had a frame to paint.
   *
   * A hidden document never fires `requestAnimationFrame`, so waiting on it
   * alone strands the navigation until the tab comes back — the tap does
   * nothing, which is worse than the missing skeleton this file exists to fix.
   * The timer is the floor: whichever comes first wins, and the other is
   * dropped.
   */
  function afterPaint(start: () => void) {
    cancelPaintWaitRef.current?.();

    let frameId: number | null = null;
    let innerFrameId: number | null = null;

    const run = () => {
      cancelPaintWaitRef.current?.();
      start();
    };

    cancelPaintWaitRef.current = () => {
      cancelPaintWaitRef.current = null;

      if (frameId != null) {
        window.cancelAnimationFrame(frameId);
      }

      if (innerFrameId != null) {
        window.cancelAnimationFrame(innerFrameId);
      }

      window.clearTimeout(timeoutId);
    };

    const timeoutId = window.setTimeout(run, NAVIGATION_PAINT_FLOOR_MS);

    frameId = window.requestAnimationFrame(() => {
      frameId = null;
      innerFrameId = window.requestAnimationFrame(() => {
        innerFrameId = null;
        run();
      });
    });
  }

  function navigateWithFeedback(rawHref: string) {
    const href = mapAppHref(rawHref, demoBasePath);
    const targetPathname = getPathnameFromHref(href);

    // Same page (e.g. only the query changes): nothing is going to be replaced,
    // so an overlay would only flash over content that stays put.
    if (disabled || targetPathname === currentPathname) {
      router.push(href);
      return;
    }

    setPending({
      href,
      top: getVisibleAppHeaderBottom(),
      left: getVisibleAppSidebarRight(),
      fromPathname: currentPathname,
    });

    // Two frames: enough for the overlay to be on screen before the router
    // starts competing for the main thread.
    afterPaint(() => startRouting(() => router.push(href)));
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
    pending && !skeleton
      ? /*
         * The destination has no skeleton of its own (the onboarding/paywall
         * takeover, a dev route). Standing a wrong skeleton in for it would
         * lie about where the click is going, and doing nothing is the bug
         * this whole file exists to fix — so the feedback is a progress bar
         * pinned to the top of the viewport. It paints in the click frame,
         * covers nothing, and needs to know nothing about the target.
         */
        createPortal(
          <div className="navigation-progress memo-portal" data-navigation-overlay="" role="status">
            <span className="navigation-progress-bar" />
          </div>,
          document.body,
        )
      : pending && skeleton
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

  return {
    navigateWithFeedback,
    overlay,
    isNavigating: pending != null,
    navigatingTo: pending ? getPathnameFromHref(pending.href) : null,
  };
}
