// Unused until the survey gets a real age step: these are the buckets the
// profiles_age_range_check constraint accepts.
export const AGE_OPTIONS = [
  { value: "under_16", label: "Manj kot 16" },
  { value: "16_18", label: "16-18" },
  { value: "19_22", label: "19-22" },
  { value: "23_29", label: "23-29" },
  { value: "30_plus", label: "30+" },
] as const;

export const EDUCATION_OPTIONS = [
  { value: "high_school", label: "Srednja šola" },
  { value: "university", label: "Fakulteta" },
  { value: "masters", label: "Magisterij" },
  { value: "self_study", label: "Samostojno učenje" },
  { value: "other", label: "Drugo" },
] as const;

export const SOURCE_OPTIONS = [
  { value: "instagram_reels", label: "Instagram Reels", icon: "instagram" },
  { value: "tiktok", label: "TikTok", icon: "tiktok" },
  { value: "chatgpt", label: "ChatGPT", icon: "chatgpt" },
  { value: "friend", label: "Prijatelj", icon: "💬" },
  { value: "other", label: "Drugo", icon: "✏️" },
] as const;

export const AUDIENCE_OPTIONS = [
  { value: "me", label: "Zame", icon: "🌱" },
  { value: "me_family", label: "Zame + družina", icon: "🌳" },
  { value: "someone_else", label: "Za nekoga drugega (ne zame)", icon: "🎁" },
] as const;

export const ROLE_OPTIONS = [
  {
    value: "working_professional",
    label: "Zaposlen/a",
    description: "Sestanki, glasovni zapiski in drugo",
    icon: "💼",
  },
  {
    value: "elementary_student",
    label: "Osnovnošolec",
    description: "Učenje, domače naloge in priprava na teste",
    icon: "📘",
  },
  {
    value: "high_school_student",
    label: "Dijak",
    description: "Zapiski, testi in matura",
    icon: "📚",
  },
  {
    value: "university_student",
    label: "Študent",
    description: "Predavanja, izpiti/testi in študijsko gradivo",
    icon: "🎓",
  },
  {
    value: "parent",
    label: "Starš",
    description: "Preizkus za otroka ali darilo naročnine",
    icon: "👨‍👩‍👧",
  },
  {
    value: "teacher",
    label: "Učitelj/profesor",
    description: "Snemanje predavanj, deljenje zapiskov ali drugo",
    icon: "🧑‍🏫",
  },
] as const;

export const ELEMENTARY_SCHOOL_OPTIONS = [
  { value: "elementary_school", label: "Osnovna šola", icon: "🏫" },
  { value: "other", label: "Nekaj drugega", icon: "✍️" },
] as const;

export const HIGH_SCHOOL_OPTIONS = [
  { value: "high_school", label: "Gimnazija", icon: "📘" },
  { value: "technical_school", label: "Srednja strokovna šola", icon: "🧰" },
  { value: "vocational_school", label: "Poklicna šola", icon: "🔧" },
  { value: "other", label: "Nekaj drugega", icon: "✍️" },
] as const;

export const UNIVERSITY_SCHOOL_OPTIONS = [
  { value: "university", label: "Fakulteta / univerza", icon: "📚" },
  { value: "college", label: "Višja šola", icon: "🎓" },
  { value: "other", label: "Nekaj drugega", icon: "✍️" },
] as const;

export const SCHOOL_OPTIONS = [
  { value: "elementary_school", label: "Osnovna šola", icon: "🏫" },
  { value: "high_school", label: "Srednja šola", icon: "📘" },
  { value: "university", label: "Fakulteta / univerza", icon: "📚" },
  { value: "other", label: "Nekaj drugega", icon: "✍️" },
] as const;

export const ELEMENTARY_YEAR_OPTIONS = [
  { value: "grade_1", label: "1. razred", icon: "🌱" },
  { value: "grade_2", label: "2. razred", icon: "🌿" },
  { value: "grade_3", label: "3. razred", icon: "🪴" },
  { value: "grade_4", label: "4. razred", icon: "🌳" },
  { value: "grade_5", label: "5. razred", icon: "📗" },
  { value: "grade_6", label: "6. razred", icon: "📘" },
  { value: "grade_7", label: "7. razred", icon: "📙" },
  { value: "grade_8", label: "8. razred", icon: "📕" },
  { value: "grade_9", label: "9. razred", icon: "🎒" },
] as const;

export const HIGH_SCHOOL_YEAR_OPTIONS = [
  { value: "year_1", label: "1. letnik", icon: "🌱" },
  { value: "year_2", label: "2. letnik", icon: "🌿" },
  { value: "year_3", label: "3. letnik", icon: "🪴" },
  { value: "year_4", label: "4. letnik", icon: "🌳" },
  { value: "year_5", label: "5. letnik", icon: "🍂" },
] as const;

export const HIGH_SCHOOL_FOUR_YEAR_OPTIONS = HIGH_SCHOOL_YEAR_OPTIONS.slice(0, 4);

export const UNIVERSITY_YEAR_OPTIONS = [
  { value: "senior", label: "4. letnik ali več", icon: "🌳" },
  { value: "junior", label: "3. letnik", icon: "🪴" },
  { value: "sophomore", label: "2. letnik", icon: "🌿" },
  { value: "freshman", label: "1. letnik", icon: "🌱" },
  { value: "graduate", label: "Podiplomski študij", icon: "🍂" },
] as const;

export const SUBJECT_OPTIONS = [
  { value: "arts_humanities", label: "Umetnost in humanistika", icon: "🎨" },
  { value: "business_economics", label: "Ekonomija", icon: "💼" },
  { value: "computer_science", label: "Računalništvo", icon: "💻" },
  { value: "maths", label: "Matematika", icon: "📐" },
  { value: "education", label: "Pedagoške smeri", icon: "📚" },
  { value: "engineering_technology", label: "Inženirstvo in tehnologija", icon: "⚙️" },
  { value: "health_medicine", label: "Zdravstvo in medicina", icon: "🏥" },
  { value: "law_criminal_justice", label: "Pravo", icon: "⚖️" },
  { value: "life_physical_sciences", label: "Naravoslovje", icon: "🔬" },
  { value: "social_sciences", label: "Družboslovje", icon: "🌍" },
] as const;

export const MOTIVATION_OPTIONS = [
  { value: "improve_marks", label: "Izboljšati ocene", icon: "💯" },
  { value: "learn_faster", label: "Učiti se 10x hitreje", icon: "📗" },
  { value: "focus_better", label: "Bolje slediti predavanjem", icon: "🎙️" },
  { value: "never_miss_detail", label: "Ne zamuditi podrobnosti na predavanju", icon: "📈" },
  { value: "something_else", label: "Nekaj drugega", icon: "✍️" },
] as const;

export const FEATURE_OPTIONS = [
  { value: "audio_notes", label: "Audio zapiski", icon: "🎧" },
  { value: "quizzes", label: "Kvizi", icon: "📝" },
  { value: "flashcards", label: "Flashcards", icon: "🃏" },
  { value: "record_lectures", label: "Personalizacija zapiskov", icon: "✨" },
  { value: "tests", label: "Testi", icon: "✅" },
  { value: "ai_chat_notes", label: "Branje zapiskov", icon: "🔊" },
] as const;

export const CLASS_FOCUS_OPTIONS = [
  { value: "specific_class", label: "Da, določen predmet", icon: "📗" },
  { value: "upcoming_exam", label: "Da, prihajajoči izpit/test", icon: "📅" },
  { value: "something_else", label: "Da, nekaj drugega", icon: "👀" },
  { value: "general_help", label: "Ne, pomagaj mi na splošno", icon: "📈" },
] as const;

export const DAILY_GOAL_OPTIONS = [
  { value: "casual", label: "Sproščeno - 10 min / dan", icon: "🍃" },
  { value: "regular", label: "Redno - 20 min / dan", icon: "🌱" },
  { value: "serious", label: "Resno - 60 min / dan", icon: "🌿" },
  { value: "intensive", label: "Intenzivno - 90+ min / dan", icon: "🌳" },
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

export const GRADE_SCALES = [5, 10] as const;
export type GradeScale = (typeof GRADE_SCALES)[number];
