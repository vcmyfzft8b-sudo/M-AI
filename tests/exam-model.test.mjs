import assert from "node:assert/strict";
import test from "node:test";

import {
  addDays,
  buildTrueFalse,
  dailyPlan,
  dateStrip,
  dayKey,
  daysBetween,
  examMastery,
  examModuleStates,
  gradeForPercentage,
  isValidDay,
  mockQuestionCounts,
  monthGrid,
  pickFlashcards,
  pickQuiz,
  pickWritten,
  seededShuffle,
  spreadAcrossModules,
  streakDays,
  summarizeMock,
} from "../src/lib/exams/exam-model.ts";

const result = (lecture_id, lesson_kind, score, completed_at = "2026-10-14T10:00:00Z") => ({
  lecture_id,
  lesson_kind,
  score,
  completed_at,
});

test("days are Ljubljana days, not UTC days", () => {
  // 23:30 UTC on the 13th is already the 14th in Ljubljana (UTC+2 in October).
  assert.equal(dayKey("2026-10-13T23:30:00Z"), "2026-10-14");
  assert.equal(dayKey("2026-10-13T21:30:00Z"), "2026-10-13");
});

test("calendar arithmetic ignores daylight-saving changes", () => {
  // Clocks go back on 25 Oct 2026.
  assert.equal(addDays("2026-10-24", 2), "2026-10-26");
  assert.equal(daysBetween("2026-10-14", "2026-10-26"), 12);
  assert.equal(daysBetween("2026-10-26", "2026-10-14"), -12);
  assert.equal(isValidDay("2026-02-30"), false);
  assert.equal(isValidDay("2026-10-26"), true);
});

test("a module is mastered by its practice lessons, and the summary only counts as done", () => {
  const states = examModuleStates(
    ["a"],
    [result("a", "summary", 1), result("a", "flashcards", 1), result("a", "quiz", 0.6)],
  );

  assert.equal(states[0].lessonsDone, 3);
  assert.equal(states[0].completed, false);
  assert.equal(states[0].mastery, (1 + 0.6) / 4);
  assert.equal(states[0].nextKind, "true_false");
});

test("only the latest try of a lesson counts toward mastery", () => {
  const states = examModuleStates(
    ["a"],
    [
      result("a", "quiz", 0.2, "2026-10-12T10:00:00Z"),
      result("a", "quiz", 0.8, "2026-10-14T10:00:00Z"),
    ],
  );

  assert.equal(states[0].latest.quiz, 0.8);
});

test("modules unlock in order, and starting a locked one opens it", () => {
  const all = ["summary", "flashcards", "quiz", "true_false", "written"].map((kind) =>
    result("a", kind, 1),
  );
  const states = examModuleStates(["a", "b", "c", "d"], [...all, result("d", "quiz", 0.9)]);

  assert.deepEqual(
    states.map((state) => state.unlocked),
    [true, true, false, true],
  );
  assert.equal(states[0].completed, true);
  // A completed module continues with its weakest practice lesson.
  assert.ok(["flashcards", "quiz", "true_false", "written"].includes(states[0].nextKind));
  assert.equal(examMastery(states), (1 + 0 + 0 + 0.9 / 4) / 4);
});

test("the daily goal spreads what is left over the days before the exam", () => {
  const plan = dailyPlan({
    examDate: "2026-10-26",
    today: "2026-10-14",
    dailyMinutes: 30,
    states: [{ lessonsDone: 0 }, { lessonsDone: 0 }, { lessonsDone: 0 }, { lessonsDone: 0 }],
    resultsToday: 0,
    untriedDoneToday: 0,
  });

  // 20 lessons over 12 days is 2 a day, but 30 minutes buys 5.
  assert.equal(plan.goal, 5);
  assert.equal(plan.daysLeft, 12);
  assert.equal(plan.remaining, 20);
});

test("finishing a lesson moves today's count, not today's goal", () => {
  const before = dailyPlan({
    examDate: "2026-10-16",
    today: "2026-10-14",
    dailyMinutes: 15,
    states: [{ lessonsDone: 0 }, { lessonsDone: 0 }],
    resultsToday: 0,
    untriedDoneToday: 0,
  });
  const after = dailyPlan({
    examDate: "2026-10-16",
    today: "2026-10-14",
    dailyMinutes: 15,
    states: [{ lessonsDone: 1 }, { lessonsDone: 0 }],
    resultsToday: 1,
    untriedDoneToday: 1,
  });

  assert.equal(before.goal, 5);
  assert.equal(after.goal, before.goal);
  assert.equal(after.doneToday, 1);
});

test("the streak counts back from today, or from yesterday until today is done", () => {
  const days = ["2026-10-11", "2026-10-12", "2026-10-13"];

  assert.equal(streakDays(days, "2026-10-13"), 3);
  assert.equal(streakDays(days, "2026-10-14"), 3);
  assert.equal(streakDays(days, "2026-10-15"), 0);
  assert.equal(streakDays([], "2026-10-15"), 0);
});

test("the date strip starts two days back and marks the exam", () => {
  const strip = dateStrip("2026-10-24", "2026-10-26", new Set(["2026-10-22"]));

  assert.equal(strip[0].day, "2026-10-22");
  assert.equal(strip[0].active, true);
  assert.equal(strip[2].isToday, true);
  assert.equal(strip[4].isExam, true);
  assert.equal(strip[4].weekday, 0);
});

test("the month grid is whole weeks, Monday first", () => {
  const grid = monthGrid("2026-10-14");

  assert.equal(grid.length % 7, 0);
  assert.equal(grid[0].day, "2026-09-28");
  assert.equal(grid[3].day, "2026-10-01");
  assert.equal(grid.at(-1).day, "2026-11-01");
  assert.equal(grid.filter((cell) => cell.inMonth).length, 31);
});

test("grades follow the exam's own scale", () => {
  assert.equal(gradeForPercentage("uni_5_10", 49, 50), "5");
  assert.equal(gradeForPercentage("uni_5_10", 50, 50), "6");
  assert.equal(gradeForPercentage("uni_5_10", 74, 50), "8");
  assert.equal(gradeForPercentage("uni_5_10", 100, 50), "10");
  assert.equal(gradeForPercentage("school_1_5", 40, 50), "1");
  assert.equal(gradeForPercentage("school_1_5", 50, 50), "2");
  assert.equal(gradeForPercentage("school_1_5", 100, 50), "5");
  assert.equal(gradeForPercentage("percent", 73.6, 50), "74 %");
});

test("a lesson drawn twice on the same day is the same lesson", () => {
  const items = ["a", "b", "c", "d", "e", "f"];

  assert.deepEqual(seededShuffle(items, "seed"), seededShuffle(items, "seed"));
  assert.notDeepEqual(seededShuffle(items, "seed"), seededShuffle(items, "other-seed"));
  assert.deepEqual([...seededShuffle(items, "seed")].sort(), items);
});

test("flashcards put missed cards first, then unseen ones", () => {
  const cards = [
    { id: "easy", progress: { confidence_bucket: "easy", last_reviewed_at: "2026-10-01" } },
    { id: "new", progress: null },
    { id: "again", progress: { confidence_bucket: "again", last_reviewed_at: "2026-10-10" } },
    { id: "good", progress: { confidence_bucket: "good", last_reviewed_at: "2026-10-05" } },
  ];

  assert.deepEqual(
    pickFlashcards(cards, 3, "s").map((card) => card.id),
    ["again", "new", "good"],
  );
});

const QUIZ = Array.from({ length: 8 }, (_, index) => ({
  id: `q${index}`,
  prompt: `Question ${index}`,
  options: ["right", "wrong one", "wrong two", "wrong three"],
  correct_option_idx: 0,
  explanation: "because",
}));

test("shuffled quiz options still point at the right answer", () => {
  for (const question of pickQuiz(QUIZ, 5, "day")) {
    assert.equal(question.options[question.correctIndex], "right");
    assert.equal(question.options.length, 4);
  }
});

test("true/false statements avoid the quiz's questions and are honest about their claim", () => {
  const quiz = pickQuiz(QUIZ, 5, "day");
  const statements = buildTrueFalse(QUIZ, 3, "day", new Set(quiz.map((question) => question.id)));

  assert.equal(statements.length, 3);

  for (const statement of statements) {
    assert.ok(!quiz.some((question) => question.id === statement.id));
    assert.equal(statement.isTrue, statement.claim === "right");
    assert.equal(statement.correctAnswer, "right");
  }
});

test("written questions prefer the most important material", () => {
  const picked = pickWritten(
    [
      { id: "low", importance: 1 },
      { id: "high", importance: 5 },
      { id: "mid", importance: 3 },
    ],
    2,
    "s",
  );

  assert.deepEqual(picked.map((question) => question.id), ["high", "mid"]);
});

test("a mock exam covers every note before repeating one", () => {
  const pools = new Map([
    ["a", [{ lectureId: "a", id: 1 }, { lectureId: "a", id: 2 }, { lectureId: "a", id: 3 }]],
    ["b", [{ lectureId: "b", id: 4 }]],
    ["c", [{ lectureId: "c", id: 5 }, { lectureId: "c", id: 6 }]],
  ]);

  assert.deepEqual(
    spreadAcrossModules(pools, ["c", "a", "b"], 5).map((item) => item.id),
    [5, 1, 4, 6, 2],
  );
  assert.deepEqual(mockQuestionCounts(90), { choice: 15, written: 6 });
  assert.deepEqual(mockQuestionCounts(30), { choice: 5, written: 2 });
});

test("a mock result names its strengths, weak points and weakest note", () => {
  const summary = summarizeMock([
    { questionId: "1", lectureId: "a", kind: "choice", score: 1, maxScore: 1, strengths: "", missingPoints: "" },
    { questionId: "2", lectureId: "a", kind: "written", score: 5, maxScore: 5, strengths: "Clear MR = MC.", missingPoints: "" },
    { questionId: "3", lectureId: "b", kind: "written", score: 1, maxScore: 5, strengths: "", missingPoints: "No deadweight loss." },
  ]);

  assert.equal(summary.totalScore, 7);
  assert.equal(summary.maxScore, 11);
  assert.deepEqual(summary.strengths, ["Clear MR = MC."]);
  assert.deepEqual(summary.weakPoints, ["No deadweight loss."]);
  assert.equal(summary.weakestLectureId, "b");
});
