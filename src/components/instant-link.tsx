"use client";

import Link, { type LinkProps } from "next/link";
import { useRouter } from "next/navigation";
import {
  forwardRef,
  useCallback,
  useEffect,
  type AnchorHTMLAttributes,
} from "react";

import { useAppHref } from "@/components/creator-demo/creator-demo-context";
import {
  shouldHandleLinkNavigation,
  useNavigationFeedback,
} from "@/components/navigation-loading";
import { safeRouterPrefetch } from "@/lib/safe-router-prefetch";

type InstantLinkProps = LinkProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
    href: string;
  };

/**
 * True for a path the app's own router owns. Anything else — an absolute URL,
 * a protocol-relative one, `mailto:` — leaves the document, which the feedback
 * path cannot see the end of: it would hold its overlay until the failsafe.
 */
function isInAppPath(href: string) {
  return href.startsWith("/") && !href.startsWith("//");
}

/**
 * The app's link. It prefetches on intent, and — this is the "instant" part —
 * routes the click through the layout's navigation feedback so the destination's
 * skeleton paints in the click frame. Doing that here rather than at each call
 * site is what makes it hold for every link in the app: a plain `<Link>` gives
 * no sign it was clicked until the server answers, which on a slow connection
 * is a second of a screen that looks like it ignored the tap.
 */
export const InstantLink = forwardRef<HTMLAnchorElement, InstantLinkProps>(function InstantLink(
  { href: rawHref, onClick, onPointerDown, onMouseEnter, onFocus, replace, scroll, prefetch, ...props },
  ref,
) {
  const router = useRouter();
  const href = useAppHref(rawHref);
  const navigationFeedback = useNavigationFeedback();
  const shouldPrefetchOnMount = prefetch === true;
  const shouldPrefetchOnIntent = prefetch !== false;

  const prefetchHref = useCallback((options?: { force?: boolean }) => {
    if (!options?.force && !shouldPrefetchOnMount) {
      return;
    }

    safeRouterPrefetch(router, href);
  }, [href, router, shouldPrefetchOnMount]);

  const prefetchHrefOnIntent = useCallback(() => {
    if (!shouldPrefetchOnIntent) {
      return;
    }

    safeRouterPrefetch(router, href);
  }, [href, router, shouldPrefetchOnIntent]);

  useEffect(() => {
    prefetchHref();
  }, [prefetchHref]);

  return (
    <Link
      {...props}
      ref={ref}
      href={href}
      replace={replace}
      scroll={scroll}
      prefetch={false}
      onPointerDown={(event) => {
        prefetchHrefOnIntent();
        onPointerDown?.(event);
      }}
      onMouseEnter={(event) => {
        prefetchHrefOnIntent();
        onMouseEnter?.(event);
      }}
      onFocus={(event) => {
        prefetchHrefOnIntent();
        onFocus?.(event);
      }}
      onClick={(event) => {
        onClick?.(event);

        /*
         * `replace` and `scroll` are `router.push` options the feedback path
         * does not take, so a link that asks for either keeps the plain
         * navigation. `shouldHandleLinkNavigation` re-checks `defaultPrevented`,
         * which is how a call site that already handled the click itself opts
         * out of being handled twice.
         */
        if (
          !navigationFeedback ||
          !isInAppPath(href) ||
          replace ||
          scroll === false ||
          !shouldHandleLinkNavigation(event)
        ) {
          return;
        }

        event.preventDefault();
        navigationFeedback.navigateWithFeedback(href);
      }}
    />
  );
});
