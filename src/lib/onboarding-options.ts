import type { Locale } from "./i18n/locales.ts";

/*
 * Every option carries a `labelKey` rather than a label. The survey runs in
 * five languages; the stored `value` is what the database constrains and must
 * not move, so translation happens on the way to the screen.
 *
 * The stored values stay common across markets, while the visible range is
 * selected below. Slovenia and Bosnia and Herzegovina have nine primary-school
 * years; Croatia and Serbia have eight. English is the global fallback and
 * uses the broadly applicable eight-year list. Secondary technical/vocational
 * programmes may reach a fifth year in Slovenia and Croatia, while the
 * Bosnian, Serbian and global-English flows stop at four.
 */

// Unused until the survey gets a real age step: these are the buckets the
// profiles_age_range_check constraint accepts.
export const AGE_OPTIONS = [
  { value: "under_16", labelKey: "onboarding.opt.age.under16" },
  { value: "16_18", labelKey: "onboarding.opt.age.16to18" },
  { value: "19_22", labelKey: "onboarding.opt.age.19to22" },
  { value: "23_29", labelKey: "onboarding.opt.age.23to29" },
  { value: "30_plus", labelKey: "onboarding.opt.age.30plus" },
] as const;

export const EDUCATION_OPTIONS = [
  { value: "high_school", labelKey: "onboarding.opt.education.highSchool" },
  { value: "university", labelKey: "onboarding.opt.education.university" },
  { value: "masters", labelKey: "onboarding.opt.education.masters" },
  { value: "self_study", labelKey: "onboarding.opt.education.selfStudy" },
  { value: "other", labelKey: "onboarding.opt.other" },
] as const;

export const SOURCE_OPTIONS = [
  { value: "instagram_reels", labelKey: "onboarding.opt.source.instagram", icon: "instagram" },
  { value: "tiktok", labelKey: "onboarding.opt.source.tiktok", icon: "tiktok" },
  { value: "chatgpt", labelKey: "onboarding.opt.source.chatgpt", icon: "chatgpt" },
  { value: "friend", labelKey: "onboarding.opt.source.friend", icon: "💬" },
  { value: "other", labelKey: "onboarding.opt.other", icon: "✏️" },
] as const;

export const AUDIENCE_OPTIONS = [
  { value: "me", labelKey: "onboarding.opt.audience.me", icon: "🌱" },
  { value: "me_family", labelKey: "onboarding.opt.audience.meFamily", icon: "🌳" },
  { value: "someone_else", labelKey: "onboarding.opt.audience.someoneElse", icon: "🎁" },
] as const;

export const ROLE_OPTIONS = [
  {
    value: "working_professional",
    labelKey: "onboarding.opt.role.working",
    descriptionKey: "onboarding.opt.role.workingDesc",
    icon: "💼",
  },
  {
    value: "elementary_student",
    labelKey: "onboarding.opt.role.elementary",
    descriptionKey: "onboarding.opt.role.elementaryDesc",
    icon: "📘",
  },
  {
    value: "high_school_student",
    labelKey: "onboarding.opt.role.highSchool",
    descriptionKey: "onboarding.opt.role.highSchoolDesc",
    icon: "📚",
  },
  {
    value: "university_student",
    labelKey: "onboarding.opt.role.university",
    descriptionKey: "onboarding.opt.role.universityDesc",
    icon: "🎓",
  },
  {
    value: "parent",
    labelKey: "onboarding.opt.role.parent",
    descriptionKey: "onboarding.opt.role.parentDesc",
    icon: "👨‍👩‍👧",
  },
  {
    value: "teacher",
    labelKey: "onboarding.opt.role.teacher",
    descriptionKey: "onboarding.opt.role.teacherDesc",
    icon: "🧑‍🏫",
  },
] as const;

export const ELEMENTARY_SCHOOL_OPTIONS = [
  { value: "elementary_school", labelKey: "onboarding.opt.school.elementary", icon: "🏫" },
  { value: "other", labelKey: "onboarding.opt.somethingElse", icon: "✍️" },
] as const;

export const HIGH_SCHOOL_OPTIONS = [
  { value: "high_school", labelKey: "onboarding.opt.school.gymnasium", icon: "📘" },
  { value: "technical_school", labelKey: "onboarding.opt.school.technical", icon: "🧰" },
  { value: "vocational_school", labelKey: "onboarding.opt.school.vocational", icon: "🔧" },
  { value: "other", labelKey: "onboarding.opt.somethingElse", icon: "✍️" },
] as const;

export const UNIVERSITY_SCHOOL_OPTIONS = [
  { value: "university", labelKey: "onboarding.opt.school.university", icon: "📚" },
  { value: "college", labelKey: "onboarding.opt.school.college", icon: "🎓" },
  { value: "other", labelKey: "onboarding.opt.somethingElse", icon: "✍️" },
] as const;

export const SCHOOL_OPTIONS = [
  { value: "elementary_school", labelKey: "onboarding.opt.school.elementary", icon: "🏫" },
  { value: "high_school", labelKey: "onboarding.opt.school.secondary", icon: "📘" },
  { value: "university", labelKey: "onboarding.opt.school.university", icon: "📚" },
  { value: "other", labelKey: "onboarding.opt.somethingElse", icon: "✍️" },
] as const;

export const ELEMENTARY_YEAR_OPTIONS = [
  { value: "grade_1", labelKey: "onboarding.opt.grade1", icon: "🌱" },
  { value: "grade_2", labelKey: "onboarding.opt.grade2", icon: "🌿" },
  { value: "grade_3", labelKey: "onboarding.opt.grade3", icon: "🪴" },
  { value: "grade_4", labelKey: "onboarding.opt.grade4", icon: "🌳" },
  { value: "grade_5", labelKey: "onboarding.opt.grade5", icon: "📗" },
  { value: "grade_6", labelKey: "onboarding.opt.grade6", icon: "📘" },
  { value: "grade_7", labelKey: "onboarding.opt.grade7", icon: "📙" },
  { value: "grade_8", labelKey: "onboarding.opt.grade8", icon: "📕" },
  { value: "grade_9", labelKey: "onboarding.opt.grade9", icon: "🎒" },
] as const;

export const HIGH_SCHOOL_YEAR_OPTIONS = [
  { value: "year_1", labelKey: "onboarding.opt.year1", icon: "🌱" },
  { value: "year_2", labelKey: "onboarding.opt.year2", icon: "🌿" },
  { value: "year_3", labelKey: "onboarding.opt.year3", icon: "🪴" },
  { value: "year_4", labelKey: "onboarding.opt.year4", icon: "🌳" },
  { value: "year_5", labelKey: "onboarding.opt.year5", icon: "🍂" },
] as const;

export const HIGH_SCHOOL_FOUR_YEAR_OPTIONS = HIGH_SCHOOL_YEAR_OPTIONS.slice(0, 4);

export const ELEMENTARY_EIGHT_YEAR_OPTIONS = ELEMENTARY_YEAR_OPTIONS.slice(0, 8);

/** The school-year choices appropriate to the locale currently onboarding. */
export function getOnboardingYearOptions(
  locale: Locale,
  role: string,
  schoolLevel?: string,
) {
  if (role === "elementary_student") {
    return locale === "sl" || locale === "bs"
      ? ELEMENTARY_YEAR_OPTIONS
      : ELEMENTARY_EIGHT_YEAR_OPTIONS;
  }

  if (role === "high_school_student") {
    if (schoolLevel === "high_school") {
      return HIGH_SCHOOL_FOUR_YEAR_OPTIONS;
    }

    return locale === "sl" || locale === "hr"
      ? HIGH_SCHOOL_YEAR_OPTIONS
      : HIGH_SCHOOL_FOUR_YEAR_OPTIONS;
  }

  return UNIVERSITY_YEAR_OPTIONS;
}

// First year first: the redesign counts up, the way every other year list on
// the screen does, rather than starting at the top of the degree.
export const UNIVERSITY_YEAR_OPTIONS = [
  { value: "freshman", labelKey: "onboarding.opt.uniYear1", icon: "🌱" },
  { value: "sophomore", labelKey: "onboarding.opt.uniYear2", icon: "🌿" },
  { value: "junior", labelKey: "onboarding.opt.uniYear3", icon: "🪴" },
  { value: "senior", labelKey: "onboarding.opt.uniYear4Plus", icon: "🌳" },
  { value: "graduate", labelKey: "onboarding.opt.uniGraduate", icon: "🍂" },
] as const;

export const SUBJECT_OPTIONS = [
  { value: "arts_humanities", labelKey: "onboarding.opt.subject.arts", icon: "🎨" },
  { value: "business_economics", labelKey: "onboarding.opt.subject.business", icon: "💼" },
  { value: "computer_science", labelKey: "onboarding.opt.subject.cs", icon: "💻" },
  { value: "maths", labelKey: "onboarding.opt.subject.maths", icon: "📐" },
  { value: "education", labelKey: "onboarding.opt.subject.education", icon: "📚" },
  { value: "engineering_technology", labelKey: "onboarding.opt.subject.engineering", icon: "⚙️" },
  { value: "health_medicine", labelKey: "onboarding.opt.subject.health", icon: "🏥" },
  { value: "law_criminal_justice", labelKey: "onboarding.opt.subject.law", icon: "⚖️" },
  { value: "life_physical_sciences", labelKey: "onboarding.opt.subject.sciences", icon: "🔬" },
  { value: "social_sciences", labelKey: "onboarding.opt.subject.social", icon: "🌍" },
] as const;

export const MOTIVATION_OPTIONS = [
  { value: "improve_marks", labelKey: "onboarding.opt.motivation.marks", icon: "💯" },
  { value: "learn_faster", labelKey: "onboarding.opt.motivation.faster", icon: "📗" },
  { value: "focus_better", labelKey: "onboarding.opt.motivation.focus", icon: "🎙️" },
  { value: "never_miss_detail", labelKey: "onboarding.opt.motivation.detail", icon: "📈" },
  { value: "something_else", labelKey: "onboarding.opt.somethingElse", icon: "✍️" },
] as const;

/*
 * Everything Memo AI can make out of one note, in the order the onboarding
 * shows them. The six added for the redesign are the tools that shipped after
 * the original survey was written; the stored values are new, and the columns
 * that hold them are free text, so nothing has to be migrated for them.
 */
export const FEATURE_OPTIONS = [
  { value: "quizzes", labelKey: "onboarding.opt.feature.quizzes", icon: "📝" },
  { value: "flashcards", labelKey: "note.tab.flashcards", icon: "🃏" },
  { value: "tests", labelKey: "onboarding.opt.feature.tests", icon: "✅" },
  { value: "voice_tutor", labelKey: "onboarding.opt.feature.tutor", icon: "🎙️" },
  { value: "podcast", labelKey: "onboarding.opt.feature.podcast", icon: "📻" },
  { value: "memory_palace", labelKey: "onboarding.opt.feature.palace", icon: "🏛️" },
  { value: "record_lectures", labelKey: "onboarding.opt.feature.personalisation", icon: "✨" },
  { value: "speed_read", labelKey: "onboarding.opt.feature.speedRead", icon: "⚡" },
  { value: "mindmap", labelKey: "onboarding.opt.feature.mindmap", icon: "🕸️" },
  { value: "audio_notes", labelKey: "onboarding.opt.feature.audioNotes", icon: "🎧" },
  { value: "library_chat", labelKey: "library.chatFab", icon: "💬" },
  { value: "ai_chat_notes", labelKey: "onboarding.opt.feature.readAloud", icon: "🔊" },
] as const;

export const CLASS_FOCUS_OPTIONS = [
  { value: "specific_class", labelKey: "onboarding.opt.focus.specificClass", icon: "📗" },
  { value: "upcoming_exam", labelKey: "onboarding.opt.focus.upcomingExam", icon: "📅" },
  { value: "something_else", labelKey: "onboarding.opt.focus.somethingElse", icon: "👀" },
  { value: "general_help", labelKey: "onboarding.opt.focus.general", icon: "📈" },
] as const;

export const DAILY_GOAL_OPTIONS = [
  { value: "casual", labelKey: "onboarding.opt.goal.casual", icon: "🍃" },
  { value: "regular", labelKey: "onboarding.opt.goal.regular", icon: "🌱" },
  { value: "serious", labelKey: "onboarding.opt.goal.serious", icon: "🌿" },
  { value: "intensive", labelKey: "onboarding.opt.goal.intensive", icon: "🌳" },
] as const;

function optionValues<Lists extends readonly (readonly { value: string }[])[]>(
  ...optionLists: Lists
) {
  type Value = Lists[number][number]["value"];

  const values = Array.from(
    new Set(optionLists.flatMap((options) => options.map((option) => option.value))),
  ) as Value[];

  return values as [Value, ...Value[]];
}

export const HEARD_FROM_VALUES = optionValues(SOURCE_OPTIONS);
export const AUDIENCE_VALUES = optionValues(AUDIENCE_OPTIONS);
export const ROLE_VALUES = optionValues(ROLE_OPTIONS);
export const SCHOOL_LEVEL_VALUES = optionValues(
  ELEMENTARY_SCHOOL_OPTIONS,
  HIGH_SCHOOL_OPTIONS,
  UNIVERSITY_SCHOOL_OPTIONS,
  SCHOOL_OPTIONS,
);
export const SCHOOL_YEAR_VALUES = optionValues(
  ELEMENTARY_YEAR_OPTIONS,
  HIGH_SCHOOL_YEAR_OPTIONS,
  UNIVERSITY_YEAR_OPTIONS,
);
export const SUBJECT_VALUES = optionValues(SUBJECT_OPTIONS);
export const MOTIVATION_VALUES = optionValues(MOTIVATION_OPTIONS);
export const FEATURE_VALUES = optionValues(FEATURE_OPTIONS);
export const CLASS_FOCUS_VALUES = optionValues(CLASS_FOCUS_OPTIONS);
export const DAILY_GOAL_VALUES = optionValues(DAILY_GOAL_OPTIONS);

/**
 * Whether a school marks out of ten rather than out of five.
 *
 * Universities and colleges here do; every school below them does not. It
 * decides both the range the grade steppers move in and the `gradeScale` the
 * answer is stored with, so it lives beside the options rather than inside the
 * screen that draws them.
 */
export function usesTenPointGrades(schoolLevel: string) {
  return schoolLevel === "university" || schoolLevel === "college";
}

/** The range and step the grade steppers move in, for a given school. */
export function gradeBounds(schoolLevel: string) {
  return usesTenPointGrades(schoolLevel)
    ? { min: 5, max: 10, step: 0.5, current: 6, target: 8 }
    : { min: 1, max: 5, step: 0.1, current: 3.5, target: 4.5 };
}

/**
 * The `education_level` a school answer is stored as.
 *
 * `profiles.education_level` predates the survey's own school list and has five
 * values where the survey has ten, so every school the survey can offer is
 * mapped onto one of them here — and it must stay total, because the column is
 * what the rest of the app reads.
 */
export function mapEducationLevel(schoolLevel: string): (typeof EDUCATION_OPTIONS)[number]["value"] {
  if (
    schoolLevel === "elementary_school" ||
    schoolLevel === "high_school" ||
    schoolLevel === "technical_school" ||
    schoolLevel === "vocational_school"
  ) {
    return "high_school";
  }

  if (schoolLevel === "college") {
    return "university";
  }

  if (schoolLevel === "other") {
    return "other";
  }

  return "university";
}

export const GRADE_SCALES = [5, 10] as const;
export type GradeScale = (typeof GRADE_SCALES)[number];
