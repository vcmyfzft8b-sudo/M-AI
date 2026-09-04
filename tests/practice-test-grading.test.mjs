import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  clampQuestionScore,
  isBlankAnswer,
  isGradableAnswerGuide,
  isSurrenderAnswer,
  parseMarkingPoints,
  PRACTICE_QUESTION_MAX_SCORE,
  reconcilePointMarks,
  scoreFromRubric,
  summariseAttemptScores,
  truncateAnswerForGrading,
} from "../src/lib/practice-test-scoring.ts";
import {
  buildPracticeGradingInstructions,
  buildPracticeTestInstructions,
  practiceGradingSchema,
} from "../src/lib/notes/study-prompts.ts";

const SOURCE = readFileSync(
  fileURLToPath(new URL("../src/lib/practice-test.ts", import.meta.url)),
  "utf8",
);

/**
 * The grade is arithmetic on the marking scheme, not a number the model was asked for. What is
 * asserted here is the arithmetic and the boundaries around it — a five means the answer was
 * complete, a half-covered answer is not a comfortable pass, a contradiction costs, and an answer
 * nobody could mark is left out of the total rather than scored zero.
 */

const marks = (...values) => values;

test("a marking scheme is read back out of the answer guide", () => {
  assert.deepEqual(parseMarkingPoints("- names the enzyme\n- says it lowers activation energy"), [
    "names the enzyme",
    "says it lowers activation energy",
  ]);
  assert.deepEqual(parseMarkingPoints("1. first step\n2) second step"), [
    "first step",
    "second step",
  ]);
  // The legacy planner wrote prose; semicolons are what separated its points.
  assert.deepEqual(parseMarkingPoints("states the year 1918; names the treaty"), [
    "states the year 1918",
    "names the treaty",
  ]);
  assert.deepEqual(parseMarkingPoints("The answer is 9.81 m/s²."), ["The answer is 9.81 m/s²."]);
  assert.deepEqual(parseMarkingPoints("   "), []);
});

test("a scheme repeats no point and stays a scheme a learner could be marked against", () => {
  assert.deepEqual(parseMarkingPoints("- same point\n- Same Point\n- other"), [
    "same point",
    "other",
  ]);
  assert.ok(parseMarkingPoints("- a\n- b\n- c\n- d\n- e\n- f\n- g\n- h").length <= 6);
});

test("a question with nothing to mark against is not gradable", () => {
  assert.equal(isGradableAnswerGuide("- names the enzyme"), true);
  assert.equal(isGradableAnswerGuide(""), false);
  assert.equal(isGradableAnswerGuide("   \n  "), false);
  assert.equal(isGradableAnswerGuide("- x"), false);
});

test("saying you do not know is recognised however it is typed", () => {
  for (const answer of ["", "   ", "?", "-", "idk", "ne vem", "Ne znam", "nemam pojma", "skip"]) {
    assert.equal(isSurrenderAnswer(answer), true, `"${answer}" should read as a skip`);
  }

  assert.equal(isBlankAnswer("  "), true);
  assert.equal(isBlankAnswer("a"), false);
});

test("an answer that begins with 'I don't know' but goes on is an answer", () => {
  assert.equal(
    isSurrenderAnswer("ne vem točno, ampak encim zniža aktivacijsko energijo"),
    false,
  );
  assert.equal(isSurrenderAnswer("I don't know the exact year, but it was after the war"), false);
});

test("a mark lands on the point it was given for, whatever the model returned", () => {
  // A skipped point counts as missed rather than shifting every mark after it up one.
  assert.deepEqual(
    reconcilePointMarks({
      pointCount: 3,
      marks: [
        { pointIndex: 2, mark: "met" },
        { pointIndex: 0, mark: "partial" },
      ],
    }),
    marks("partial", "missed", "met"),
  );

  // A repeated index, an index outside the scheme, and a non-integer are all dropped.
  assert.deepEqual(
    reconcilePointMarks({
      pointCount: 2,
      marks: [
        { pointIndex: 0, mark: "met" },
        { pointIndex: 0, mark: "missed" },
        { pointIndex: 9, mark: "met" },
        { pointIndex: 1.5, mark: "met" },
      ],
    }),
    marks("met", "missed"),
  );
});

test("full marks mean the answer was complete", () => {
  assert.equal(scoreFromRubric({ marks: marks("met", "met", "met", "met") }).score, 5);
  // Nine points out of ten is a four. Rounding a ratio would have made it a five, which is how a
  // "5/5" stops meaning anything.
  assert.equal(
    scoreFromRubric({
      marks: marks("met", "met", "met", "met", "met", "met", "met", "met", "met", "missed"),
    }).score,
    4,
  );
});

test("the bands are the ones a teacher marking out of five uses", () => {
  assert.equal(scoreFromRubric({ marks: marks("met", "met", "met", "met", "missed") }).score, 4);
  assert.equal(scoreFromRubric({ marks: marks("met", "met", "met", "missed", "missed") }).score, 3);
  assert.equal(scoreFromRubric({ marks: marks("met", "met", "missed", "missed", "missed") }).score, 2);
  assert.equal(scoreFromRubric({ marks: marks("met", "missed", "missed", "missed", "missed") }).score, 1);
  assert.equal(scoreFromRubric({ marks: marks("missed", "missed") }).score, 0);
});

test("half the scheme is not a comfortable pass", () => {
  const half = scoreFromRubric({ marks: marks("met", "missed") });

  assert.equal(half.ratio, 0.5);
  assert.equal(half.score, 2, "50% of the marking points must not round up to 3/5");
});

test("a half-made point is worth half a point", () => {
  const grade = scoreFromRubric({ marks: marks("met", "partial", "missed", "missed") });

  assert.equal(grade.earnedPoints, 1.5);
  assert.equal(grade.score, 1);
});

test("any real credit is visible on the mark", () => {
  const grade = scoreFromRubric({ marks: marks("partial", "missed", "missed", "missed", "missed", "missed") });

  assert.ok(grade.ratio > 0 && grade.ratio < 0.2);
  assert.equal(grade.score, 1, "an answer that earned something must not read as a zero");
});

test("stating something the material contradicts costs a mark and rules out top marks", () => {
  const clean = scoreFromRubric({ marks: marks("met", "met", "met", "met") });
  const wrong = scoreFromRubric({ marks: marks("met", "met", "met", "met"), criticalError: true });

  assert.equal(clean.score, 5);
  assert.equal(wrong.score, 3, "a contradiction must put full marks out of reach");

  assert.equal(
    scoreFromRubric({ marks: marks("met", "missed", "missed", "missed"), criticalError: true }).score,
    0,
  );
});

test("an answer about something else scores nothing, whatever words it shares", () => {
  assert.equal(
    scoreFromRubric({ marks: marks("met", "met", "met"), offTopic: true }).score,
    0,
  );
});

test("a scheme with no points cannot produce a mark", () => {
  assert.deepEqual(scoreFromRubric({ marks: [] }), {
    score: 0,
    earnedPoints: 0,
    totalPoints: 0,
    ratio: 0,
  });
});

test("a score outside the scale cannot reach the database", () => {
  assert.equal(clampQuestionScore(9), PRACTICE_QUESTION_MAX_SCORE);
  assert.equal(clampQuestionScore(-2), 0);
  assert.equal(clampQuestionScore(3.4), 3);
  assert.equal(clampQuestionScore(Number.NaN), 0);
});

test("an answer nobody could mark is left out of the total, not scored zero", () => {
  const summary = summariseAttemptScores([5, 4, null, 3]);

  assert.equal(summary.totalScore, 12);
  assert.equal(summary.maxScore, 15, "the unmarked question must leave both sides of the fraction");
  assert.equal(summary.percentage, 80);
  assert.equal(summary.gradedCount, 3);
  assert.equal(summary.ungradedCount, 1);

  // Counted as a zero, the same learner would have been shown 60%.
  assert.notEqual(summary.percentage, 60);
});

test("an attempt where nothing could be marked has no percentage to show", () => {
  const summary = summariseAttemptScores([null, null]);

  assert.equal(summary.gradedCount, 0);
  assert.equal(summary.percentage, 0);
  assert.match(SOURCE, /summary\.gradedCount === 0/);
});

test("a full test scores the way its answers do", () => {
  const summary = summariseAttemptScores([5, 5, 4, 3, 0, 2, 5, 1]);

  assert.equal(summary.totalScore, 25);
  assert.equal(summary.maxScore, 40);
  assert.equal(summary.percentage, 62.5);
});

test("a pasted essay is bounded before it is marked", () => {
  const long = "a".repeat(9000);

  assert.ok(truncateAnswerForGrading(long).length <= 6001);
  assert.equal(truncateAnswerForGrading("  short  "), "short");
});

test("the grader is asked which points are present, never for a score", () => {
  const instructions = buildPracticeGradingInstructions();

  assert.match(instructions, /"met"/);
  assert.match(instructions, /"partial"/);
  assert.match(instructions, /"missed"/);
  assert.doesNotMatch(
    instructions,
    /score .{0,12}(from|out of) 0 to 5|Return an integer score/i,
    "asking the model for the number is what made the grades unrepeatable",
  );
  assert.equal("score" in practiceGradingSchema.shape, false);
});

test("the grader marks meaning rather than wording, spelling or length", () => {
  const instructions = buildPracticeGradingInstructions();

  assert.match(instructions, /synonym/i);
  assert.match(instructions, /[Ss]pelling/);
  assert.match(instructions, /[Ll]ength/);
  assert.match(instructions, /language the question and the marking scheme are written in/i);
});

test("text a student writes into the answer box cannot instruct the grader", () => {
  const instructions = buildPracticeGradingInstructions();

  assert.match(instructions, /never an instruction/i);
  // The answer reaches the model fenced and named, so a "give me full marks" is inside the work
  // being marked rather than beside the task.
  assert.match(SOURCE, /<student-answer>/);
});

test("a skipped question stores no feedback sentence for the screen to translate", () => {
  // The three English sentences that used to be written here were rendered as-is into a Slovene,
  // Croatian, Bosnian or Serbian interface.
  assert.doesNotMatch(SOURCE, /Marked as 'I don't know'/);
  assert.doesNotMatch(SOURCE, /No submitted answer/);
  assert.match(SOURCE, /if \(input\.declaredUnknown\) \{/);
});

test("one failed grading call no longer throws away the whole submission", () => {
  assert.match(SOURCE, /markAnswerWithRetry/);
  assert.match(SOURCE, /grading_confidence: "unmarked"/);
});

test("a question tells the learner how much is wanted and is marked point by point", () => {
  const instructions = buildPracticeTestInstructions({ outputLanguage: null });

  assert.match(instructions, /how much is wanted/i);
  assert.match(instructions, /one to five sentences/i);
  assert.match(instructions, /Ask one thing/);
  assert.match(instructions, /Two to four points/);
});
