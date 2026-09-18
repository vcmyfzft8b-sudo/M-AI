import {
  AGE_OPTIONS,
  AUDIENCE_OPTIONS,
  CLASS_FOCUS_OPTIONS,
  DAILY_GOAL_OPTIONS,
  EDUCATION_OPTIONS,
  ELEMENTARY_SCHOOL_OPTIONS,
  ELEMENTARY_YEAR_OPTIONS,
  FEATURE_OPTIONS,
  HIGH_SCHOOL_OPTIONS,
  HIGH_SCHOOL_YEAR_OPTIONS,
  MOTIVATION_OPTIONS,
  ROLE_OPTIONS,
  SCHOOL_OPTIONS,
  SOURCE_OPTIONS,
  SUBJECT_OPTIONS,
  UNIVERSITY_SCHOOL_OPTIONS,
  UNIVERSITY_YEAR_OPTIONS,
} from "../onboarding-options.ts";
import { en } from "../i18n/messages/en.ts";

/**
 * The onboarding survey as the admin dashboard describes it.
 *
 * The survey runs in five languages and stores a language-neutral value per
 * answer; the dashboard is English only, so every label is read from the
 * English catalogue through the option's `labelKey`. Every stored value the
 * survey can write must resolve to a label — a test holds that line — and
 * any value it cannot (from an older revision of the survey) falls back to
 * the raw value so it is still visible rather than silently dropped.
 *
 * Kept free of server-only imports so the tests can load it directly.
 */

/** English labels keyed by the stored value. */
type Labels = Record<string, string>;

/**
 * Labels for a question with a fixed option list, read from the English
 * catalogue through each option's `labelKey` — the same string the survey
 * shows — so renaming an option in the survey renames it here too. Overrides
 * are for values that need more context on the dashboard than on the step
 * that asked them, such as the year lists three schools share.
 */
function labelsFor(
  options: ReadonlyArray<{ value: string; labelKey: keyof typeof en }>,
  overrides: Labels = {},
): Labels {
  const labels: Labels = {};

  for (const option of options) {
    // The first list to name a value wins, matching the order the survey
    // consults them in.
    labels[option.value] ??= overrides[option.value] ?? en[option.labelKey];
  }

  return labels;
}

const prefixed = (
  options: ReadonlyArray<{ value: string; labelKey: keyof typeof en }>,
  prefix: string,
): Labels =>
  Object.fromEntries(options.map((option) => [option.value, `${prefix}, ${en[option.labelKey]}`]));

const SCHOOL_LEVEL_LABELS = labelsFor(
  [
    ...ELEMENTARY_SCHOOL_OPTIONS,
    ...HIGH_SCHOOL_OPTIONS,
    ...UNIVERSITY_SCHOOL_OPTIONS,
    ...SCHOOL_OPTIONS,
  ],
  // Stored as `high_school` by both the gymnasium step and the generic
  // school step, so the card needs a label that covers both.
  { high_school: "Grammar / secondary school" },
);

const SCHOOL_YEAR_LABELS: Labels = {
  ...prefixed(ELEMENTARY_YEAR_OPTIONS, "Primary"),
  ...prefixed(HIGH_SCHOOL_YEAR_OPTIONS, "Secondary"),
  ...prefixed(UNIVERSITY_YEAR_OPTIONS, "University"),
};

const GRADE_SCALE_LABELS: Labels = {
  "5": "Marked out of 5 (schools)",
  "10": "Marked out of 10 (universities)",
};

export type OnboardingQuestion = {
  key: string;
  title: string;
  /** What the figure means, where the title alone could mislead. */
  hint?: string;
  /** Which part of the page the question belongs to. */
  group: "demographics" | "goals" | "product" | "legacy";
  /**
   * Labels for a fixed option list. A question with labels draws every
   * option, at zero when nobody chose it; one without (the grade buckets) is
   * open-ended and draws only what people entered.
   */
  labels: Labels;
};

/** Whether the question has a fixed option list. */
export function isListed(question: OnboardingQuestion): boolean {
  return Object.keys(question.labels).length > 0;
}

/**
 * Every question the dashboard shows, in the order the survey asks them.
 *
 * Questions with an option list draw every option the survey offers, at zero
 * when nobody chose it, so a step that nobody ever picks is visible as such.
 * The grade buckets are open-ended and only draw what people entered.
 */
export const ONBOARDING_QUESTIONS: OnboardingQuestion[] = [
  {
    key: "role",
    title: "Who is signing up",
    group: "demographics",
    labels: labelsFor(ROLE_OPTIONS),
  },
  {
    key: "school_level",
    title: "Type of school",
    hint: "Asked of pupils and students only.",
    group: "demographics",
    labels: SCHOOL_LEVEL_LABELS,
  },
  {
    key: "school_year",
    title: "School year",
    hint: "The year lists differ by country; primary school runs to year 9 in Slovenia and Bosnia.",
    group: "demographics",
    labels: SCHOOL_YEAR_LABELS,
  },
  {
    key: "subject",
    title: "Field of study",
    hint: "Asked of university students only.",
    group: "demographics",
    labels: labelsFor(SUBJECT_OPTIONS),
  },
  {
    key: "audience",
    title: "Who the account is for",
    group: "demographics",
    labels: labelsFor(AUDIENCE_OPTIONS),
  },
  {
    key: "heard_from",
    title: "Where they heard about Memo AI",
    group: "demographics",
    labels: labelsFor(SOURCE_OPTIONS),
  },
  {
    key: "motivation",
    title: "What they want from Memo AI",
    group: "goals",
    labels: labelsFor(MOTIVATION_OPTIONS),
  },
  {
    key: "class_focus",
    title: "Studying for something specific",
    group: "goals",
    labels: labelsFor(CLASS_FOCUS_OPTIONS),
  },
  {
    key: "daily_goal",
    title: "Daily study goal",
    group: "goals",
    labels: labelsFor(DAILY_GOAL_OPTIONS),
  },
  {
    key: "grade_scale",
    title: "Marking scale",
    group: "goals",
    labels: GRADE_SCALE_LABELS,
  },
  {
    key: "current_grade_5",
    title: "Current average, out of 5",
    hint: "Rounded to the nearest half mark.",
    group: "goals",
    labels: {},
  },
  {
    key: "target_grade_5",
    title: "Target grade, out of 5",
    hint: "Rounded to the nearest half mark.",
    group: "goals",
    labels: {},
  },
  {
    key: "current_grade_10",
    title: "Current average, out of 10",
    hint: "Rounded to the nearest whole mark.",
    group: "goals",
    labels: {},
  },
  {
    key: "target_grade_10",
    title: "Target grade, out of 10",
    hint: "Rounded to the nearest whole mark.",
    group: "goals",
    labels: {},
  },
  {
    key: "feature",
    title: "The feature they came for",
    group: "product",
    labels: labelsFor(FEATURE_OPTIONS),
  },
  {
    key: "age_range",
    title: "Age",
    hint: "From an earlier revision of the survey; the current one has no age step.",
    group: "legacy",
    labels: labelsFor(AGE_OPTIONS),
  },
  {
    key: "education_level",
    title: "Education level",
    hint: "The summary every account carries, derived from the school answer — including accounts from before the survey.",
    group: "legacy",
    labels: labelsFor(EDUCATION_OPTIONS),
  },
];

/**
 * The option lists each labelled question must cover, so the test that keeps
 * the labels complete can find them without knowing the survey's shape.
 */
export const LABELLED_OPTION_LISTS: Record<string, ReadonlyArray<{ value: string }>> = {
  role: ROLE_OPTIONS,
  school_level: [
    ...ELEMENTARY_SCHOOL_OPTIONS,
    ...HIGH_SCHOOL_OPTIONS,
    ...UNIVERSITY_SCHOOL_OPTIONS,
    ...SCHOOL_OPTIONS,
  ],
  school_year: [
    ...ELEMENTARY_YEAR_OPTIONS,
    ...HIGH_SCHOOL_YEAR_OPTIONS,
    ...UNIVERSITY_YEAR_OPTIONS,
  ],
  subject: SUBJECT_OPTIONS,
  audience: AUDIENCE_OPTIONS,
  heard_from: SOURCE_OPTIONS,
  motivation: MOTIVATION_OPTIONS,
  class_focus: CLASS_FOCUS_OPTIONS,
  daily_goal: DAILY_GOAL_OPTIONS,
  feature: FEATURE_OPTIONS,
  age_range: AGE_OPTIONS,
  education_level: EDUCATION_OPTIONS,
};

export type OnboardingAnswer = {
  value: string;
  label: string;
  count: number;
  /** Fraction of everyone who answered this question. */
  share: number;
};

export type OnboardingQuestionBreakdown = OnboardingQuestion & {
  /** How many people answered this question in the window. */
  answered: number;
  answers: OnboardingAnswer[];
};

export type GradeGoal = {
  scale: number;
  respondents: number;
  averageCurrent: number;
  averageTarget: number;
  /** How many set a target above their current average. */
  aimingHigher: number;
};

export type OnboardingBreakdown = {
  /** Accounts that finished onboarding in the window. */
  completed: number;
  /** Of those, how many went through the survey proper. */
  surveyed: number;
  questions: OnboardingQuestionBreakdown[];
  grades: GradeGoal[];
};

export type BreakdownRow = { question: string; answer: string; respondents: number };

function gradeLabel(key: string, value: string): string {
  const scale = key.endsWith("_10") ? 10 : 5;
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return value;
  }

  // "3.5 / 5" and "8 / 10": the half marks only exist on the five-point scale.
  return `${scale === 5 ? number.toFixed(number % 1 === 0 ? 0 : 1) : number.toFixed(0)} / ${scale}`;
}

export function toQuestionBreakdown(
  question: OnboardingQuestion,
  rows: BreakdownRow[],
): OnboardingQuestionBreakdown {
  const counts = new Map<string, number>();

  for (const row of rows) {
    counts.set(row.answer, (counts.get(row.answer) ?? 0) + Number(row.respondents ?? 0));
  }

  // Listed questions draw every option, so an option nobody picks reads as
  // zero rather than vanishing; anything stored that the list does not know
  // is appended under its raw value.
  const listed = isListed(question);
  const values = listed
    ? [
        ...Object.keys(question.labels),
        ...Array.from(counts.keys()).filter((value) => !(value in question.labels)),
      ]
    : Array.from(counts.keys());

  const answered = Array.from(counts.values()).reduce((sum, count) => sum + count, 0);

  const answers = values.map((value) => {
    const count = counts.get(value) ?? 0;

    return {
      value,
      label: listed
        ? (question.labels[value] ?? value)
        : gradeLabel(question.key, value),
      count,
      share: answered > 0 ? count / answered : 0,
    };
  });

  // Grade buckets read best in grade order; everything else by popularity.
  if (listed) {
    answers.sort((a, b) => b.count - a.count);
  } else {
    answers.sort((a, b) => Number(a.value) - Number(b.value));
  }

  return { ...question, answered, answers };
}

