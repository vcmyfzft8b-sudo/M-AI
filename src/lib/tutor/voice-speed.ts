/**
 * How fast the tutor talks.
 *
 * Soniox's tts-rt-v2 takes a `speed` between 0.7 and 1.3, and pushing past either end is
 * refused rather than clamped. The steps stop at 1.15 rather than going to the ceiling: at
 * 1.3 the voice stops sounding like somebody explaining something and starts sounding like a
 * disclaimer, which is the opposite of what this feature is. Four options also fit one row.
 *
 * Faster is not free. The allowance is spent in proportion to the speed — a minute at 1.15x
 * costs sixty-nine seconds — because a faster voice gets through proportionally more
 * material and proportionally more synthesis, which is what is actually being paid for.
 *
 * Kept out of `note-tts-settings.ts` because read-aloud's rates are playback rates applied to
 * a finished file (0.5 to 2), which is a different mechanism with a different range. These
 * change how the voice is generated.
 */
export const TUTOR_SPEEDS = [0.7, 0.85, 1, 1.15] as const;

export type TutorSpeed = (typeof TUTOR_SPEEDS)[number];

export const DEFAULT_TUTOR_SPEED: TutorSpeed = 1;

export const TUTOR_SPEED_STORAGE_KEY = "memo-tutor-speed";

export function normalizeTutorSpeed(value: unknown): TutorSpeed {
  const parsed = typeof value === "string" ? Number(value) : value;

  return TUTOR_SPEEDS.find((speed) => speed === parsed) ?? DEFAULT_TUTOR_SPEED;
}
