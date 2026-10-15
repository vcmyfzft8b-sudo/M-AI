import assert from "node:assert/strict";
import test from "node:test";

import {
  addDays,
  MAX_EXAM_MODULES,
  MAX_SETUP_UPLOADS,
  TARGET_MAX,
  TARGET_MIN,
  targetDialAngle,
  targetFromDialPoint,
  buildTrueFalse,
  dailyPlan,
  dayKey,
  daysBetween,
  examMastery,
  examModuleStates,
  examNextStep,
  examStage,
  gradeForPercentage,
  isValidDay,
  mockMinutes,
  mockQuestionCounts,
  monthGrid,
  pickFlashcards,
  pickQuiz,
  pickWritten,
  seededShuffle,
  spreadAcrossModules,
  streakDays,
  summarizeMock,
  fadedScore,
  needsFreshItems,
  preferUnseen,
  tutorStepPoints,
} from "../src/lib/exams/exam-model.ts";

// In these tests each note has one topic, named after it.
const result = (lecture_id, lesson_kind, score, completed_at = "2026-10-14T10:00:00Z") => ({
  lecture_id,
  topic_id: lecture_id,
  lesson_kind,
  score,
  completed_at,
});

const mods = (...ids) => ids.map((id) => ({ topicId: id, lectureId: id }));

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
  const states = examModuleStates(mods("a"),
    [result("a", "summary", 1), result("a", "flashcards", 1), result("a", "quiz", 0.6)],
  );

  assert.equal(states[0].lessonsDone, 3);
  assert.equal(states[0].learned, false);
  assert.equal(states[0].mastered, false);
  // Weighted: flashcards count half (the learner grades them), the other four lessons in full.
  assert.equal(states[0].mastery, (0.5 * 1 + 0.6) / 4.5);
  // The tutor comes straight after the summary.
  assert.equal(states[0].nextKind, "tutor");
});

test("only the latest try of a lesson counts toward mastery", () => {
  const states = examModuleStates(mods("a"),
    [
      result("a", "quiz", 0.2, "2026-10-12T10:00:00Z"),
      result("a", "quiz", 0.8, "2026-10-14T10:00:00Z"),
    ],
  );

  assert.equal(states[0].latest.quiz, 0.8);
});

test("modules unlock in order, and starting a locked one opens it", () => {
  const all = ["summary", "tutor", "flashcards", "quiz", "true_false", "written"].map((kind) =>
    result("a", kind, 1),
  );
  const states = examModuleStates(mods("a", "b", "c", "d"), [...all, result("d", "quiz", 0.9)]);

  assert.deepEqual(
    states.map((state) => state.unlocked),
    [true, true, false, true],
  );
  assert.equal(states[0].learned, true);
  assert.equal(states[0].mastered, true);
  // A mastered module continues with its weakest practice lesson.
  assert.ok(["tutor", "flashcards", "quiz", "true_false", "written"].includes(states[0].nextKind));
  assert.equal(examMastery(states), (1 + 0 + 0 + 0.9 / 4.5) / 4);
});

test("the daily goal spreads what is left over the days before the exam", () => {
  const plan = dailyPlan({
    examDate: "2026-10-26",
    today: "2026-10-14",
    dailyMinutes: 30,
    states: [{ lessonsDone: 0, review: [] }, { lessonsDone: 0, review: [] }, { lessonsDone: 0, review: [] }, { lessonsDone: 0, review: [] }],
    resultsToday: 0,
    untriedDoneToday: 0,
  });

  // 24 lessons over 12 days is 2 a day, but 30 minutes buys 5.
  assert.equal(plan.goal, 5);
  assert.equal(plan.daysLeft, 12);
  assert.equal(plan.remaining, 24);
});

test("finishing a lesson moves today's count, not today's goal", () => {
  const before = dailyPlan({
    examDate: "2026-10-16",
    today: "2026-10-14",
    dailyMinutes: 15,
    states: [{ lessonsDone: 0, review: [] }, { lessonsDone: 0, review: [] }],
    resultsToday: 0,
    untriedDoneToday: 0,
  });
  const after = dailyPlan({
    examDate: "2026-10-16",
    today: "2026-10-14",
    dailyMinutes: 15,
    states: [{ lessonsDone: 1, review: [] }, { lessonsDone: 0, review: [] }],
    resultsToday: 1,
    untriedDoneToday: 1,
  });

  // 12 lessons over 2 days.
  assert.equal(before.goal, 6);
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
  assert.deepEqual(mockQuestionCounts(45), { choice: 14, written: 4 });
  assert.deepEqual(mockQuestionCounts(90), { choice: 28, written: 8 });
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

test("the target dial maps a drag to steps of five and never wraps through its gap", () => {
  assert.equal(targetDialAngle(TARGET_MIN), -135);
  assert.equal(targetDialAngle(TARGET_MAX), 135);
  assert.equal(targetDialAngle(75), 0);

  // Straight up is the middle of the gauge; a quarter turn either way is 91.7 % and 58.3 %.
  assert.equal(targetFromDialPoint(0, -50, 90), 75);
  assert.equal(targetFromDialPoint(50, 0, 50), 90);
  assert.equal(targetFromDialPoint(-50, 0, 50), 60);

  // Just inside each end.
  assert.equal(targetFromDialPoint(Math.sin((134 * Math.PI) / 180) * 50, -Math.cos((134 * Math.PI) / 180) * 50, 50), 100);
  assert.equal(targetFromDialPoint(-Math.sin((134 * Math.PI) / 180) * 50, -Math.cos((134 * Math.PI) / 180) * 50, 100), 50);

  // Straight down is the gap: the dial holds the end the finger came from.
  assert.equal(targetFromDialPoint(0, 50, 95), TARGET_MAX);
  assert.equal(targetFromDialPoint(0, 50, 60), TARGET_MIN);
  assert.equal(targetFromDialPoint(0, 0, 80), 80);
});

test("setup limits stay inside what the server accepts", () => {
  // The setup stops new uploads at the note routes' smallest burst (8 per 10 minutes).
  assert.equal(MAX_SETUP_UPLOADS, 8);
  assert.ok(MAX_SETUP_UPLOADS <= MAX_EXAM_MODULES);
});

// Every lesson done once; the tutor at full marks unless a test says otherwise.
const learnedModule = (lectureId, scores, at = "2026-10-14T10:00:00Z") => [
  result(lectureId, "summary", 1, at),
  ...Object.entries({ tutor: 1, ...scores }).map(([kind, score]) => result(lectureId, kind, score, at)),
];

test("a learned module repeats every practice lesson under the target until it reaches it", () => {
  const [state] = examModuleStates(mods("a"),
    learnedModule("a", { flashcards: 1, quiz: 0.6, true_false: 0.95, written: 0.4 }),
    0.9,
  );

  assert.equal(state.learned, true);
  assert.equal(state.mastered, false);
  // Weakest first: the written answer, then the quiz.
  assert.deepEqual(state.review, ["written", "quiz"]);
  assert.equal(state.nextKind, "written");

  const [after] = examModuleStates(mods("a"),
    [
      ...learnedModule("a", { flashcards: 1, quiz: 0.6, true_false: 0.95, written: 0.4 }),
      result("a", "written", 0.9, "2026-10-15T10:00:00Z"),
      result("a", "quiz", 1, "2026-10-15T11:00:00Z"),
    ],
    0.9,
  );

  assert.deepEqual(after.review, []);
  assert.equal(after.mastered, true);
});

test("nothing is repeated before the first pass through a module is over", () => {
  const [state] = examModuleStates(mods("a"), [result("a", "summary", 1), result("a", "quiz", 0.2)], 0.9);

  assert.deepEqual(state.review, []);
  assert.equal(state.nextKind, "tutor");
});

test("the next module unlocks once the one before it is learned, not only mastered", () => {
  const states = examModuleStates(mods("a", "b"), learnedModule("a", { flashcards: 0.5, quiz: 0.5, true_false: 0.5, written: 0.5 }), 0.9);

  assert.equal(states[0].mastered, false);
  assert.equal(states[1].unlocked, true);
});

test("the exam moves from learn to practise to prove to ready", () => {
  const all = { flashcards: 1, quiz: 1, true_false: 1, written: 1 };
  const weak = { flashcards: 1, quiz: 0.5, true_false: 1, written: 1 };
  const passed = { at: "2026-10-16T10:00:00Z", percentage: 92, byLecture: { a: 0.95, b: 0.9 } };

  const learning = examModuleStates(mods("a", "b"), learnedModule("a", all), 0.9);
  assert.equal(examStage(learning, null, 0.9), "learn");
  assert.deepEqual(examNextStep(learning, "learn"), { type: "lesson", topicId: "b", lectureId: "b", kind: "summary", review: false });

  const practising = examModuleStates(mods("a", "b"), [...learnedModule("a", all), ...learnedModule("b", weak)], 0.9);
  assert.equal(examStage(practising, null, 0.9), "practise");
  assert.deepEqual(examNextStep(practising, "practise"), { type: "lesson", topicId: "b", lectureId: "b", kind: "quiz", review: true });

  const proving = examModuleStates(mods("a", "b"), [...learnedModule("a", all), ...learnedModule("b", all)], 0.9);
  assert.equal(examStage(proving, null, 0.9), "prove");
  assert.deepEqual(examNextStep(proving, "prove"), { type: "mock" });

  const ready = examModuleStates(mods("a", "b"), [...learnedModule("a", all), ...learnedModule("b", all)], 0.9, passed);
  assert.equal(examStage(ready, passed, 0.9), "ready");
  // Ready still gets a lesson: the weakest one, to keep it fresh.
  assert.equal(examNextStep(ready, "ready")?.type, "lesson");
});

test("a mock under the target sends its weak modules back to prove themselves", () => {
  const all = { flashcards: 1, quiz: 1, true_false: 1, written: 1 };
  const failed = { at: "2026-10-16T10:00:00Z", percentage: 70, byLecture: { a: 0.95, b: 0.5 } };
  const results = [...learnedModule("a", all), ...learnedModule("b", all)];
  const states = examModuleStates(mods("a", "b"), results, 0.9, failed);

  // Module a did well in the mock; module b has to pass its quiz and written answer again.
  assert.equal(states[0].mastered, true);
  assert.deepEqual([...states[1].review].sort(), ["quiz", "written"]);
  assert.equal(examStage(states, failed, 0.9), "practise");

  const redone = examModuleStates(mods("a", "b"),
    [...results, result("b", "quiz", 1, "2026-10-17T10:00:00Z"), result("b", "written", 0.9, "2026-10-17T11:00:00Z")],
    0.9,
    failed,
  );

  // Proven again, so the mock is next once more.
  assert.equal(examStage(redone, failed, 0.9), "prove");
});

test("the daily goal counts the repeats still owed", () => {
  const plan = dailyPlan({
    examDate: "2026-10-26",
    today: "2026-10-14",
    dailyMinutes: 30,
    states: [{ lessonsDone: 6, review: ["quiz", "written"] }],
    resultsToday: 0,
    untriedDoneToday: 0,
  });

  assert.equal(plan.remaining, 2);
});

test("modules are topics: two topics of one note progress separately", () => {
  const modules = [
    { topicId: "t1", lectureId: "note" },
    { topicId: "t2", lectureId: "note" },
  ];
  const states = examModuleStates(
    modules,
    [
      { lecture_id: "note", topic_id: "t1", lesson_kind: "summary", score: 1, completed_at: "2026-10-14T10:00:00Z" },
      // A result from before topics existed belongs to no module.
      { lecture_id: "note", topic_id: null, lesson_kind: "quiz", score: 1, completed_at: "2026-10-14T10:00:00Z" },
    ],
    0.9,
  );

  assert.equal(states[0].lessonsDone, 1);
  assert.equal(states[1].lessonsDone, 0);
  assert.equal(states[1].unlocked, false);
  assert.deepEqual(examNextStep(states, "learn"), {
    type: "lesson",
    topicId: "t1",
    lectureId: "note",
    kind: "tutor",
    review: false,
  });
});

test("a mock exam's questions fill the time it is set for", () => {
  for (let minutes = 10; minutes <= 120; minutes += 5) {
    const counts = mockQuestionCounts(minutes);
    assert.ok(Math.abs(mockMinutes(counts) - minutes) <= 1.5, `${minutes} min: ${JSON.stringify(counts)}`);
    assert.ok(counts.written >= 1 && counts.choice >= 3);
  }
});

test("passed lessons fade after a few days, so a topic comes back for review before the exam", () => {
  const all = { flashcards: 1, quiz: 1, true_false: 1, written: 1 };
  const results = learnedModule("a", all, "2026-10-01T10:00:00Z");

  // Three days on, nothing has faded and the topic is mastered.
  const fresh = examModuleStates(mods("a"), results, 0.85, null, new Date("2026-10-04T10:00:00Z"));
  assert.equal(fresh[0].mastered, true);
  assert.deepEqual(fresh[0].refresh, []);

  // Eight days on, a perfect score has faded to 80 %: under an 85 % target, every lesson is due.
  const later = examModuleStates(mods("a"), results, 0.85, null, new Date("2026-10-09T10:00:00Z"));
  assert.equal(later[0].mastered, false);
  assert.equal(later[0].latest.quiz, 0.8);
  assert.deepEqual([...later[0].refresh].sort(), ["flashcards", "quiz", "true_false", "tutor", "written"]);

  // Never below 60 % of the score, however long ago.
  assert.equal(fadedScore(1, "2026-01-01T00:00:00Z", new Date("2026-10-01T00:00:00Z")), 0.6);
  // Without a clock (as the tests above use it) nothing fades.
  assert.equal(fadedScore(0.9, "2026-01-01T00:00:00Z", null), 0.9);
});

test("a lesson redone for review counts again from the day it was redone", () => {
  const results = [
    ...learnedModule("a", { flashcards: 1, quiz: 1, true_false: 1, written: 1 }, "2026-10-01T10:00:00Z"),
    result("a", "quiz", 1, "2026-10-08T10:00:00Z"),
  ];
  const [state] = examModuleStates(mods("a"), results, 0.85, null, new Date("2026-10-09T10:00:00Z"));

  assert.equal(state.latest.quiz, 1);
  assert.ok(!state.review.includes("quiz"));
});

test("a repeat draws questions the learner has not seen, and asks for fresh ones when they run out", () => {
  const pool = ["q1", "q2", "q3", "q4", "q5", "q6", "q7", "q8"].map((id) => ({ id }));
  const seen = new Set(["q1", "q2", "q3", "q4", "q5"]);

  // Three unseen are short of a five-question quiz: all three, then two seen ones.
  const drawn = preferUnseen(pool, seen, 5, "seed");
  assert.equal(drawn.length, 5);
  assert.deepEqual(drawn.slice(0, 3).map((item) => item.id), ["q6", "q7", "q8"]);
  assert.equal(needsFreshItems(pool, seen, 5), true);

  // With enough unseen ones only those are used, and the first try never asks for more.
  assert.deepEqual(preferUnseen(pool, new Set(["q1"]), 5, "seed").map((item) => item.id), ["q2", "q3", "q4", "q5", "q6", "q7", "q8"]);
  assert.equal(needsFreshItems(pool, new Set(), 5), false);
});

test("the tutor marks a step by whether it was right at the first ask", () => {
  assert.equal(tutorStepPoints(["correct"]), 1);
  assert.equal(tutorStepPoints(["wrong", "correct"]), 0.5);
  assert.equal(tutorStepPoints(["partial", "partial"]), 0.25);
  assert.equal(tutorStepPoints(["wrong", "wrong"]), 0);
});
