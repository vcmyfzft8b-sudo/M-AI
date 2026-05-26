"use client";

import Link, { type LinkProps } from "next/link";
import { useRouter } from "next/navigation";
import {
  forwardRef,
  useCallback,
  useEffect,
  type AnchorHTMLAttributes,
} from "react";

import { safeRouterPrefetch } from "@/lib/safe-router-prefetch";

type InstantLinkProps = LinkProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
    href: string;
  };

export const InstantLink = forwardRef<HTMLAnchorElement, InstantLinkProps>(function InstantLink(
  { href, onClick, onPointerDown, onMouseEnter, onFocus, replace, scroll, prefetch, ...props },
  ref,
) {
  const router = useRouter();
  const shouldPrefetch = prefetch ?? true;

  const prefetchHref = useCallback(() => {
    if (!shouldPrefetch) {
      return;
    }

    safeRouterPrefetch(router, href);
  }, [href, router, shouldPrefetch]);

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
        prefetchHref();
        onPointerDown?.(event);
      }}
      onMouseEnter={(event) => {
        prefetchHref();
        onMouseEnter?.(event);
      }}
      onFocus={(event) => {
        prefetchHref();
        onFocus?.(event);
      }}
      onClick={(event) => {
        onClick?.(event);
      }}
    />
  );
});
