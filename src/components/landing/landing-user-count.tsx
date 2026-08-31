"use client";

import { useEffect, useState } from "react";

import { useTranslations } from "@/components/i18n-provider";
import {
  formatUserCount,
  USER_COUNT_BASE,
  USER_COUNT_PER_MINUTE,
} from "@/lib/social-proof";

/* Carried across in-app navigation so leaving the landing page and coming
   back does not snap the number backwards mid-visit. Session-scoped on
   purpose: this counts up for the visitor watching it, not for everyone. */
const SESSION_KEY = "memo:hero-user-count";

const MEAN_GAP_MS = 60_000 / USER_COUNT_PER_MINUTE;
/* Keeps the random draw from producing a jarring burst or a dead minute. */
const MIN_GAP_MS = 900;
const MAX_GAP_MS = 14_000;

/* Exponential gaps: the average holds at USER_COUNT_PER_MINUTE while no two
   increments land on the same beat, which a fixed interval would. */
function nextGapMs(): number {
  const gap = -Math.log(1 - Math.random()) * MEAN_GAP_MS;
  return Math.min(MAX_GAP_MS, Math.max(MIN_GAP_MS, gap));
}

function readStoredCount(): number | null {
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const stored = Number.parseInt(raw, 10);
    // Never go backwards if the baseline was raised since the tab opened.
    return Number.isFinite(stored) && stored > USER_COUNT_BASE ? stored : null;
  } catch {
    return null;
  }
}

/* The hero's "N registered users" figure. Renders the baseline on the server
   so hydration matches, then ticks upward for as long as the visitor is on the
   page. The noun after the number follows the count, and each language draws
   its plural boundaries differently — see `landing.registeredUsers`. */
export function LandingUserCount() {
  const { locale, t } = useTranslations();
  const [count, setCount] = useState(USER_COUNT_BASE);

  useEffect(() => {
    const stored = readStoredCount();
    let current = stored ?? USER_COUNT_BASE;
    let timer: ReturnType<typeof setTimeout>;

    const tick = () => {
      current += 1;
      setCount(current);
      try {
        window.sessionStorage.setItem(SESSION_KEY, String(current));
      } catch {
        // Private-mode storage failure just costs us the carry-over.
      }
      timer = setTimeout(tick, nextGapMs());
    };

    // A carried-over figure lands on the next frame rather than synchronously,
    // which would cascade a second render straight after hydration.
    timer = setTimeout(tick, stored === null ? nextGapMs() : 0);
    return () => clearTimeout(timer);
  }, []);

  return (
    <span>
      <strong>{formatUserCount(count, locale)}</strong>{" "}
      {t("landing.registeredUsers", { count })}
    </span>
  );
}
