"use client";

import Image from "next/image";
import { useEffect, useState, type CSSProperties } from "react";

import { MemoBuddy, type BuddyIdle } from "@/components/exams/memo-buddy";
import {
  BRAND_LOCKUP_HEIGHT,
  BRAND_LOCKUP_WIDTH,
  BRAND_WORDMARK_SRC,
  SEO_BRAND_NAME,
} from "@/lib/brand";

/*
 * In the header he is livelier than on a lesson screen: a hop or a bounce every few seconds, and
 * blinks about twice as often and a little slower, since at this size a quick blink is easy to miss
 * (the lids are also enlarged for this size in redesign.css).
 */
const LOCKUP_IDLE: BuddyIdle = {
  moves: ["hop", "boing", "hop", "wave"],
  every: [3000, 5500],
  blinkEvery: [1400, 3200],
  blinkPace: 1.5,
};

/* How long a tap's sweep of the shine takes (the `memo-lockup-shine-tap` animation). */
const TAP_SHINE_MS = 1400;

/**
 * The "Memo AI" lockup with its brain alive: the wordmark is the lockup's lettering on its own
 * (`memo-wordmark.png`, the same pixels with the sticker outline closed round the "M"), and the
 * brain beside it is Memo — the same sticker — breathing, blinking, waving once when the screen
 * opens and hopping every few seconds. A tap anywhere on it makes him hop with a sparkle and runs
 * the shine across the letters. At rest it is the lockup, pixel for pixel in the places that
 * matter, so nothing about the header's size or alignment changes.
 *
 * Used wherever the lockup appears: the app's chrome (phone home bar, desktop header), the
 * landing (nav, hero phone, footer), sign-in and other `BrandLogo` places, the paywalls, the
 * onboarding, the error screen and the creator pages. Only the root error boundary
 * (`global-error.tsx`), which must render with nothing else working, keeps the still image.
 */
export function AnimatedLockup({
  priority = false,
  fill = false,
  className,
  style,
}: {
  priority?: boolean;
  /** Fill a box the caller sizes (the lockup's 480:148), as the still image did in it. */
  fill?: boolean;
  /** A caller's own sizing class, for places that sized the still image itself. */
  className?: string;
  style?: CSSProperties;
}) {
  const [taps, setTaps] = useState(0);
  const [shining, setShining] = useState(false);

  useEffect(() => {
    if (!shining) {
      return;
    }

    const timer = setTimeout(() => setShining(false), TAP_SHINE_MS);
    return () => clearTimeout(timer);
  }, [shining, taps]);

  return (
    <span
      className={["memo-lockup-animated", fill ? "fill" : "", shining ? "is-shining" : "", className ?? ""]
        .filter(Boolean)
        .join(" ")}
      style={style}
      role="img"
      aria-label={SEO_BRAND_NAME}
      onClick={() => {
        setTaps((count) => count + 1);
        setShining(true);
      }}
    >
      <Image
        src={BRAND_WORDMARK_SRC}
        alt=""
        aria-hidden="true"
        width={BRAND_LOCKUP_WIDTH}
        height={BRAND_LOCKUP_HEIGHT}
        priority={priority}
        className="memo-lockup-wordmark"
      />
      <span className="memo-lockup-brain">
        <MemoBuddy mood={taps > 0 ? "happy" : "wave"} moodKey={taps} size="100%" idle={LOCKUP_IDLE} />
      </span>
    </span>
  );
}
