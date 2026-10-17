"use client";

import { useEffect, useState } from "react";

import { MemoBuddy, type BuddyMood } from "@/components/exams/memo-buddy";

const CALM_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Memo saying something, the way the onboarding has him: the character beside a speech bubble
 * whose line types itself out. The whole line is laid out from the first frame (the untyped rest
 * is held invisible), so the bubble never grows while it types, and a screen reader gets the
 * whole sentence at once. Give it a `key` of the text to replay the typing for a new line.
 */
export function MemoSays({
  text,
  mood = "idle",
  size = "4.6rem",
  hero = false,
  thought,
}: {
  text: string;
  mood?: BuddyMood;
  size?: string;
  /** Big Memo under the bubble, for the screens where he is the whole picture. */
  hero?: boolean;
  thought?: string;
}) {
  const [typed, setTyped] = useState(0);

  useEffect(() => {
    const calm = window.matchMedia?.(CALM_QUERY).matches === true;
    const step = calm ? text.length : 2;
    const timer = window.setInterval(() => {
      setTyped((current) => {
        const next = Math.min(text.length, current + step);

        if (next >= text.length) {
          window.clearInterval(timer);
        }

        return next;
      });
    }, 28);

    return () => window.clearInterval(timer);
  }, [text]);

  return (
    <div className={`memo-exam-says ${hero ? "hero" : ""}`.trim()}>
      <MemoBuddy mood={mood} size={size} thought={thought} />
      <p className="memo-exam-bubble">
        <span className="sr-only">{text}</span>
        <span aria-hidden="true">{text.slice(0, typed)}</span>
        <span aria-hidden="true" className="memo-exam-bubble-rest">
          {text.slice(typed)}
        </span>
      </p>
    </div>
  );
}
