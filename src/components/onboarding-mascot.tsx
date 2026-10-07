"use client";

/* The mascot is a small PNG sized by its box (see onboarding-flow.tsx's header). */
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useRef } from "react";
import type { CSSProperties, ReactNode } from "react";
import { getImageProps } from "next/image";

import {
  MASCOT_MOVES,
  blinkFrames,
  burstParticles,
  nextBlinkDelay,
  pickIdleBlink,
  type BlinkKind,
  type MascotMove,
} from "@/lib/onboarding-mascot";

/**
 * Memo as the onboarding draws him: the mascot PNG with eyelids and a lash
 * line laid over his eyes, so he can blink and squeeze them shut when he is
 * pleased. The positions are percentages of the 320x288 artwork.
 */

// The same call as the root layout's preload, so the request is the preloaded one.
const MASCOT = getImageProps({ src: "/memo-mascot.png", alt: "", width: 320, height: 288 }).props;

const LID: CSSProperties = {
  position: "absolute",
  width: "8.8%",
  height: "10.2%",
  borderRadius: "50% 50% 46% 46%",
  background: "linear-gradient(to bottom, #d9939c 0%, #e9aeb5 45%, #eeb9bd 100%)",
  transformOrigin: "50% 0",
  transform: "scaleY(0)",
  pointerEvents: "none",
};

const LASH: CSSProperties = {
  position: "absolute",
  width: "8.8%",
  height: "4.4%",
  boxSizing: "border-box",
  borderRadius: "0 0 50% 50%",
  opacity: 0,
  pointerEvents: "none",
};

export function MascotFigure({ lash = 2, priority = false }: { lash?: 2 | 3; priority?: boolean }) {
  const lashLine = `${lash}px solid #4a1f45`;

  return (
    <>
      <img
        src={MASCOT.src}
        srcSet={MASCOT.srcSet}
        width={MASCOT.width}
        height={MASCOT.height}
        alt=""
        draggable={false}
        fetchPriority={priority ? "high" : undefined}
        decoding={priority ? "sync" : undefined}
        style={{ display: "block", width: "100%", height: "100%", filter: "drop-shadow(0 6px 10px var(--memo-shadow))", userSelect: "none", WebkitUserDrag: "none" } as CSSProperties}
      />
      <span aria-hidden="true" data-memo-lid="1" style={{ ...LID, left: "47.5%", top: "37%" }} />
      <span aria-hidden="true" data-memo-lash="1" style={{ ...LASH, left: "47.5%", top: "41.6%", borderBottom: lashLine }} />
      <span aria-hidden="true" data-memo-lid="1" style={{ ...LID, left: "69.1%", top: "35.6%" }} />
      <span aria-hidden="true" data-memo-lash="1" style={{ ...LASH, left: "69.1%", top: "40.2%", borderBottom: lashLine }} />
    </>
  );
}

const STAR_CLIP = "polygon(50% 0,62% 38%,100% 50%,62% 62%,50% 100%,38% 62%,0 50%,38% 38%)";

/** Three twinkling stars around him, on the screens that celebrate something. */
export function MascotSparkles() {
  const star = (style: CSSProperties): CSSProperties => ({
    position: "absolute",
    aspectRatio: "1",
    zIndex: 4,
    clipPath: STAR_CLIP,
    pointerEvents: "none",
    ...style,
  });

  return (
    <>
      <span aria-hidden="true" style={star({ left: "-2%", top: "6%", width: "13%", background: "#ffcc4d", animation: "memo-twinkle 1.9s ease-in-out infinite" })} />
      <span aria-hidden="true" style={star({ right: "-4%", top: "26%", width: "10%", background: "#4dd6e8", animation: "memo-twinkle 1.9s ease-in-out 0.65s infinite" })} />
      <span aria-hidden="true" style={star({ left: "30%", top: "-10%", width: "8%", background: "#ff6d68", animation: "memo-twinkle 1.9s ease-in-out 1.3s infinite" })} />
    </>
  );
}

/** The disc he stands on. The hero screens draw it a little wider and lower. */
export function MascotPedestal({ hero = false }: { hero?: boolean }) {
  return (
    <div
      aria-hidden="true"
      style={
        hero
          ? { position: "absolute", left: "-2%", right: "-2%", bottom: "-9%", height: "24%", borderRadius: "50%", background: "var(--pedestal)", boxShadow: "0 0.38rem 0 var(--pedestal-lip), 0 1rem 1.6rem var(--pedestal-glow)" }
          : { position: "absolute", left: 0, right: 0, bottom: 0, height: "26%", borderRadius: "50%", background: "var(--pedestal)", boxShadow: "0 0.32rem 0 var(--pedestal-lip), 0 0.8rem 1.2rem var(--pedestal-glow)" }
      }
    >
      <span style={{ position: "absolute", left: "20%", right: "20%", top: "12%", height: "52%", borderRadius: "50%", background: "radial-gradient(closest-side, var(--contact), transparent)" }} />
    </div>
  );
}

/**
 * The thought cloud over his head, with whatever he is turning over in it.
 * `offset` is how far right of his box the cloud's tail starts.
 */
export function MascotThought({ icon, offset, scale = 1 }: { icon: string; offset: string; scale?: number }) {
  const puff: CSSProperties = { position: "absolute", borderRadius: "50%", background: "#ffffff", aspectRatio: "1" };
  const bead: CSSProperties = { position: "absolute", zIndex: 5, borderRadius: "50%", background: "#ffffff", boxShadow: "0 0 0 1px rgba(0,0,0,0.12), 0 2px 3px rgba(0,0,0,0.12)", pointerEvents: "none" };

  return (
    <>
      <span aria-hidden="true" style={{ ...bead, left: `calc(100% + ${offset} - 1.05rem)`, top: "0.55rem", width: "0.32rem", height: "0.38rem", animation: "memo-pop 320ms cubic-bezier(0.22,1,0.36,1) both" }} />
      <span aria-hidden="true" style={{ ...bead, left: `calc(100% + ${offset} - 0.7rem)`, top: "-0.05rem", width: "0.5rem", height: "0.58rem", animation: "memo-pop 320ms cubic-bezier(0.22,1,0.36,1) 110ms both" }} />
      <div aria-hidden="true" style={{ position: "absolute", left: `calc(100% + ${offset} - 1.05rem)`, top: "-2.55rem", width: "3.3rem", height: "2.4rem", zIndex: 5, transform: `scale(${scale})`, transformOrigin: "0% 100%", pointerEvents: "none" }}>
        <div style={{ position: "absolute", inset: 0, transformOrigin: "0% 100%", animation: "memo-cloud-in 520ms cubic-bezier(0.22,1,0.36,1) 220ms both" }}>
          <div style={{ position: "absolute", inset: 0, animation: "memo-float 3.6s ease-in-out infinite" }}>
            <div style={{ position: "absolute", inset: 0, filter: "drop-shadow(0 0 0.6px rgba(0,0,0,0.38)) drop-shadow(0 3px 4px rgba(0,0,0,0.14))" }}>
              <span style={{ position: "absolute", left: "4%", right: "4%", bottom: "4%", height: "48%", borderRadius: "999px", background: "#ffffff" }} />
              <span style={{ ...puff, left: "2%", bottom: "14%", width: "38%" }} />
              <span style={{ ...puff, left: "20%", top: "2%", width: "44%" }} />
              <span style={{ ...puff, left: "48%", top: "12%", width: "38%" }} />
              <span style={{ ...puff, right: "1%", bottom: "14%", width: "30%" }} />
            </div>
            <span data-memo-think="1" style={{ position: "absolute", inset: "12% 0 6% 0", display: "grid", placeItems: "center", fontSize: "1.2rem", lineHeight: 1 }}>{icon}</span>
          </div>
        </div>
      </div>
    </>
  );
}

/**
 * What Memo says. The text types itself out, so the line is drawn twice: the
 * part already "said", and the rest held invisible so the bubble is its final
 * size from the first frame. A screen reader gets the whole line at once.
 */
export function SpeechBubble({
  text,
  typed,
  tail,
  bubbleRef,
  style,
  textStyle,
}: {
  text: string;
  typed: number;
  tail: "left" | "down";
  bubbleRef?: (element: HTMLDivElement | null) => void;
  style?: CSSProperties;
  textStyle?: CSSProperties;
}) {
  const shown = text.slice(0, typed);
  const rest = text.slice(typed);

  return (
    <div
      ref={bubbleRef}
      style={{ position: "relative", boxSizing: "border-box", border: "2px solid var(--chip-ring)", borderRadius: "1.4rem", background: "var(--bubble)", ...style }}
    >
      <span
        aria-hidden="true"
        style={
          tail === "left"
            ? { position: "absolute", left: "-0.64rem", top: "50%", width: "1.1rem", height: "1.1rem", marginTop: "-0.55rem", boxSizing: "border-box", background: "var(--bubble)", borderLeft: "2px solid var(--chip-ring)", borderBottom: "2px solid var(--chip-ring)", borderBottomLeftRadius: "4px", transform: "rotate(45deg)" }
            : { position: "absolute", left: "50%", bottom: "-0.64rem", width: "1.1rem", height: "1.1rem", marginLeft: "-0.55rem", boxSizing: "border-box", background: "var(--bubble)", borderRight: "2px solid var(--chip-ring)", borderBottom: "2px solid var(--chip-ring)", borderBottomRightRadius: "4px", transform: "rotate(45deg)" }
        }
      />
      <h1 style={{ position: "relative", margin: 0, fontWeight: 800, letterSpacing: "-0.01em", color: "var(--text)", ...textStyle }}>
        <span className="sr-only">{text}</span>
        <span aria-hidden="true">{shown}</span>
        <span aria-hidden="true" style={{ opacity: 0 }}>{rest}</span>
      </h1>
    </div>
  );
}

export type MascotActor = "hero" | "rider" | "loader" | "done";

/**
 * Plays Memo's moves on whichever of his four bodies is on screen: the big one
 * on the welcome screen ("hero"), the small one beside the speech bubble
 * ("rider"), and the ones on the loader and the last screen.
 *
 * Everything here is imperative on purpose. A hop is a 620ms Web Animation
 * added on top of the CSS breathing loop; doing it through React state would
 * re-render the whole flow sixty times a second for something no other part of
 * the screen depends on.
 */
export function useMascot({ accent, calm, scope }: { accent: string; calm: boolean; scope: () => HTMLElement | null }) {
  const bodies = useRef<Partial<Record<MascotActor, HTMLElement | null>>>({});
  const bursts = useRef<Partial<Record<MascotActor, HTMLElement | null>>>({});
  const groove = useRef<Animation | null>(null);
  const blinkTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const stopGroove = useCallback(() => {
    const animation = groove.current;
    groove.current = null;

    if (!animation?.effect) {
      return;
    }

    // The sway finishes the beat it is on instead of cutting off.
    const iteration = animation.effect.getComputedTiming().currentIteration ?? 0;

    try {
      animation.effect.updateTiming({ iterations: iteration + 1 });
    } catch {
      animation.cancel();
    }
  }, []);

  const move = useCallback(
    (who: MascotActor, name: MascotMove, iterations = 1) => {
      if (calm) {
        return null;
      }

      const element = bodies.current[who];

      if (!element?.animate) {
        return null;
      }

      const spec = MASCOT_MOVES[name];
      const replace = name === "dropIn";

      if (replace) {
        element.getAnimations().forEach((animation) => animation.cancel());
      }

      const animation = element.animate(spec.frames as Keyframe[], {
        duration: spec.duration,
        easing: "linear",
        iterations,
        composite: replace ? "replace" : "add",
      });

      if (name === "groove") {
        stopGroove();
        groove.current = animation;
      }

      return animation;
    },
    [calm, stopGroove],
  );

  const grooving = useCallback(() => groove.current !== null, []);

  const burst = useCallback(
    (who: MascotActor, kind: "sparkle" | "confetti") => {
      if (calm) {
        return;
      }

      const host = bursts.current[who];

      if (!host) {
        return;
      }

      for (const particle of burstParticles({ kind, small: who === "rider", accent })) {
        const piece = document.createElement("span");
        piece.style.cssText = particle.css;
        host.appendChild(piece);
        const animation = piece.animate(particle.frames, { duration: particle.duration, easing: "linear", fill: "forwards" });
        animation.onfinish = () => piece.remove();
      }
    },
    [accent, calm],
  );

  const blink = useCallback(
    (kind: BlinkKind) => {
      if (calm) {
        return;
      }

      const root = scope();

      if (!root) {
        return;
      }

      const frames = blinkFrames(kind);
      root.querySelectorAll<HTMLElement>("[data-memo-lid]").forEach((lid) => lid.animate(frames.lid as Keyframe[], { duration: frames.duration }));
      root.querySelectorAll<HTMLElement>("[data-memo-lash]").forEach((lash) => lash.animate(frames.lash as Keyframe[], { duration: frames.duration }));
    },
    [calm, scope],
  );

  /* He blinks on his own, at uneven intervals, for as long as he is on screen. */
  useEffect(() => {
    const schedule = () => {
      blinkTimer.current = setTimeout(() => {
        blink(pickIdleBlink(Math.random()));
        schedule();
      }, nextBlinkDelay(Math.random()));
    };

    schedule();

    return () => clearTimeout(blinkTimer.current);
  }, [blink]);

  /*
   * Stable ref callbacks, one per body. A fresh function each render would make
   * React detach and re-attach the ref every time, which is harmless for the
   * map below but would replay a mount animation hung off it.
   */
  const refs = useMemo(() => {
    const body = (who: MascotActor) => (element: HTMLElement | null) => {
      bodies.current[who] = element;
    };
    const host = (who: MascotActor) => (element: HTMLElement | null) => {
      bursts.current[who] = element;
    };

    return {
      rider: body("rider"),
      loader: body("loader"),
      riderBurst: host("rider"),
      loaderBurst: host("loader"),
      heroBurst: host("hero"),
      doneBurst: host("done"),
      setHero: body("hero"),
      setDone: body("done"),
    };
  }, []);

  return { move, burst, blink, stopGroove, grooving, refs };
}

/** A box with Memo's 320:288 proportions, for the figure to fill. */
export function MascotBox({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <div style={{ position: "relative", aspectRatio: "320 / 288", ...style }}>{children}</div>;
}
