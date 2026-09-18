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

/**
 * The onboarding survey as the admin dashboard describes it.
 *
 * The survey runs in five languages and stores a language-neutral value per
 * answer; the dashboard is English only, so the labels live here rather than
 * going through the app's translations. Every stored value the survey can
 * write must have a label below — a test holds that line — and any value it
 * cannot (from an older revision of the survey) falls back to the raw value
 * so it is still visible rather than silently dropped.
 *
 * Kept free of server-only imports so the tests can load it directly.
 */

/** English labels keyed by the stored value, for questions with a fixed option list. */
type Labels = Record<string, string>;

const SOURCE_LABELS: Labels = {
  instagram_reels: "Instagram Reels",
  tiktok: "TikTok",
  chatgpt: "ChatGPT",
  friend: "A friend",
  other: "Other",
};

const AUDIENCE_LABELS: Labels = {
  me: "For me",
  me_family: "For me and my family",
  someone_else: "For someone else",
};

const ROLE_LABELS: Labels = {
  working_professional: "Working professional",
  elementary_student: "Primary school pupil",
  high_school_student: "Secondary school student",
  university_student: "University student",
  parent: "Parent",
  teacher: "Teacher / lecturer",
};

const SCHOOL_LEVEL_LABELS: Labels = {
  elementary_school: "Primary school",
  high_school: "Grammar / secondary school",
  technical_school: "Technical secondary school",
  vocational_school: "Vocational school",
  university: "University",
  college: "College",
  other: "Something else",
};

const SCHOOL_YEAR_LABELS: Labels = {
  grade_1: "Primary, year 1",
  grade_2: "Primary, year 2",
  grade_3: "Primary, year 3",
  grade_4: "Primary, year 4",
  grade_5: "Primary, year 5",
  grade_6: "Primary, year 6",
  grade_7: "Primary, year 7",
  grade_8: "Primary, year 8",
  grade_9: "Primary, year 9",
  year_1: "Secondary, 1st year",
  year_2: "Secondary, 2nd year",
  year_3: "Secondary, 3rd year",
  year_4: "Secondary, 4th year",
  year_5: "Secondary, 5th year",
  freshman: "University, 1st year",
  sophomore: "University, 2nd year",
  junior: "University, 3rd year",
  senior: "University, 4th year or above",
  graduate: "Postgraduate",
};

const SUBJECT_LABELS: Labels = {
  arts_humanities: "Arts and humanities",
  business_economics: "Business and economics",
  computer_science: "Computer science",
  maths: "Maths",
  education: "Education",
  engineering_technology: "Engineering and technology",
  health_medicine: "Health and medicine",
  law_criminal_justice: "Law",
  life_physical_sciences: "Natural sciences",
  social_sciences: "Social sciences",
};

const MOTIVATION_LABELS: Labels = {
  improve_marks: "Improve my grades",
  learn_faster: "Learn faster",
  focus_better: "Follow lectures better",
  never_miss_detail: "Not miss details in a lecture",
  something_else: "Something else",
};

const FEATURE_LABELS: Labels = {
  quizzes: "Quizzes",
  flashcards: "Flashcards",
  tests: "Tests",
  voice_tutor: "Voice tutor",
  podcast: "Podcast",
  memory_palace: "Memory palace",
  record_lectures: "Personalised notes",
  speed_read: "Speed read",
  mindmap: "Mindmap",
  audio_notes: "Audio notes",
  library_chat: "Chat with your notes",
  ai_chat_notes: "Notes read aloud",
};

const CLASS_FOCUS_LABELS: Labels = {
  specific_class: "A particular subject",
  upcoming_exam: "An upcoming exam or test",
  something_else: "Something else",
  general_help: "General help",
};

const DAILY_GOAL_LABELS: Labels = {
  casual: "Casual — 10 min / day",
  regular: "Regular — 20 min / day",
  serious: "Serious — 60 min / day",
  intensive: "Intensive — 90+ min / day",
};

const GRADE_SCALE_LABELS: Labels = {
  "5": "Marked out of 5 (schools)",
  "10": "Marked out of 10 (universities)",
};

const AGE_LABELS: Labels = {
  under_16: "Under 16",
  "16_18": "16 to 18",
  "19_22": "19 to 22",
  "23_29": "23 to 29",
  "30_plus": "30 and over",
};

const EDUCATION_LABELS: Labels = {
  high_school: "Secondary school",
  university: "University",
  masters: "Master's",
  self_study: "Self-study",
  other: "Other",
};

export const SURVEY_LABELS: Labels = {
  answered: "Answered the survey",
  none: "Finished before the survey existed",
};

export type OnboardingQuestion = {
  key: string;
  title: string;
  /** What the figure means, where the title alone could mislead. */
  hint?: string;
  /** Which part of the page the question belongs to. */
  group: "demographics" | "goals" | "product" | "legacy";
  labels: Labels;
  /** Whether the option list is fixed, so unanswered options still show at zero. */
  listed: boolean;
};

/**
 * Every question the dashboard shows, in the order the survey asks them.
 *
 * The `listed` questions draw every option the survey offers, at zero when
 * nobody chose it, so a step that nobody ever picks is visible as such. The
 * grade buckets are open-ended and only draw what people entered.
 */
export const ONBOARDING_QUESTIONS: OnboardingQuestion[] = [
  {
    key: "role",
    title: "Who is signing up",
    group: "demographics",
    labels: ROLE_LABELS,
    listed: true,
  },
  {
    key: "school_level",
    title: "Type of school",
    hint: "Asked of pupils and students only.",
    group: "demographics",
    labels: SCHOOL_LEVEL_LABELS,
    listed: true,
  },
  {
    key: "school_year",
    title: "School year",
    hint: "The year lists differ by country; primary school runs to year 9 in Slovenia and Bosnia.",
    group: "demographics",
    labels: SCHOOL_YEAR_LABELS,
    listed: true,
  },
  {
    key: "subject",
    title: "Field of study",
    hint: "Asked of university students only.",
    group: "demographics",
    labels: SUBJECT_LABELS,
    listed: true,
  },
  {
    key: "audience",
    title: "Who the account is for",
    group: "demographics",
    labels: AUDIENCE_LABELS,
    listed: true,
  },
  {
    key: "heard_from",
    title: "Where they heard about Memo AI",
    group: "demographics",
    labels: SOURCE_LABELS,
    listed: true,
  },
  {
    key: "motivation",
    title: "What they want from Memo AI",
    group: "goals",
    labels: MOTIVATION_LABELS,
    listed: true,
  },
  {
    key: "class_focus",
    title: "Studying for something specific",
    group: "goals",
    labels: CLASS_FOCUS_LABELS,
    listed: true,
  },
  {
    key: "daily_goal",
    title: "Daily study goal",
    group: "goals",
    labels: DAILY_GOAL_LABELS,
    listed: true,
  },
  {
    key: "grade_scale",
    title: "Marking scale",
    group: "goals",
    labels: GRADE_SCALE_LABELS,
    listed: true,
  },
  {
    key: "current_grade_5",
    title: "Current average, out of 5",
    hint: "Rounded to the nearest half mark.",
    group: "goals",
    labels: {},
    listed: false,
  },
  {
    key: "target_grade_5",
    title: "Target grade, out of 5",
    hint: "Rounded to the nearest half mark.",
    group: "goals",
    labels: {},
    listed: false,
  },
  {
    key: "current_grade_10",
    title: "Current average, out of 10",
    hint: "Rounded to the nearest whole mark.",
    group: "goals",
    labels: {},
    listed: false,
  },
  {
    key: "target_grade_10",
    title: "Target grade, out of 10",
    hint: "Rounded to the nearest whole mark.",
    group: "goals",
    labels: {},
    listed: false,
  },
  {
    key: "feature",
    title: "The feature they came for",
    group: "product",
    labels: FEATURE_LABELS,
    listed: true,
  },
  {
    key: "age_range",
    title: "Age",
    hint: "From an earlier revision of the survey; the current one has no age step.",
    group: "legacy",
    labels: AGE_LABELS,
    listed: true,
  },
  {
    key: "education_level",
    title: "Education level",
    hint: "The summary every account carries, derived from the school answer — including accounts from before the survey.",
    group: "legacy",
    labels: EDUCATION_LABELS,
    listed: true,
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
  const values = question.listed
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
      label: question.listed
        ? (question.labels[value] ?? value)
        : gradeLabel(question.key, value),
      count,
      share: answered > 0 ? count / answered : 0,
    };
  });

  // Grade buckets read best in grade order; everything else by popularity.
  if (question.listed) {
    answers.sort((a, b) => b.count - a.count);
  } else {
    answers.sort((a, b) => Number(a.value) - Number(b.value));
  }

  return { ...question, answered, answers };
}

