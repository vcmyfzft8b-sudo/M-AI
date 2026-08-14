"use client";

import Link from "next/link";

import { useAppHref } from "@/components/creator-demo/creator-demo-context";
import { EmojiIcon } from "@/components/emoji-icon";
import {
  shouldHandleLinkNavigation,
  useInstantNavigation,
} from "@/components/navigation-loading";

export function SettingsLinkCard({
  href: rawHref,
  icon,
  title,
  detail,
}: {
  href: string;
  icon: string;
  title: string;
  detail?: string;
}) {
  const href = useAppHref(rawHref);
  const { navigateWithFeedback, overlay, isNavigating } = useInstantNavigation();

  return (
    <>
      <Link
        href={href}
        className="dashboard-link-card settings-link-card"
        aria-busy={isNavigating}
        onClick={(event) => {
          if (!shouldHandleLinkNavigation(event)) {
            return;
          }

          event.preventDefault();
          navigateWithFeedback(href);
        }}
      >
        <span className="note-action-card-icon">
          <EmojiIcon symbol={icon} size="1.2rem" />
        </span>
        <span className="note-action-card-copy">
          <span className="note-action-card-label">{title}</span>
          {detail ? <span className="note-action-card-detail">{detail}</span> : null}
        </span>
        <EmojiIcon className="note-action-card-chevron" symbol="›" size="1.1rem" />
      </Link>

      {overlay}
    </>
  );
}
