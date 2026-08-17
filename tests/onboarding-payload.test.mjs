import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOnboardingPayload,
  onboardingPayloadSchema,
} from "../src/lib/onboarding-options.ts";

// The survey pre-fills every field before the user reaches it, so `form` on its own
// always looks like a complete set of answers. These tests pin the part that tells
// a real answer apart from a default: a payload that reports a default as an answer
// is indistinguishable from a real one once it is in the database.

const NO_GRADES = { currentAverageGrade: false, targetGrade: false };

// What the component holds after a university student answers every step.
const universityForm = {
  heardFrom: "tiktok",
  audience: "me",
  role: "university_student",
  schoolLevel: "university",
  schoolYear: "sophomore",
  subject: "computer_science",
  motivation: "learn_faster",
  targetGrade: 9,
  currentAverageGrade: 7.5,
  feature: "flashcards",
  classFocus: "upcoming_exam",
  dailyGoal: "serious",
};

const allAnswered = Object.fromEntries(Object.keys(universityForm).map((key) => [key, true]));

test("stores every answer a student gave", () => {
  const payload = buildOnboardingPayload({
    form: universityForm,
    answered: allAnswered,
    gradeTouched: { currentAverageGrade: true, targetGrade: true },
  });

  assert.deepEqual(payload.answers, {
    heardFrom: "tiktok",
    audience: "me",
    role: "university_student",
    schoolLevel: "university",
    schoolYear: "sophomore",
    subject: "computer_science",
    motivation: "learn_faster",
    feature: "flashcards",
    classFocus: "upcoming_exam",
    dailyGoal: "serious",
    currentAverageGrade: 7.5,
    targetGrade: 9,
    gradeScale: 10,
  });
  assert.equal(onboardingPayloadSchema.safeParse(payload).success, true);
});

test("a non-student never sees the school steps, so they stay null", () => {
  // Role `working_professional` jumps step 2 -> 7: schoolLevel, schoolYear and
  // subject keep the defaults the form was seeded with and were never chosen.
  const payload = buildOnboardingPayload({
    form: { ...universityForm, role: "working_professional" },
    answered: {
      heardFrom: true,
      audience: true,
      role: true,
      motivation: true,
      feature: true,
      classFocus: true,
      dailyGoal: true,
    },
    gradeTouched: NO_GRADES,
  });

  assert.equal(payload.answers.role, "working_professional");
  assert.equal(payload.answers.schoolLevel, null);
  assert.equal(payload.answers.schoolYear, null);
  assert.equal(payload.answers.subject, null);
  assert.equal(onboardingPayloadSchema.safeParse(payload).success, true);
});

test("a skipped grade step stores no grade and no scale", () => {
  // Both grade steps offer "Preskoči" while the stepper still shows a default.
  const payload = buildOnboardingPayload({
    form: universityForm,
    answered: allAnswered,
    gradeTouched: NO_GRADES,
  });

  assert.equal(payload.answers.currentAverageGrade, null);
  assert.equal(payload.answers.targetGrade, null);
  assert.equal(payload.answers.gradeScale, null);
});

test("adjusting one grade records the scale it was read on", () => {
  const fivePoint = buildOnboardingPayload({
    form: { ...universityForm, schoolLevel: "high_school", currentAverageGrade: 3.5 },
    answered: allAnswered,
    gradeTouched: { currentAverageGrade: true, targetGrade: false },
  });

  // 3,5 out of 5 — storing it without the scale would read as a near-fail out of 10.
  assert.equal(fivePoint.answers.currentAverageGrade, 3.5);
  assert.equal(fivePoint.answers.targetGrade, null);
  assert.equal(fivePoint.answers.gradeScale, 5);
});

test("the derived summary fields keep their existing shape", () => {
  const payload = buildOnboardingPayload({
    form: universityForm,
    answered: allAnswered,
    gradeTouched: { currentAverageGrade: true, targetGrade: true },
  });

  assert.equal(payload.educationLevel, "university");
  assert.equal(payload.currentAverageGrade, "7,5");
  assert.equal(payload.targetGrade, "9,0");
  assert.ok(payload.studyGoal.length <= 240);
  assert.equal("ageRange" in payload, false);
});

test("the API rejects a value the survey cannot produce", () => {
  const payload = buildOnboardingPayload({
    form: universityForm,
    answered: allAnswered,
    gradeTouched: NO_GRADES,
  });

  for (const [key, value] of [
    ["role", "astronaut"],
    ["gradeScale", 7],
    ["targetGrade", 11],
  ]) {
    const result = onboardingPayloadSchema.safeParse({
      ...payload,
      answers: { ...payload.answers, [key]: value },
    });
    assert.equal(result.success, false, `${key}=${value} should be rejected`);
  }
});
