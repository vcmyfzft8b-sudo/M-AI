/**
 * Who the tutor is talking to, in the three facts that change an answer.
 *
 * The onboarding survey already asks all of this and nothing the tutor said
 * had ever read it: the same explanation, in the same words, went to a
 * nine-year-old and to a postgraduate. What the model gets here is deliberately
 * small — a first name, a level, a field of study — because those are the parts
 * that change how a thing should be explained. The rest of the survey (how they
 * heard about us, which feature they wanted, their target grade) would only be
 * context to ignore.
 *
 * Every field is optional and the whole block is optional: a learner who
 * skipped onboarding, or signed in with an e-mail that carries no name, gets a
 * tutor that writes for a capable student, which is what it did for everyone
 * before this existed.
 *
 * Kept free of "server-only" and of any Supabase import so the mapping stays
 * unit-testable (tests/learner-profile.test.mjs). The read itself lives in
 * `learner-profile.server.ts`, next to the client it needs.
 */

/** The columns `toLearnerProfile` reads, for the select list. */
export const LEARNER_PROFILE_COLUMNS =
  "full_name, onboarding_role, onboarding_school_level, onboarding_school_year, onboarding_subject";

export type LearnerProfileRow = {
  full_name?: string | null;
  onboarding_role?: string | null;
  onboarding_school_level?: string | null;
  onboarding_school_year?: string | null;
  onboarding_subject?: string | null;
};

export type LearnerProfile = {
  /** First name only. A tutor does not use a surname. */
  name?: string;
  /** Plain English, e.g. "a university student, year 2". */
  level?: string;
  /** Plain English, e.g. "computer science". */
  subject?: string;
};

/*
 * The stored values are survey codes (`high_school_student`, `freshman`,
 * `life_physical_sciences`). They are mapped rather than passed through because
 * a code is not a fact a model can pitch an explanation at, and because an
 * unrecognised one is better dropped than guessed at — these columns are free
 * text in the database, so anything can be in them.
 */
const ROLES: Record<string, string> = {
  elementary_student: "a primary-school pupil",
  high_school_student: "a secondary-school student",
  university_student: "a university student",
  working_professional: "a working professional studying on the side",
  parent: "a parent studying alongside their child",
  teacher: "a teacher",
};

/*
 * The school, and the role it would only repeat.
 *
 * "A secondary-school student at a vocational secondary school" is worth the
 * words — it is a different syllabus taught to a different depth than a
 * gymnasium. "A university student at university" is the same fact twice, and
 * the extra clause makes the model likelier to read the block back to the
 * learner rather than quietly pitch its answer with it.
 */
const SCHOOL_LEVELS: Record<string, { label: string; repeatsRole?: string }> = {
  elementary_school: { label: "primary school", repeatsRole: "elementary_student" },
  high_school: { label: "a gymnasium (academic secondary school)" },
  technical_school: { label: "a technical secondary school" },
  vocational_school: { label: "a vocational secondary school" },
  university: { label: "university", repeatsRole: "university_student" },
  college: { label: "college" },
};

const YEARS: Record<string, string> = {
  grade_1: "year 1",
  grade_2: "year 2",
  grade_3: "year 3",
  grade_4: "year 4",
  grade_5: "year 5",
  grade_6: "year 6",
  grade_7: "year 7",
  grade_8: "year 8",
  grade_9: "year 9",
  year_1: "year 1",
  year_2: "year 2",
  year_3: "year 3",
  year_4: "year 4",
  year_5: "year 5",
  freshman: "year 1",
  sophomore: "year 2",
  junior: "year 3",
  senior: "year 4",
  graduate: "postgraduate",
};

const SUBJECTS: Record<string, string> = {
  arts_humanities: "arts and humanities",
  business_economics: "business and economics",
  computer_science: "computer science",
  maths: "mathematics",
  education: "education",
  engineering_technology: "engineering and technology",
  health_medicine: "health and medicine",
  law_criminal_justice: "law",
  life_physical_sciences: "life and physical sciences",
  social_sciences: "social sciences",
};

/** The part of a name a tutor would actually say. */
function firstName(fullName: string | null | undefined) {
  const first = (fullName ?? "").trim().split(/\s+/)[0] ?? "";

  // An e-mail local part or a single initial is not a name anybody is called.
  return first.length >= 2 && first.length <= 40 && !first.includes("@") ? first : undefined;
}

function describeLevel(row: LearnerProfileRow) {
  const roleCode = row.onboarding_role ?? "";
  const role = ROLES[roleCode];
  const school = SCHOOL_LEVELS[row.onboarding_school_level ?? ""];
  const year = YEARS[row.onboarding_school_year ?? ""];
  const worthSaying = school && school.repeatsRole !== roleCode ? school.label : undefined;
  const head = role
    ? worthSaying
      ? `${role} at ${worthSaying}`
      : role
    : worthSaying
      ? `studying at ${worthSaying}`
      : undefined;

  if (!head) {
    return year;
  }

  return year ? `${head}, ${year}` : head;
}

/** The prompt block, or null when the survey told us nothing worth sending. */
export function toLearnerProfile(row: LearnerProfileRow | null | undefined): LearnerProfile | null {
  if (!row) {
    return null;
  }

  const name = firstName(row.full_name);
  const level = describeLevel(row);
  const subject = SUBJECTS[row.onboarding_subject ?? ""];

  const profile: LearnerProfile = {
    ...(name ? { name } : {}),
    ...(level ? { level } : {}),
    ...(subject ? { subject } : {}),
  };

  return Object.keys(profile).length > 0 ? profile : null;
}
