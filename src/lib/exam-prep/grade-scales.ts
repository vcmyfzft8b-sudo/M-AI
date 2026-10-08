/**
 * Grade scales for exam goals.
 *
 * A learner thinks in grades ("I want an 8"), the forecast thinks in percent.
 * These tables are the conventional cut-offs. None of them is a national rule:
 * faculties and teachers set their own, so the plan stores the target as a
 * percentage the learner can correct, and the table only proposes it.
 *
 * - `ten_point` — university 5–10 in Slovenia, Serbia, Bosnia and Herzegovina
 *   and North Macedonia; 6 is the lowest pass. Ljubljana: 6 = 51–60 % … 10 = 91–100 %.
 * - `five_point` — school 1–5. Slovenian schools commonly use 50/63/77/90 %;
 *   Croatian, Bosnian and Serbian ones 50/60/75/90 %.
 * - `letter` — US A–F at 90/80/70/60 %.
 * - `percent` and `pass_fail` need no table.
 */

export type GradeScaleId = "ten_point" | "five_point" | "letter" | "percent" | "pass_fail";

export interface GradeStep {
  label: string;
  /** Lowest percentage that earns this grade. */
  minPercent: number;
  pass: boolean;
}

export const GRADE_SCALE_IDS: GradeScaleId[] = [
  "ten_point",
  "five_point",
  "letter",
  "percent",
  "pass_fail",
];

const TEN_POINT: GradeStep[] = [
  { label: "5", minPercent: 0, pass: false },
  { label: "6", minPercent: 51, pass: true },
  { label: "7", minPercent: 61, pass: true },
  { label: "8", minPercent: 71, pass: true },
  { label: "9", minPercent: 81, pass: true },
  { label: "10", minPercent: 91, pass: true },
];

const FIVE_POINT_SL: GradeStep[] = [
  { label: "1", minPercent: 0, pass: false },
  { label: "2", minPercent: 50, pass: true },
  { label: "3", minPercent: 63, pass: true },
  { label: "4", minPercent: 77, pass: true },
  { label: "5", minPercent: 90, pass: true },
];

const FIVE_POINT_REGION: GradeStep[] = [
  { label: "1", minPercent: 0, pass: false },
  { label: "2", minPercent: 50, pass: true },
  { label: "3", minPercent: 60, pass: true },
  { label: "4", minPercent: 75, pass: true },
  { label: "5", minPercent: 90, pass: true },
];

const LETTER: GradeStep[] = [
  { label: "F", minPercent: 0, pass: false },
  { label: "D", minPercent: 60, pass: true },
  { label: "C", minPercent: 70, pass: true },
  { label: "B", minPercent: 80, pass: true },
  { label: "A", minPercent: 90, pass: true },
];

const PASS_FAIL: GradeStep[] = [
  { label: "fail", minPercent: 0, pass: false },
  { label: "pass", minPercent: 50, pass: true },
];

const PERCENT_TARGETS = [50, 60, 70, 80, 90, 100];

export function isGradeScaleId(value: unknown): value is GradeScaleId {
  return typeof value === "string" && (GRADE_SCALE_IDS as string[]).includes(value);
}

/** The scale's steps, lowest first. `percent` returns round targets. */
export function gradeSteps(scale: GradeScaleId, locale: string = "sl"): GradeStep[] {
  switch (scale) {
    case "ten_point":
      return TEN_POINT;
    case "five_point":
      return locale === "sl" ? FIVE_POINT_SL : FIVE_POINT_REGION;
    case "letter":
      return LETTER;
    case "pass_fail":
      return PASS_FAIL;
    case "percent":
      return PERCENT_TARGETS.map((value, index) => ({
        label: `${value}`,
        minPercent: index === 0 ? 0 : value,
        pass: value >= 50,
      }));
  }
}

/** The grades worth aiming for: every passing step. */
export function targetGradeOptions(scale: GradeScaleId, locale?: string) {
  return gradeSteps(scale, locale).filter((step) => step.pass);
}

/** The default percentage for a target grade, or null if the label is not on the scale. */
export function defaultTargetPercent(scale: GradeScaleId, label: string, locale?: string) {
  if (scale === "percent") {
    const value = Number(label);
    return Number.isFinite(value) && value > 0 && value <= 100 ? value : null;
  }

  return gradeSteps(scale, locale).find((step) => step.label === label)?.minPercent ?? null;
}

/**
 * The scale with the learner's own cut-off for their target grade written in,
 * so a forecast that clears their 85% for a 9 is not called an 8 by our table.
 */
function stepsWithTarget(
  scale: GradeScaleId,
  locale: string | undefined,
  target: { label: string; percent: number } | null,
) {
  const steps = gradeSteps(scale, locale).map((step) => ({ ...step }));

  if (!target) {
    return steps;
  }

  const index = steps.findIndex((step) => step.label === target.label);

  if (index > 0) {
    steps[index].minPercent = target.percent;

    // Keep the table monotonic around the corrected step.
    for (let i = index - 1; i > 0; i -= 1) {
      steps[i].minPercent = Math.min(steps[i].minPercent, steps[i + 1].minPercent - 1);
    }

    for (let i = index + 1; i < steps.length; i += 1) {
      steps[i].minPercent = Math.max(steps[i].minPercent, steps[i - 1].minPercent + 1);
    }
  }

  return steps;
}

/** The grade a percentage earns, as a step label. */
export function gradeForPercent(
  scale: GradeScaleId,
  percent: number,
  options: { locale?: string; target?: { label: string; percent: number } | null } = {},
) {
  if (scale === "percent") {
    return `${Math.round(clampPercent(percent))}`;
  }

  const steps = stepsWithTarget(scale, options.locale, options.target ?? null);
  let match = steps[0];

  for (const step of steps) {
    if (percent >= step.minPercent) {
      match = step;
    }
  }

  return match.label;
}

export function clampPercent(value: number) {
  return Math.min(100, Math.max(0, value));
}
