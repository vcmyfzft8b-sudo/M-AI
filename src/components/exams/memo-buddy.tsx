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
/* The coral token is what his own particles wear; this, its first stop, only if the token is missing. */
const ACCENT_FALLBACK = "#ff6d68";

const MOOD_MOVE: Record<BuddyMood, MascotMove | null> = {
  idle: null,
  wave: "wave",
  cheer: "cheer",
  happy: "hop",
  sad: "sad",
  think: "nod",
};

/* The small things he does on his own while nobody is talking to him, so he never looks like a still. */
export type BuddyIdle = {
  moves: readonly MascotMove[];
  every: readonly [number, number];
  /** Between his blinks (ms, at least and at most); the onboarding's 2.4–6.2 s when left out. */
  blinkEvery?: readonly [number, number];
  /** How much longer each blink takes than the onboarding's (1 when left out). */
  blinkPace?: number;
};

const IDLE: BuddyIdle = { moves: ["nod", "wave", "jelly", "boing", "nod", "hop"], every: [4500, 8500] };

/** How wide the onboarding's Memo is: its cloud and beads are drawn, in rem, for him. */
const ONBOARDING_MEMO_REM = 4.6;
/** Where the cloud's first bead meets his head, from his top-right corner, at that size. */
const THOUGHT_ANCHOR_REM = { x: 1.05, y: 0.55 };

/**
 * Places the onboarding's thought cloud on a Memo of any size, as it sits on the onboarding's.
 * The beads have to land on his head wherever his head is, so the point they start from moves
 * with him; the cloud itself grows less than he does (a big Memo with a cloud to scale would be
 * all cloud), which is the onboarding's own choice for its larger loading-screen Memo.
 */
function thoughtLayout(size: string) {
  const rem = size.endsWith("rem") ? Number.parseFloat(size) : 6;
  const reach = rem / ONBOARDING_MEMO_REM;
  const scale = Math.min(1.2, Math.max(0.75, reach));
  const shift = reach - scale;

  return {
    left: `calc(100% - ${(shift * THOUGHT_ANCHOR_REM.x).toFixed(3)}rem)`,
    top: `${(shift * THOUGHT_ANCHOR_REM.y).toFixed(3)}rem`,
    transform: `scale(${scale.toFixed(3)})`,
  } satisfies CSSProperties;
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
  idle = IDLE,
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
  /** His unprompted moves and how often they come (ms between them, at least and at most). */
  idle?: BuddyIdle;
}) {
  const blinkEvery = idle.blinkEvery;
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

  const blinkPace = idle.blinkPace ?? 1;
  const blink = useCallback((kind: Parameters<typeof blinkFrames>[0]) => {
    const root = rootRef.current;

    if (!root || isCalm()) {
      return;
    }

    const frames = blinkFrames(kind);
    const duration = frames.duration * blinkPace;
    root
      .querySelectorAll<HTMLElement>("[data-memo-lid]")
      .forEach((lid) => lid.animate?.(frames.lid as Keyframe[], { duration }));
    root
      .querySelectorAll<HTMLElement>("[data-memo-lash]")
      .forEach((lash) => lash.animate?.(frames.lash as Keyframe[], { duration }));
  }, [blinkPace]);

  const burst = useCallback((kind: "sparkle" | "confetti") => {
    const host = burstRef.current;

    if (!host || isCalm()) {
      return;
    }

    // `--coral` is a gradient, which a particle's `background` takes as it is.
    const accent = getComputedStyle(host).getPropertyValue("--coral").trim() || ACCENT_FALLBACK;

    for (const particle of burstParticles({ kind, small: true, accent })) {
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
      }, blinkEvery ? blinkEvery[0] + Math.random() * (blinkEvery[1] - blinkEvery[0]) : nextBlinkDelay(Math.random()));
    };

    schedule();

    return () => clearTimeout(timer);
  }, [blink, blinkEvery]);

  /* Now and then, unprompted, a little move: a nod, a wave, a wiggle. */
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(() => {
        play(idle.moves[Math.floor(Math.random() * idle.moves.length)]);
        schedule();
      }, idle.every[0] + Math.random() * (idle.every[1] - idle.every[0]));
    };

    schedule();

    return () => clearTimeout(timer);
  }, [idle, play]);

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
      {/* The onboarding's own thought cloud, placed and sized as it is on the onboarding's Memo. */}
      {thought ? (
        <span className="memo-buddy-think" style={thoughtLayout(size)}>
          <MascotThought icon={thought} offset="0.5rem" />
        </span>
      ) : null}
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
