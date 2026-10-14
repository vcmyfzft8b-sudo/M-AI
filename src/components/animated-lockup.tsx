"use client";

import Image from "next/image";

import { MemoBuddy } from "@/components/exams/memo-buddy";
import {
  BRAND_LOCKUP_HEIGHT,
  BRAND_LOCKUP_SRC,
  BRAND_LOCKUP_WIDTH,
  SEO_BRAND_NAME,
} from "@/lib/brand";

/**
 * The "Memo AI" lockup with its brain alive: the wordmark is the lockup image itself, cropped to
 * the lettering, and the brain beside it is Memo — the same sticker — breathing, blinking, waving
 * once when the screen opens and hopping when tapped. At rest it is the lockup, pixel for pixel
 * in the places that matter, so nothing about the header's size or alignment changes.
 *
 * Used in the app's own chrome only (the phone home bar and the desktop header). The landing,
 * paywall and onboarding keep the still image.
 */
export function AnimatedLockup({ priority = false }: { priority?: boolean }) {
  return (
    <span className="memo-lockup-animated" role="img" aria-label={SEO_BRAND_NAME}>
      <Image
        src={BRAND_LOCKUP_SRC}
        alt=""
        aria-hidden="true"
        width={BRAND_LOCKUP_WIDTH}
        height={BRAND_LOCKUP_HEIGHT}
        priority={priority}
        className="memo-lockup-wordmark"
      />
      <span className="memo-lockup-brain">
        <MemoBuddy mood="wave" size="100%" />
      </span>
    </span>
  );
}
