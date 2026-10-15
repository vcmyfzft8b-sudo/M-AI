"use client";

import { useCallback, useEffect, useRef, type CSSProperties } from "react";

import { MascotFigure, MascotSparkles, MascotThought } from "@/components/onboarding-mascot";
import {
  MASCOT_MOVES,
  blinkFrames,
  burstParticles,
  nextBlinkDelay,
  pickIdleBlink,
  type MascotMove,
} from "@/lib/onboarding-mascot";

/**
 * Memo, the brain, alive inside the app: the onboarding's character with his breathing loop,
 * idle blinks and the hop he answers a tap with. Screens set his `mood` and he reacts once each
 * time it changes (a cheer and a burst of stars for a right answer, a droop for a wrong one, a
 * wave hello), so a screen never has to drive the animation itself.
 *
 * Everything moves through the Web Animations API on top of the CSS breathing, the same way the
 * onboarding does it. Reduced motion is honoured for those: the global rule in globals.css stops
 * CSS animations, and this component skips the scripted ones.
 */

export type BuddyMood = "idle" | "wave" | "cheer" | "happy" | "sad" | "think";

const CALM_QUERY = "(prefers-reduced-motion: reduce)";
const ACCENT = "#ff6d68";

const MOOD_MOVE: Record<BuddyMood, MascotMove | null> = {
  idle: null,
  wave: "wave",
  cheer: "cheer",
  happy: "hop",
  sad: "sad",
  think: "nod",
};

/* The small things he does on his own while nobody is talking to him, so he never looks like a still. */
const IDLE_MOVES: MascotMove[] = ["nod", "wave", "jelly", "boing", "nod", "hop"];

/** The onboarding's cloud fits a Memo about 6rem wide; a smaller or larger Memo gets it scaled to match. */
function thoughtScale(size: string) {
  const rem = size.endsWith("rem") ? Number.parseFloat(size) : 6;
  return Math.min(1.3, Math.max(0.6, rem / 6));
}

function isCalm() {
  return typeof window !== "undefined" && window.matchMedia?.(CALM_QUERY).matches === true;
}

export function MemoBuddy({
  mood = "idle",
  moodKey,
  size = "6rem",
  thought,
  sparkles = false,
  className,
  label,
}: {
  mood?: BuddyMood;
  /** Changes to replay the mood's move even when the mood itself is unchanged (two right answers). */
  moodKey?: string | number;
  size?: string;
  /** An emoji in a thought cloud over his head. */
  thought?: string;
  sparkles?: boolean;
  className?: string;
  /** Accessible name; omitted when he is decoration next to text that says the same. */
  label?: string;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const burstRef = useRef<HTMLDivElement | null>(null);

  const play = useCallback((move: MascotMove) => {
    const body = bodyRef.current;

    if (!body?.animate || isCalm()) {
      return;
    }

    const spec = MASCOT_MOVES[move];
    body.animate(spec.frames as Keyframe[], {
      duration: spec.duration,
      easing: "linear",
      composite: "add",
    });
  }, []);

  const blink = useCallback((kind: Parameters<typeof blinkFrames>[0]) => {
    const root = rootRef.current;

    if (!root || isCalm()) {
      return;
    }

    const frames = blinkFrames(kind);
    root
      .querySelectorAll<HTMLElement>("[data-memo-lid]")
      .forEach((lid) => lid.animate?.(frames.lid as Keyframe[], { duration: frames.duration }));
    root
      .querySelectorAll<HTMLElement>("[data-memo-lash]")
      .forEach((lash) => lash.animate?.(frames.lash as Keyframe[], { duration: frames.duration }));
  }, []);

  const burst = useCallback((kind: "sparkle" | "confetti") => {
    const host = burstRef.current;

    if (!host || isCalm()) {
      return;
    }

    for (const particle of burstParticles({ kind, small: true, accent: ACCENT })) {
      const piece = document.createElement("span");
      piece.style.cssText = particle.css;
      host.appendChild(piece);
      const animation = piece.animate?.(particle.frames, {
        duration: particle.duration,
        easing: "linear",
        fill: "forwards",
      });

      if (animation) {
        animation.onfinish = () => piece.remove();
      } else {
        piece.remove();
      }
    }
  }, []);

  /* He blinks on his own, at uneven intervals, for as long as he is on screen. */
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(() => {
        blink(pickIdleBlink(Math.random()));
        schedule();
      }, nextBlinkDelay(Math.random()));
    };

    schedule();

    return () => clearTimeout(timer);
  }, [blink]);

  /* Now and then, unprompted, a little move: a nod, a wave, a wiggle. */
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(() => {
        play(IDLE_MOVES[Math.floor(Math.random() * IDLE_MOVES.length)]);
        schedule();
      }, 4500 + Math.random() * 4000);
    };

    schedule();

    return () => clearTimeout(timer);
  }, [play]);

  /* A mood is played once when it arrives. */
  useEffect(() => {
    const move = MOOD_MOVE[mood];

    if (move) {
      play(move);
    }

    if (mood === "cheer") {
      burst("confetti");
      blink("happy");
    } else if (mood === "happy") {
      burst("sparkle");
      blink("happy");
    }
  }, [blink, burst, mood, moodKey, play]);

  return (
    <div
      ref={rootRef}
      className={["memo-buddy", className ?? ""].filter(Boolean).join(" ")}
      style={{ "--memo-buddy-size": size } as CSSProperties}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      onClick={() => {
        play("hop");
        blink("happy");
        burst("sparkle");
      }}
    >
      {sparkles ? <MascotSparkles /> : null}
      {/* The onboarding's own thought cloud, sized to him (it is drawn for a Memo about 6rem wide). */}
      {thought ? <MascotThought icon={thought} offset="0.5rem" scale={thoughtScale(size)} /> : null}
      <div className="memo-buddy-bob">
        <div ref={bodyRef} className="memo-buddy-body">
          <div className="memo-buddy-breathe">
            <MascotFigure lash={2} />
          </div>
        </div>
      </div>
      <div ref={burstRef} className="memo-buddy-burst" aria-hidden="true" />
    </div>
  );
}
