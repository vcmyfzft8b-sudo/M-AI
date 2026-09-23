/**
 * The iOS keyboard's own motion, for drawing a frame where the keys *will* be.
 *
 * UIKit moves the keyboard with an additive `CASpringAnimation` (measured on
 * iOS 26: mass 1, stiffness 555.03, damping 47.12, 0.383 s — critically
 * damped). The wrapper hands its parameters over with every sample; the page
 * evaluates it for the moment its own frame will reach the screen, instead of
 * drawing a sample that is already a frame or two old.
 */
export type KeyboardSpring = {
  /** Offset of the keyboard's top from its end position at the start, in points. */
  offset: number;
  omega: number;
  zeta: number;
  /** Seconds. */
  duration: number;
  /** Seconds into the animation when the sample was taken. */
  elapsed: number;
  /** The wrapper's clock (`CACurrentMediaTime`, seconds) when it was sent. */
  sentAt: number;
  /** The inset the animation ends at. */
  target: number;
};

export function isKeyboardSpring(value: unknown): value is KeyboardSpring {
  if (!value || typeof value !== "object") return false;
  const spring = value as Record<string, unknown>;
  return ["offset", "omega", "zeta", "duration", "elapsed", "sentAt", "target"]
    .every((key) => typeof spring[key] === "number" && Number.isFinite(spring[key] as number))
    && (spring.omega as number) > 0 && (spring.duration as number) > 0;
}

/**
 * How much of the starting offset remains after `t` seconds, 1 → 0. The
 * standard damped-oscillator solution with zero initial velocity.
 */
export function springRemaining(spring: Pick<KeyboardSpring, "omega" | "zeta" | "duration">, t: number) {
  if (t <= 0) return 1;
  if (t >= spring.duration) return 0;
  const { omega, zeta } = spring;
  if (Math.abs(zeta - 1) < 1e-3) return (1 + omega * t) * Math.exp(-omega * t);
  if (zeta > 1) {
    const root = omega * Math.sqrt(zeta * zeta - 1);
    const r1 = -zeta * omega + root;
    const r2 = -zeta * omega - root;
    return (r1 * Math.exp(r2 * t) - r2 * Math.exp(r1 * t)) / (r1 - r2);
  }
  const damped = omega * Math.sqrt(1 - zeta * zeta);
  return Math.exp(-zeta * omega * t) * (Math.cos(damped * t) + (zeta * omega / damped) * Math.sin(damped * t));
}

/** The inset the keyboard covers `t` seconds into the animation. */
export function springInset(spring: KeyboardSpring, t: number) {
  // The marker's top sits `offset × remaining` below its end; the inset is
  // measured upward from the bottom, so it moves the other way.
  return Math.max(0, spring.target - spring.offset * springRemaining(spring, t));
}

/**
 * Keeps the two clocks aligned. The smallest `received − sent` seen is the
 * clock difference plus the quickest delivery, which is as close to the true
 * offset as a one-way channel allows.
 */
export function createClockAlignment() {
  let offset = Number.POSITIVE_INFINITY;
  return {
    /** Record one message: `sentAt` in native seconds, `receivedAt` in page milliseconds. */
    observe(sentAt: number, receivedAt: number) {
      offset = Math.min(offset, receivedAt / 1000 - sentAt);
    },
    /** The native time, in seconds, that a page time in milliseconds corresponds to. */
    native(pageMs: number) {
      return Number.isFinite(offset) ? pageMs / 1000 - offset : Number.NaN;
    },
  };
}
