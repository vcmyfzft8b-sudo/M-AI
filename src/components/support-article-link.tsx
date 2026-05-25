"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";

import { EmojiIcon } from "@/components/emoji-icon";
import { SupportArticleLoading } from "@/components/support-loading";

function shouldShowNavigationFeedback(event: MouseEvent<HTMLAnchorElement>) {
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

export function SupportArticleLink({
  href,
  title,
}: {
  href: string;
  title: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [isNavigating, setIsNavigating] = useState(false);
  const navigationTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (navigationTimeoutRef.current != null) {
        window.clearTimeout(navigationTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isNavigating) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setIsNavigating(false);
    }, 12000);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [isNavigating]);

  return (
    <>
      <Link
        href={href}
        prefetch={false}
        className="dashboard-link-card"
        aria-busy={isNavigating}
        onClick={(event) => {
          if (!shouldShowNavigationFeedback(event) || pathname === href) {
            return;
          }

          event.preventDefault();
          if (navigationTimeoutRef.current != null) {
            window.clearTimeout(navigationTimeoutRef.current);
          }

          setIsNavigating(true);
          navigationTimeoutRef.current = window.setTimeout(() => {
            router.push(href);
          }, 180);
        }}
      >
        <p className="dashboard-link-card-title">{title}</p>
        <EmojiIcon className="ios-chevron" symbol="›" size="1.1rem" />
      </Link>

      {isNavigating ? createPortal(
        <div className="support-navigation-loading-overlay" role="status">
          <SupportArticleLoading />
        </div>,
        document.body,
      ) : null}
    </>
  );
}
