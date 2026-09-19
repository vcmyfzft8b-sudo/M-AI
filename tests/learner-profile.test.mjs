import assert from "node:assert/strict";
import test from "node:test";

import { toLearnerProfile } from "../src/lib/learner-profile.ts";

/*
 * What reaches the tutor about the person it is talking to. Two things can go
 * wrong here and both are visible to a learner: sending a raw survey code, which
 * the model then has to guess at, and sending something that is not a fact —
 * an e-mail local part read as a first name, an unrecognised code passed
 * through. Everything here is optional by design, so "nothing to send" has to
 * be an ordinary outcome rather than an empty object the prompt has to explain.
 */

test("survey codes reach the tutor as plain English", () => {
  assert.deepEqual(
    toLearnerProfile({
      full_name: "Nace Valenčič",
      onboarding_role: "university_student",
      onboarding_school_level: "university",
      onboarding_school_year: "sophomore",
      onboarding_subject: "computer_science",
    }),
    {
      name: "Nace",
      level: "a university student, year 2",
      subject: "computer science",
    },
  );
});

test("a first name only — a tutor does not use a surname", () => {
  assert.equal(toLearnerProfile({ full_name: "Nace Valenčič" }).name, "Nace");
});

test("an e-mail or a bare initial is not a name anybody is called", () => {
  assert.equal(toLearnerProfile({ full_name: "nace@example.com" }), null);
  assert.equal(toLearnerProfile({ full_name: "N" }), null);
  assert.equal(toLearnerProfile({ full_name: "   " }), null);
});

test("the school is only named where it tells two learners apart", () => {
  // Gymnasium against vocational is a different syllabus at a different depth.
  assert.equal(
    toLearnerProfile({
      onboarding_role: "high_school_student",
      onboarding_school_level: "vocational_school",
      onboarding_school_year: "year_3",
    }).level,
    "a secondary-school student at a vocational secondary school, year 3",
  );

  // "A primary-school pupil at primary school" is the role said twice.
  assert.equal(
    toLearnerProfile({
      onboarding_role: "elementary_student",
      onboarding_school_level: "elementary_school",
      onboarding_school_year: "grade_7",
    }).level,
    "a primary-school pupil, year 7",
  );
});

test("an unrecognised code is dropped, not guessed at or passed through", () => {
  // These columns are free text in the database, so anything can be in them.
  const profile = toLearnerProfile({
    full_name: "Ana",
    onboarding_role: "astronaut",
    onboarding_subject: "underwater_basket_weaving",
  });

  assert.deepEqual(profile, { name: "Ana" });
});

test("a learner who skipped the survey has nothing to send", () => {
  assert.equal(toLearnerProfile({}), null);
  assert.equal(toLearnerProfile(null), null);
  assert.equal(toLearnerProfile(undefined), null);
});

test("a year on its own is still worth sending", () => {
  assert.deepEqual(toLearnerProfile({ onboarding_school_year: "graduate" }), {
    level: "postgraduate",
  });
});
