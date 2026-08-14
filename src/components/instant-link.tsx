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
import { safeRouterPrefetch } from "@/lib/safe-router-prefetch";

type InstantLinkProps = LinkProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
    href: string;
  };

export const InstantLink = forwardRef<HTMLAnchorElement, InstantLinkProps>(function InstantLink(
  { href: rawHref, onClick, onPointerDown, onMouseEnter, onFocus, replace, scroll, prefetch, ...props },
  ref,
) {
  const router = useRouter();
  const href = useAppHref(rawHref);
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
      }}
    />
  );
});
