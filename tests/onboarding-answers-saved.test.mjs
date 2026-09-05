import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  AUDIENCE_OPTIONS,
  AUDIENCE_VALUES,
  CLASS_FOCUS_OPTIONS,
  CLASS_FOCUS_VALUES,
  DAILY_GOAL_OPTIONS,
  DAILY_GOAL_VALUES,
  ELEMENTARY_SCHOOL_OPTIONS,
  FEATURE_OPTIONS,
  FEATURE_VALUES,
  HEARD_FROM_VALUES,
  HIGH_SCHOOL_OPTIONS,
  MOTIVATION_OPTIONS,
  MOTIVATION_VALUES,
  ROLE_OPTIONS,
  ROLE_VALUES,
  SCHOOL_LEVEL_VALUES,
  SCHOOL_YEAR_VALUES,
  SOURCE_OPTIONS,
  SUBJECT_OPTIONS,
  SUBJECT_VALUES,
  UNIVERSITY_SCHOOL_OPTIONS,
  getOnboardingYearOptions,
  gradeBounds,
  mapEducationLevel,
} from "../src/lib/onboarding-options.ts";
import { LOCALES } from "../src/lib/i18n/locales.ts";
import { en } from "../src/lib/i18n/messages/en.ts";

/**
 * Every answer the survey can give has somewhere to land.
 *
 * `POST /api/profile/onboarding` validates each answer against a `z.enum` built
 * from the tuples in `onboarding-options.ts`, and rejects the whole request if
 * one value is not in its tuple. So a step that offers an option the tuple does
 * not carry does not lose that one answer — it loses the entire survey, silently
 * from the learner's side, because the flow saves once and moves on.
 *
 * The redesign made that a live risk rather than a theoretical one: it added six
 * tools to the feature step (a voice tutor, podcasts, the memory palace, the
 * speed reader, mindmaps and chatting with your notes), none of which the
 * original six-value enum knew about.
 */

const ROUTE = readFileSync(
  fileURLToPath(new URL("../src/app/api/profile/onboarding/route.ts", import.meta.url)),
  "utf8",
);
const FLOW = readFileSync(
  fileURLToPath(new URL("../src/components/onboarding-flow.tsx", import.meta.url)),
  "utf8",
);

function values(options) {
  return options.map((option) => option.value);
}

test("each answer is validated against the list the survey actually renders", () => {
  /*
   * The tuples are derived from the option lists, so a value can only go
   * unaccepted if the route pairs an answer with the wrong tuple — or if the
   * screen stops rendering the shared list and grows a copy of its own. The
   * design this flow was ported from did exactly that, and its copy had drifted:
   * twelve tools against twelve labels in a different order, so every label on
   * the step named the option above it. Reading the lists from one place is what
   * makes that unrepresentable, and this is the test that keeps it that way.
   */
  const pairings = [
    ["heardFrom", "HEARD_FROM_VALUES", "SOURCE_OPTIONS"],
    ["audience", "AUDIENCE_VALUES", "AUDIENCE_OPTIONS"],
    ["role", "ROLE_VALUES", "ROLE_OPTIONS"],
    ["schoolLevel", "SCHOOL_LEVEL_VALUES", null],
    ["schoolYear", "SCHOOL_YEAR_VALUES", null],
    ["subject", "SUBJECT_VALUES", "SUBJECT_OPTIONS"],
    ["motivation", "MOTIVATION_VALUES", "MOTIVATION_OPTIONS"],
    ["feature", "FEATURE_VALUES", "FEATURE_OPTIONS"],
    ["classFocus", "CLASS_FOCUS_VALUES", "CLASS_FOCUS_OPTIONS"],
    ["dailyGoal", "DAILY_GOAL_VALUES", "DAILY_GOAL_OPTIONS"],
  ];

  for (const [answer, tuple, list] of pairings) {
    assert.match(
      ROUTE,
      new RegExp(`${answer}: z\\.enum\\(${tuple}\\)`),
      `the route does not validate "${answer}" against ${tuple}`,
    );

    if (list) {
      assert.match(FLOW, new RegExp(`\\b${list}\\b`), `the survey does not render ${list}`);
    }
  }

  /*
   * And no second copy of the labels. A value may legitimately be named in the
   * screen — the review on the testimonial step is picked by the reader's role —
   * but a *label* written out here would be a second catalogue, which is exactly
   * the shape the drift took.
   */
  for (const label of [
    ...FEATURE_OPTIONS,
    ...SUBJECT_OPTIONS,
    ...ROLE_OPTIONS,
    ...MOTIVATION_OPTIONS,
    ...DAILY_GOAL_OPTIONS,
  ].map((option) => en[option.labelKey])) {
    assert.doesNotMatch(FLOW, new RegExp(`"${label}"`), `"${label}" is written out in the survey`);
  }
});

test("every option the survey offers is a value the endpoint accepts", () => {
  const cases = [
    ["heardFrom", values(SOURCE_OPTIONS), HEARD_FROM_VALUES],
    ["audience", values(AUDIENCE_OPTIONS), AUDIENCE_VALUES],
    ["role", values(ROLE_OPTIONS), ROLE_VALUES],
    ["subject", values(SUBJECT_OPTIONS), SUBJECT_VALUES],
    ["motivation", values(MOTIVATION_OPTIONS), MOTIVATION_VALUES],
    ["feature", values(FEATURE_OPTIONS), FEATURE_VALUES],
    ["classFocus", values(CLASS_FOCUS_OPTIONS), CLASS_FOCUS_VALUES],
    ["dailyGoal", values(DAILY_GOAL_OPTIONS), DAILY_GOAL_VALUES],
  ];

  for (const [name, offered, accepted] of cases) {
    for (const value of offered) {
      assert.ok(accepted.includes(value), `${name}: "${value}" is offered but not accepted`);
    }
  }
});

test("every school and year the survey can reach is a value the endpoint accepts", () => {
  const schools = [
    ...values(ELEMENTARY_SCHOOL_OPTIONS),
    ...values(HIGH_SCHOOL_OPTIONS),
    ...values(UNIVERSITY_SCHOOL_OPTIONS),
  ];

  for (const school of schools) {
    assert.ok(SCHOOL_LEVEL_VALUES.includes(school), `schoolLevel: "${school}"`);
  }

  for (const locale of LOCALES) {
    for (const role of ["elementary_student", "high_school_student", "university_student"]) {
      for (const school of [...schools, undefined]) {
        for (const year of values(getOnboardingYearOptions(locale, role, school))) {
          assert.ok(SCHOOL_YEAR_VALUES.includes(year), `${locale}/${role}: "${year}"`);
        }
      }
    }
  }
});

test("every school maps to an education level the endpoint accepts", () => {
  // The literal union the route declares for `educationLevel`.
  const accepted = ROUTE.match(/educationLevel: z\.enum\(\[([^\]]+)\]\)/)[1]
    .split(",")
    .map((entry) => entry.trim().replace(/^"|"$/g, ""))
    .filter(Boolean);

  const schools = [
    ...values(ELEMENTARY_SCHOOL_OPTIONS),
    ...values(HIGH_SCHOOL_OPTIONS),
    ...values(UNIVERSITY_SCHOOL_OPTIONS),
    // What the form holds before the school step, and for a role that skips it.
    "",
  ];

  for (const school of schools) {
    assert.ok(
      accepted.includes(mapEducationLevel(school)),
      `${school || "(unanswered)"} -> ${mapEducationLevel(school)}`,
    );
  }
});

test("the grade steppers stay inside the range the endpoint allows", () => {
  // `gradeSchema` on the route: z.number().min(1).max(10).
  const min = Number(ROUTE.match(/const gradeSchema = z\.number\(\)\.min\((\d+)\)/)[1]);
  const max = Number(ROUTE.match(/const gradeSchema = z\.number\(\)\.min\(\d+\)\.max\((\d+)\)/)[1]);

  for (const school of ["", "elementary_school", "high_school", "university", "college"]) {
    const bounds = gradeBounds(school);
    assert.ok(bounds.min >= min, `${school}: floor ${bounds.min} below ${min}`);
    assert.ok(bounds.max <= max, `${school}: ceiling ${bounds.max} above ${max}`);
    assert.ok(bounds.current >= bounds.min && bounds.current <= bounds.max, `${school}: default`);
    assert.ok(bounds.target >= bounds.min && bounds.target <= bounds.max, `${school}: target`);
  }
});

test("the survey sends every answer it collects", () => {
  // The keys the endpoint reads off `answers` and writes to a column.
  const stored = [...ROUTE.matchAll(/onboarding_\w+: answers\.(\w+)/g)].map((match) => match[1]);
  assert.ok(stored.length >= 12, `expected the full answer set, found ${stored.length}`);

  const sent = FLOW.slice(FLOW.indexOf("answers: {"), FLOW.indexOf("}),\n      });"));

  for (const key of stored) {
    assert.match(sent, new RegExp(`\\b${key}:`), `the survey never sends "${key}"`);
  }

  // The two the endpoint takes as text on the profile itself, plus the scale
  // that says which of the two grade ranges the numbers are on.
  for (const key of ["currentAverageGrade", "targetGrade", "gradeScale"]) {
    assert.match(sent, new RegExp(`\\b${key}:`), `the survey never sends "${key}"`);
  }
});

test("the study goal cannot exceed the length the endpoint accepts", () => {
  const limit = Number(ROUTE.match(/studyGoal: z\.string\(\)\.trim\(\)\.min\(1\)\.max\((\d+)\)/)[1]);
  assert.match(FLOW, new RegExp(`\\.slice\\(0, ${limit}\\)`));
});

/**
 * The last screen is reached when two independent things have both finished:
 * the loader's ring filling and sitting for its beat, and the answers reaching
 * the server. The ring takes two to four seconds; a save on a bad connection
 * can take longer. Asking once, at the end of the beat, left anyone whose save
 * had not come back stranded on a screen that says the plan is ready and
 * carries no button at all — no error, no retry, nothing to press.
 */
test("the loader waits for whichever finishes last, the beat or the save", () => {
  const loader = FLOW.slice(FLOW.indexOf("const finishLoading"), FLOW.indexOf("const goRef"));

  // Both sides call it: the beat's timer, and the save resolving.
  assert.match(loader, /submit\(\)\.then\(\(\) => finishLoadingRef\.current\(\)\)/);
  assert.match(loader, /loaderSettled\.current = true;\s*\n\s*finishLoadingRef\.current\(\);/);

  // And it refuses until both are true, rather than sampling one of them.
  assert.match(
    FLOW.slice(FLOW.indexOf("const finishLoading"), FLOW.indexOf("const finishLoadingRef")),
    /if \(!loaderSettled\.current \|\| !\(saved\.current \|\| demo\)\) \{\s*\n\s*return;/,
  );

  // A retry starts the wait over rather than inheriting the last one's beat.
  assert.match(FLOW, /loaderSettled\.current = false;/);
});

test("a saved profile is complete enough to count as onboarded", () => {
  /*
   * `hasCompletedOnboardingProfile` wants five columns, not just the timestamp.
   * A save that set the timestamp and left one of the others empty would return
   * 200 and still land the user back at the start of the survey, which is the
   * same trap by another route — so the endpoint must write all five, and the
   * schema must refuse a request that would leave any of them blank.
   */
  const billing = readFileSync(
    fileURLToPath(new URL("../src/lib/billing.ts", import.meta.url)),
    "utf8",
  );
  const required = billing
    .slice(billing.indexOf("function hasCompletedOnboardingProfile"))
    .slice(0, billing.slice(billing.indexOf("function hasCompletedOnboardingProfile")).indexOf("}"))
    .match(/profile\??\.(\w+)/g)
    .map((match) => match.split(".")[1]);

  assert.ok(required.length >= 5, `expected five columns, found ${required.join(", ")}`);

  const upsert = ROUTE.slice(ROUTE.indexOf(".upsert({"), ROUTE.indexOf("as never"));

  for (const column of required) {
    assert.match(upsert, new RegExp(`\\b${column}:`), `the endpoint never writes "${column}"`);
    assert.doesNotMatch(
      upsert,
      new RegExp(`\\b${column}: null`),
      `the endpoint writes "${column}" as null, which never counts as onboarded`,
    );
  }

  // The three the survey sends as text can never arrive empty.
  for (const field of ["currentAverageGrade", "targetGrade", "studyGoal"]) {
    assert.match(ROUTE, new RegExp(`${field}: z\\.string\\(\\)\\.trim\\(\\)\\.min\\(1\\)`), field);
  }
});
