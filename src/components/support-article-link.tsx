"use client";

import Link from "next/link";

import { useAppHref } from "@/components/creator-demo/creator-demo-context";
import { EmojiIcon } from "@/components/emoji-icon";
import {
  shouldHandleLinkNavigation,
  useInstantNavigation,
} from "@/components/navigation-loading";

export function SupportArticleLink({
  href: rawHref,
  title,
}: {
  href: string;
  title: string;
}) {
  const href = useAppHref(rawHref);
  const { navigateWithFeedback, overlay, isNavigating } = useInstantNavigation();

  return (
    <>
      <Link
        href={href}
        prefetch={false}
        className="dashboard-link-card"
        aria-busy={isNavigating}
        onClick={(event) => {
          if (!shouldHandleLinkNavigation(event)) {
            return;
          }

          event.preventDefault();
          navigateWithFeedback(href);
        }}
      >
        <p className="dashboard-link-card-title">{title}</p>
        <EmojiIcon className="ios-chevron" symbol="›" size="1.1rem" />
      </Link>

      {overlay}
    </>
  );
}
