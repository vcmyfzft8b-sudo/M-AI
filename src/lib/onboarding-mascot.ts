/**
 * Memo, the onboarding's companion: everything about how he moves that is not
 * the DOM.
 *
 * The numbers are the design canvas's ("Onboarding Redesign v2"), kept here so
 * the component only has to decide *when* he hops, blinks or throws confetti,
 * and so a test can read them without a browser. Every animation is played
 * through the Web Animations API with `composite: "add"`, which is what lets a
 * hop stack on top of the CSS breathing loop instead of replacing it.
 */

export type MascotMove =
  | "step"
  | "hop"
  | "cheer"
  | "shake"
  | "sad"
  | "jelly"
  | "nod"
  | "boing"
  | "munch"
  | "wave"
  | "groove"
  | "dropIn";

type Frame = { offset: number; transform: string; easing?: string; opacity?: number };

const OUT = "cubic-bezier(0.22,1,0.36,1)";
const IO = "cubic-bezier(0.45,0,0.55,1)";
const UP = "cubic-bezier(0.33,0.9,0.6,1)";
const DOWN = "cubic-bezier(0.4,0,0.67,0.1)";

function k(offset: number, transform: string, easing?: string): Frame {
  return easing ? { offset, transform, easing } : { offset, transform };
}

/** Translate is a percentage of his own height, so a hop is the same at every size. */
function pose(y: number, rotate: number, sx: number, sy: number) {
  return `translateY(${y}%) rotate(${rotate}deg) scale(${sx}, ${sy})`;
}

export const MASCOT_MOVES: Record<MascotMove, { duration: number; frames: Frame[] }> = {
  step: { duration: 620, frames: [k(0, pose(0, 0, 1, 1), IO), k(0.12, pose(2, 0, 1.1, 0.9), UP), k(0.42, pose(-16, 0, 0.96, 1.05), DOWN), k(0.7, pose(0, 0, 1.1, 0.9), OUT), k(0.85, pose(-2, 0, 0.98, 1.02), IO), k(1, pose(0, 0, 1, 1))] },
  hop: { duration: 620, frames: [k(0, pose(0, 0, 1, 1), IO), k(0.14, pose(3, 0, 1.12, 0.87), UP), k(0.45, pose(-26, 0, 0.95, 1.07), DOWN), k(0.72, pose(0, 0, 1.12, 0.88), OUT), k(0.86, pose(-3, 0, 0.98, 1.02), IO), k(1, pose(0, 0, 1, 1))] },
  cheer: { duration: 980, frames: [k(0, pose(0, 0, 1, 1), IO), k(0.12, pose(3, 0, 1.14, 0.85), UP), k(0.34, pose(-30, -9, 0.95, 1.07), IO), k(0.5, pose(-34, 9, 0.97, 1.04), DOWN), k(0.72, pose(0, 0, 1.13, 0.87), OUT), k(0.86, pose(-4, 0, 0.98, 1.02), IO), k(1, pose(0, 0, 1, 1))] },
  shake: { duration: 640, frames: [k(0, pose(0, 0, 1, 1), IO), k(0.14, pose(0, -11, 1, 1), IO), k(0.32, pose(0, 9, 1, 1), IO), k(0.5, pose(0, -6, 1, 1), IO), k(0.68, pose(0, 3.5, 1, 1), IO), k(0.84, pose(0, -1.5, 1, 1), IO), k(1, pose(0, 0, 1, 1))] },
  sad: { duration: 1500, frames: [k(0, pose(0, 0, 1, 1), IO), k(0.22, pose(6, -8, 1.04, 0.92), IO), k(0.7, pose(6, -6, 1.04, 0.92), OUT), k(1, pose(0, 0, 1, 1))] },
  jelly: { duration: 800, frames: [k(0, pose(0, 0, 1, 1), OUT), k(0.18, pose(0, 0, 1.16, 0.85), IO), k(0.38, pose(0, 0, 0.9, 1.12), IO), k(0.56, pose(0, 0, 1.06, 0.95), IO), k(0.74, pose(0, 0, 0.98, 1.02), IO), k(1, pose(0, 0, 1, 1))] },
  nod: { duration: 560, frames: [k(0, pose(0, 0, 1, 1), IO), k(0.3, pose(4, 7, 1, 1), IO), k(0.6, pose(0, -2, 1, 1), IO), k(1, pose(0, 0, 1, 1))] },
  boing: { duration: 380, frames: [k(0, pose(0, 0, 1, 1), IO), k(0.3, pose(0, 0, 1.1, 0.9), IO), k(0.65, pose(0, 0, 0.97, 1.03), IO), k(1, pose(0, 0, 1, 1))] },
  munch: { duration: 280, frames: [k(0, pose(0, 0, 1, 1), IO), k(0.5, pose(0, -3, 1.07, 0.93), IO), k(1, pose(0, 0, 1, 1))] },
  wave: { duration: 1100, frames: [k(0, pose(0, 0, 1, 1), IO), k(0.18, pose(0, -8, 1, 1), IO), k(0.38, pose(0, 7, 1, 1), IO), k(0.58, pose(0, -5, 1, 1), IO), k(0.78, pose(0, 3, 1, 1), IO), k(1, pose(0, 0, 1, 1))] },
  groove: { duration: 900, frames: [k(0, pose(0, 0, 1, 1), IO), k(0.25, pose(-5, -4, 1, 1), IO), k(0.5, pose(0, 0, 1, 1), IO), k(0.75, pose(-5, 4, 1, 1), IO), k(1, pose(0, 0, 1, 1))] },
  dropIn: {
    duration: 1050,
    frames: [
      { offset: 0, transform: pose(-110, 0, 0.9, 1.1), opacity: 0, easing: DOWN },
      { offset: 0.42, transform: pose(0, 0, 1.18, 0.82), opacity: 1, easing: UP },
      { offset: 0.62, transform: pose(-9, 0, 0.96, 1.05), opacity: 1, easing: DOWN },
      { offset: 0.8, transform: pose(0, 0, 1.05, 0.95), opacity: 1, easing: IO },
      { offset: 1, transform: pose(0, 0, 1, 1), opacity: 1 },
    ],
  },
};

export type BlinkKind = "single" | "double" | "half" | "happy";

/**
 * The eyelids and the closed-eye lash line, as two keyframe lists played
 * together. "happy" is the long squeeze he answers a tap with; the other three
 * are the idle blinks, picked at random.
 */
export function blinkFrames(kind: BlinkKind) {
  const shut = "cubic-bezier(0.55,0,0.9,0.4)";
  const open = "cubic-bezier(0.1,0.6,0.3,1)";
  const one = (o: number, dur: number) => [
    { offset: o, transform: "scaleY(0)", easing: shut },
    { offset: o + 0.3 * dur, transform: "scaleY(1)", easing: "linear" },
    { offset: o + 0.42 * dur, transform: "scaleY(1)", easing: open },
  ];
  const lash = (o: number, dur: number) => [
    { offset: o, opacity: 0 },
    { offset: o + 0.26 * dur, opacity: 0 },
    { offset: o + 0.3 * dur, opacity: 1 },
    { offset: o + 0.42 * dur, opacity: 1 },
    { offset: o + 0.5 * dur, opacity: 0 },
  ];

  if (kind === "happy") {
    return {
      duration: 1150,
      lid: [
        { offset: 0, transform: "scaleY(0)", easing: shut },
        { offset: 0.1, transform: "scaleY(1)", easing: "linear" },
        { offset: 0.82, transform: "scaleY(1)", easing: open },
        { offset: 1, transform: "scaleY(0)" },
      ],
      lash: [
        { offset: 0, opacity: 0 },
        { offset: 0.09, opacity: 1 },
        { offset: 0.84, opacity: 1 },
        { offset: 0.94, opacity: 0 },
        { offset: 1, opacity: 0 },
      ],
    };
  }

  if (kind === "half") {
    return {
      duration: 260,
      lid: [
        { offset: 0, transform: "scaleY(0)", easing: shut },
        { offset: 0.4, transform: "scaleY(0.55)", easing: open },
        { offset: 1, transform: "scaleY(0)" },
      ],
      lash: [{ opacity: 0 }, { opacity: 0 }],
    };
  }

  if (kind === "double") {
    return {
      duration: 560,
      lid: [...one(0, 0.5), { offset: 0.5, transform: "scaleY(0)" }, ...one(0.5, 0.5), { offset: 1, transform: "scaleY(0)" }],
      lash: [...lash(0, 0.5), ...lash(0.5, 0.5), { offset: 1, opacity: 0 }],
    };
  }

  return {
    duration: 270,
    lid: [...one(0, 1), { offset: 1, transform: "scaleY(0)" }],
    lash: [...lash(0, 1), { offset: 1, opacity: 0 }],
  };
}

/** The next idle blink: mostly single, sometimes a double, now and then half-lidded. */
export function pickIdleBlink(roll: number): BlinkKind {
  return roll < 0.18 ? "double" : roll < 0.28 ? "half" : "single";
}

/** Between 2.4 and 6.2 seconds, so the blinks never fall into a rhythm. */
export function nextBlinkDelay(roll: number) {
  return 2400 + roll * 3800;
}

const STAR = "polygon(50% 0,62% 38%,100% 50%,62% 62%,50% 100%,38% 62%,0 50%,38% 38%)";

export type Particle = {
  css: string;
  frames: Keyframe[];
  duration: number;
};

/**
 * A spray of stars (a tap, a right answer) or confetti (a clean deck, a full
 * mark, the last screen). The small Memo beside the bubble throws them at 65%
 * scale and his confetti falls rather than rising, so it stays inside the step.
 */
export function burstParticles({
  kind,
  small,
  accent,
  random = Math.random,
}: {
  kind: "sparkle" | "confetti";
  small: boolean;
  accent: string;
  random?: () => number;
}): Particle[] {
  const colors = [accent, "#62d676", "#ffcc4d", "#ff6d68", "#7cc4ff", "#ffffff"];
  const confetti = kind === "confetti";
  const count = confetti ? 28 : 10;
  const scale = small ? 0.65 : 1;
  const out: Particle[] = [];

  for (let index = 0; index < count; index += 1) {
    const size = (confetti ? 6 + random() * 5 : 7 + random() * 6) * scale;
    const css =
      `position:absolute;left:0;top:0;pointer-events:none;will-change:transform,opacity;width:${size}px;` +
      `height:${confetti ? size * 0.5 : size}px;margin:${-size / 2}px 0 0 ${-size / 2}px;` +
      `background:${colors[index % colors.length]};border-radius:1px;` +
      (confetti ? "" : `clip-path:${STAR};`);
    const angle = confetti
      ? Math.PI / 2 + (random() - 0.5) * Math.PI * 1.1
      : (index / count) * Math.PI * 2 + random() * 0.4;
    const distance = (confetti ? 70 + random() * 90 : 44 + random() * 30) * scale;
    const dx = Math.cos(angle) * distance;
    const dy =
      Math.sin(angle) * distance * (confetti && small ? 0.6 : 1) * (confetti && !small ? -1 : 1);
    const spin = (random() - 0.5) * 900;
    const at = (x: number, y: number, r: number, z: number) =>
      `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) rotate(${r.toFixed(0)}deg) scale(${z})`;
    const frames: Keyframe[] = confetti
      ? [
          { offset: 0, transform: at(0, 0, 0, 0.3), opacity: 1, easing: "cubic-bezier(0.2,0.8,0.4,1)" },
          { offset: 0.3, transform: at(dx, dy, spin * 0.3, 1), opacity: 1, easing: "cubic-bezier(0.45,0,0.8,0.6)" },
          { offset: 1, transform: at(dx * 1.3 + (random() - 0.5) * 40, dy + 150 * scale, spin, 0.85), opacity: 0 },
        ]
      : [
          { offset: 0, transform: at(0, 0, 0, 0), opacity: 1, easing: "cubic-bezier(0.22,1,0.36,1)" },
          { offset: 0.45, transform: at(dx * 0.85, dy * 0.85, spin * 0.5, 1), opacity: 1, easing: "cubic-bezier(0.55,0,0.85,0.35)" },
          { offset: 1, transform: at(dx, dy, spin, 0), opacity: 0.2 },
        ];

    out.push({
      css,
      frames,
      duration: confetti ? 1600 + random() * 500 : 700 + random() * 200,
    });
  }

  return out;
}

/** What Memo turns over in his thought cloud on the steps that make him think. */
const THINK_SETS: Record<string, readonly string[]> = {
  motivation: ["💯", "🚀", "💡"],
  schoolYear: ["📅", "🎒", "💡"],
  subject: ["🌍", "🔬", "💡"],
  currentAverageGrade: ["📈", "🤔", "💡"],
  targetGrade: ["🎯", "📈", "💡"],
  feature: ["💡", "🧠", "✨"],
  classFocus: ["🎯", "📚", "💡"],
  dailyGoal: ["➕", "➖", "✖️", "🟰"],
  personalizing: ["🧠", "📚", "💡", "🌍"],
};

export function thinkIcons(stepId: string, studyHour: number): readonly string[] {
  if (stepId === "studyTime") {
    return [studyHour < 9 ? "🌅" : studyHour < 17 ? "☀️" : studyHour < 20 ? "🌇" : "🌙"];
  }

  return THINK_SETS[stepId] ?? [];
}

/** The slider's range: six in the morning to eleven at night. */
export const STUDY_HOUR_MIN = 6;
export const STUDY_HOUR_MAX = 23;
export const STUDY_HOUR_DEFAULT = 17;

/**
 * The sky over the study-time slider: dawn, day, dusk and night, the sun on its
 * arc and the moon once it is dark.
 */
export function studySky(hour: number) {
  const night = hour >= 20;
  const phase = hour <= 8 ? "dawn" : hour <= 16 ? "day" : hour <= 19 ? "dusk" : "night";
  const sunT = Math.min(1, Math.max(0, (hour - 6) / 13));

  return {
    skyBg: {
      dawn: "linear-gradient(180deg, #f6a77f 0%, #fbcf9f 50%, #f6a77f 100%)",
      day: "linear-gradient(180deg, #6fb6e8 0%, #8cc8ef 50%, #6fb6e8 100%)",
      dusk: "linear-gradient(180deg, #5a4a96 0%, #d97a8c 50%, #5a4a96 100%)",
      night: "linear-gradient(180deg, #141b40 0%, #222c63 50%, #141b40 100%)",
    }[phase],
    starOpacity: night ? 1 : hour >= 18 ? 0.35 : 0,
    cloudFill: night ? "#5a628f" : phase === "dusk" ? "#efd2dc" : "#f2f5f9",
    cloudShade: night ? "#4b5380" : phase === "dusk" ? "#dcbccb" : "#dde4ec",
    rayOpacity: night ? 0 : 1,
    orbX: night ? 30 + ((hour - 20) / 3) * 40 : 16 + sunT * 68,
    orbY: night ? 40 : 70 - Math.sin(Math.PI * sunT) * 34,
    orbFill: night
      ? "radial-gradient(circle at 36% 34%, #ffffff, #e9edff 58%, #c3caf3)"
      : "radial-gradient(circle at 40% 38%, #fff6c2, #ffd23f 55%, #ffad1f)",
    orbGlow: night
      ? "0 0 26px rgba(200,210,255,0.55)"
      : "0 0 0 10px rgba(255,210,63,0.2), 0 0 42px rgba(255,186,40,0.65)",
    hourPct: Math.round(((hour - STUDY_HOUR_MIN) / (STUDY_HOUR_MAX - STUDY_HOUR_MIN)) * 1000) / 10,
  };
}

/** "5 PM" in English, "17:00" in the four languages that read a 24-hour clock. */
export function studyHourLabel(hour: number, locale: string) {
  return locale === "en" ? `${hour % 12 || 12} ${hour < 12 ? "AM" : "PM"}` : `${hour}:00`;
}
