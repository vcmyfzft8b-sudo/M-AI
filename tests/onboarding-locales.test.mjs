import assert from "node:assert/strict";
import test from "node:test";

import { getOnboardingYearOptions } from "../src/lib/onboarding-options.ts";

function values(options) {
  return options.map((option) => option.value);
}

test("primary-school onboarding shows the correct number of grades per market", () => {
  assert.deepEqual(
    values(getOnboardingYearOptions("sl", "elementary_student")),
    Array.from({ length: 9 }, (_, index) => `grade_${index + 1}`),
  );
  assert.deepEqual(
    values(getOnboardingYearOptions("bs", "elementary_student")),
    Array.from({ length: 9 }, (_, index) => `grade_${index + 1}`),
  );

  for (const locale of ["en", "hr", "sr"]) {
    assert.deepEqual(
      values(getOnboardingYearOptions(locale, "elementary_student")),
      Array.from({ length: 8 }, (_, index) => `grade_${index + 1}`),
      locale,
    );
  }
});

test("secondary-school onboarding follows the selected programme", () => {
  const fourYears = ["year_1", "year_2", "year_3", "year_4"];
  const fiveYears = [...fourYears, "year_5"];

  for (const locale of ["sl", "en", "hr", "bs", "sr"]) {
    assert.deepEqual(
      values(getOnboardingYearOptions(locale, "high_school_student", "high_school")),
      fourYears,
      `${locale} general secondary school`,
    );
  }

  for (const locale of ["sl", "hr"]) {
    assert.deepEqual(
      values(getOnboardingYearOptions(locale, "high_school_student", "technical_school")),
      fiveYears,
      `${locale} technical school`,
    );
  }

  for (const locale of ["en", "bs", "sr"]) {
    assert.deepEqual(
      values(getOnboardingYearOptions(locale, "high_school_student", "vocational_school")),
      fourYears,
      `${locale} vocational school`,
    );
  }
});

test("non-school roles keep the shared university-year choices", () => {
  // First year first. Every other year list in the survey counts up, and the
  // redesign brought this one into line rather than starting at the top of the
  // degree; the stored values are unchanged, only the order they are offered in.
  const expected = ["freshman", "sophomore", "junior", "senior", "graduate"];

  for (const locale of ["sl", "en", "hr", "bs", "sr"]) {
    assert.deepEqual(values(getOnboardingYearOptions(locale, "teacher")), expected, locale);
  }
});
