import assert from "node:assert/strict";
import test from "node:test";

import {
  LABELLED_OPTION_LISTS,
  ONBOARDING_QUESTIONS,
  toQuestionBreakdown,
} from "../src/lib/admin/onboarding-questions.ts";

const question = (key) => {
  const found = ONBOARDING_QUESTIONS.find((entry) => entry.key === key);
  assert.ok(found, `no question for ${key}`);
  return found;
};

test("every value the survey can store has an English label on the dashboard", () => {
  for (const [key, options] of Object.entries(LABELLED_OPTION_LISTS)) {
    const { labels } = question(key);

    for (const option of options) {
      assert.ok(
        typeof labels[option.value] === "string" && labels[option.value].length > 0,
        `${key} is missing a label for "${option.value}"`,
      );
    }
  }
});

test("every labelled question is backed by the option list it labels", () => {
  for (const entry of ONBOARDING_QUESTIONS) {
    if (entry.listed && entry.key !== "grade_scale") {
      assert.ok(LABELLED_OPTION_LISTS[entry.key], `${entry.key} has labels but no option list`);
    }
  }
});

test("a listed question draws every option, zero or not, most popular first", () => {
  const breakdown = toQuestionBreakdown(question("audience"), [
    { question: "audience", answer: "me_family", respondents: 3 },
    { question: "audience", answer: "me", respondents: 5 },
  ]);

  assert.equal(breakdown.answered, 8);
  assert.deepEqual(
    breakdown.answers.map((answer) => [answer.value, answer.count]),
    [
      ["me", 5],
      ["me_family", 3],
      ["someone_else", 0],
    ],
  );
  assert.equal(breakdown.answers[0].share, 5 / 8);
});

test("a value the option list does not know is still shown under its raw value", () => {
  const breakdown = toQuestionBreakdown(question("heard_from"), [
    { question: "heard_from", answer: "billboard", respondents: 2 },
  ]);

  const stray = breakdown.answers.find((answer) => answer.value === "billboard");

  assert.ok(stray, "the unknown value must not be dropped");
  assert.equal(stray.label, "billboard");
  assert.equal(stray.share, 1);
});

test("grade buckets read in grade order with the scale spelled out", () => {
  const breakdown = toQuestionBreakdown(question("current_grade_5"), [
    { question: "current_grade_5", answer: "4.5", respondents: 1 },
    { question: "current_grade_5", answer: "3.0", respondents: 4 },
    { question: "current_grade_5", answer: "3.5", respondents: 2 },
  ]);

  assert.deepEqual(
    breakdown.answers.map((answer) => answer.label),
    ["3 / 5", "3.5 / 5", "4.5 / 5"],
  );

  const ten = toQuestionBreakdown(question("target_grade_10"), [
    { question: "target_grade_10", answer: "8", respondents: 1 },
  ]);

  assert.equal(ten.answers[0].label, "8 / 10");
});
