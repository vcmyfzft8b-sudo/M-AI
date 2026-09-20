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
import {
  onboardingSubmissionSchema,
} from "../src/lib/onboarding-submission.ts";

/**
 * A minimal submission the schema accepts, so a test can change one field and
 * ask whether that field alone is the reason it was refused.
 */
function submission(overrides = {}) {
  return {
    educationLevel: "high_school",
    currentAverageGrade: "3,5",
    targetGrade: "4,5",
    studyGoal: "Boljse ocene.",
    ...overrides,
  };
}

function accepts(value) {
  return onboardingSubmissionSchema.safeParse(value).success;
}

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
    ["heardFrom", "HEARD_FROM_VALUES", "SOURCE_OPTIONS", HEARD_FROM_VALUES],
    ["audience", "AUDIENCE_VALUES", "AUDIENCE_OPTIONS", AUDIENCE_VALUES],
    ["role", "ROLE_VALUES", "ROLE_OPTIONS", ROLE_VALUES],
    ["schoolLevel", "SCHOOL_LEVEL_VALUES", null, SCHOOL_LEVEL_VALUES],
    ["schoolYear", "SCHOOL_YEAR_VALUES", null, SCHOOL_YEAR_VALUES],
    ["subject", "SUBJECT_VALUES", "SUBJECT_OPTIONS", SUBJECT_VALUES],
    ["motivation", "MOTIVATION_VALUES", "MOTIVATION_OPTIONS", MOTIVATION_VALUES],
    ["feature", "FEATURE_VALUES", "FEATURE_OPTIONS", FEATURE_VALUES],
    ["classFocus", "CLASS_FOCUS_VALUES", "CLASS_FOCUS_OPTIONS", CLASS_FOCUS_VALUES],
    ["dailyGoal", "DAILY_GOAL_VALUES", "DAILY_GOAL_OPTIONS", DAILY_GOAL_VALUES],
  ];

  for (const [answer, , list, accepted] of pairings) {
    // Put every accepted value through the validator itself rather than
    // reading the route's source for a `z.enum` that may not live there any
    // more — it is shared with the anonymous route now — and, more to the
    // point, so the test fails when the schema stops accepting a value rather
    // than when somebody reformats the line that declares it.
    for (const value of accepted) {
      assert.ok(
        accepts(submission({ answers: { [answer]: value } })),
        `"${answer}" does not accept ${value}, which the survey offers`,
      );
    }
    assert.ok(
      !accepts(submission({ answers: { [answer]: "not-an-option" } })),
      `"${answer}" accepts a value that is not on any list`,
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
  const schools = [
    ...values(ELEMENTARY_SCHOOL_OPTIONS),
    ...values(HIGH_SCHOOL_OPTIONS),
    ...values(UNIVERSITY_SCHOOL_OPTIONS),
    // What the form holds before the school step, and for a role that skips it.
    "",
  ];

  for (const school of schools) {
    assert.ok(
      accepts(submission({ educationLevel: mapEducationLevel(school) })),
      `${school || "(unanswered)"} -> ${mapEducationLevel(school)} is not accepted`,
    );
  }
});

test("the grade steppers stay inside the range the endpoint allows", () => {
  // Asked of the validator rather than of its source: every stepper's own
  // floor and ceiling is offered to it, and has to come back accepted.
  for (const school of ["", "elementary_school", "high_school", "university", "college"]) {
    const bounds = gradeBounds(school);
    // `step` is a stride, not a grade, so it is not one of the values offered.
    for (const name of ["min", "max", "current", "target"]) {
      assert.ok(
        accepts(submission({ answers: { currentAverageGrade: bounds[name], targetGrade: bounds[name] } })),
        `${school || "(unanswered)"}: ${name} of ${bounds[name]} is outside what the endpoint allows`,
      );
    }
    assert.ok(bounds.current >= bounds.min && bounds.current <= bounds.max, `${school}: default`);
    assert.ok(bounds.target >= bounds.min && bounds.target <= bounds.max, `${school}: target`);
  }

  // And the range is bounded at all, in both directions.
  assert.ok(!accepts(submission({ answers: { currentAverageGrade: 0 } })), "no floor");
  assert.ok(!accepts(submission({ answers: { currentAverageGrade: 11 } })), "no ceiling");
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
  const limit = onboardingSubmissionSchema.shape.studyGoal.maxLength;
  assert.ok(limit > 0, "the study goal has no declared ceiling");

  // The ceiling is real...
  assert.ok(accepts(submission({ studyGoal: "x".repeat(limit) })), `${limit} refused`);
  assert.ok(!accepts(submission({ studyGoal: "x".repeat(limit + 1) })), `${limit + 1} accepted`);
  // ...and the survey trims to exactly it, rather than to a number of its own
  // that would quietly start losing whole surveys if either side moved.
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

  // The three the survey sends as text can never arrive empty — asked of the
  // validator, which is what actually decides it.
  for (const field of ["currentAverageGrade", "targetGrade", "studyGoal"]) {
    assert.ok(!accepts(submission({ [field]: "" })), `"${field}" may arrive empty`);
    assert.ok(!accepts(submission({ [field]: "   " })), `"${field}" may arrive blank`);
  }
});

/**
 * The keyboard presses the button rather than guessing at what it does.
 *
 * Enter used to advance a step directly, which is not the same thing: on the
 * last screen there is no step after it, so "Make my first note" — the one
 * button that leaves the flow — was the only call to action in it the keyboard
 * could not press, and on the loading step Enter was refused outright even when
 * the button there was the retry after a failed save.
 */
test("Enter presses the call to action wherever there is one", () => {
  const handler = FLOW.slice(FLOW.indexOf("const onKey ="), FLOW.indexOf('window.addEventListener("keydown"'));

  assert.match(handler, /if \(ctaRef\.current\.enabled\) \{\s*\n\s*ctaRef\.current\.press\(\);/);
  // A question step has no button at all — picking an option is what advances
  // it — so that one case still moves the step directly.
  assert.match(handler, /if \(active\.kind === "q"\)/);
  // And the old shortcut is gone from every other case.
  assert.doesNotMatch(handler, /active\.kind === "loading"/);

  // One definition of "pressable", shared by the button and the keyboard.
  assert.match(FLOW, /ctaRef\.current = \{ press: pressCta, enabled: showCta && !ctaDisabled && !finishing \}/);
  assert.match(FLOW, /next: pressCta,/);

  // Typing in the practice test's answer box is still typing.
  assert.match(handler, /\^\(INPUT\|TEXTAREA\)\$/);
});

/**
 * A label has to fit inside its own tile, in every language.
 *
 * The two steps that lay their options out in columns give each tile about
 * 174px on a 390px phone, and the design's padding, icon and gap took 82 of
 * them — leaving 92px for the label, which is narrower than the single word
 * "Personalizacija". A word cannot wrap inside itself, so it went out through
 * the side of the tile. It is the longest word either of those steps has in any
 * of the five languages, so the trimmed chrome that gives the label 120px is
 * what makes all of them fit; `overflow-wrap` is the backstop for the day one
 * of them gets longer.
 */
test("the option label has room to wrap and cannot leave its tile", () => {
  assert.match(FLOW, /const OPTION_CHROME = \{/);
  // The roomier single-column numbers are the design's own.
  assert.match(FLOW, /single: \{ padding: "0\.95rem", icon: "clamp\(1\.55rem, 4\.6vh, 2\.5rem\)", gap: "0\.8rem" \}/);
  // The trimmed ones apply exactly where the tiles are half-width.
  assert.match(FLOW, /step\.cols === WRAPPING_COLUMNS \? OPTION_CHROME\.columns : OPTION_CHROME\.single/);

  // And the tile actually reads them rather than carrying its own copy.
  const button = FLOW.slice(FLOW.indexOf("{v.options.map("), FLOW.indexOf("{item.label}"));
  assert.match(button, /gap: v\.optionGap/);
  assert.match(button, /padding: `clamp\(0\.3rem, 1\.2vh, 0\.8rem\) \$\{v\.optionPad\}`/);
  assert.match(button, /width: v\.optionIcon, height: v\.optionIcon/);
  assert.match(button, /overflowWrap: "anywhere"/);
});
