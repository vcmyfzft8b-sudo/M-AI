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
  openGaps,
  gapLessonKind,
  gapsForLesson,
  withGapsFirst,
  examForecast,
  GAP_MAX_MISSES,
  MASTERY_RATE,
  lessonsToTarget,
  masteryAfterLesson,
  suggestedKind,
  topicMastery,
  topicsOnTarget,
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
  // Floored, like every percentage shown beside a target.
  assert.equal(gradeForPercentage("percent", 73.6, 50), "73 %");
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
  assert.equal(MAX_SETUP_UPLOADS, 10);
  assert.ok(MAX_SETUP_UPLOADS <= MAX_EXAM_MODULES);
});

test("a mock exam's questions fill the time it is set for", () => {
  for (let minutes = 10; minutes <= 120; minutes += 5) {
    const counts = mockQuestionCounts(minutes);
    assert.ok(Math.abs(mockMinutes(counts) - minutes) <= 1.5, `${minutes} min: ${JSON.stringify(counts)}`);
    assert.ok(counts.written >= 1 && counts.choice >= 3);
  }
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

test("a missed question stays an open gap until a later lesson gets it right", () => {
  const missed = shown("a", "quiz", 0.6, "2026-10-14T10:00:00Z", ["q1", "q2", "q3"], ["q2", "q3"]);
  assert.deepEqual(openGaps([missed]).map((gap) => gap.id), ["q2", "q3"]);

  // Asked again as a true/false statement and answered right: closed. q3 missed again: still open.
  const again = shown("a", "true_false", 0.5, "2026-10-15T10:00:00Z", ["q2", "q3"], ["q3"]);
  const gaps = openGaps([again, missed]);
  assert.deepEqual(gaps, [{ id: "q3", kind: "true_false", misses: 2 }]);

  // Flashcards and the tutor neither open nor close gaps.
  assert.deepEqual(openGaps([shown("a", "flashcards", 0.5, "2026-10-14T10:00:00Z", ["c1"], ["c1"])]), []);
});

test("a gap comes back the other way round, in a format the learner has done", () => {
  const done = { summary: true, tutor: false, flashcards: false, quiz: true, true_false: true, written: false };
  assert.equal(gapLessonKind([{ id: "q1", kind: "quiz", misses: 1 }], done), "true_false");
  assert.equal(gapLessonKind([{ id: "q1", kind: "true_false", misses: 1 }], done), "quiz");
  assert.equal(gapLessonKind([{ id: "q1", kind: "quiz", misses: 1 }], { ...done, true_false: false }), "quiz");
  assert.equal(gapLessonKind([{ id: "w1", kind: "written", misses: 1 }], done), "written");
  // One the learner keeps missing still comes back in lessons but no longer holds the path.
  assert.equal(gapLessonKind([{ id: "q1", kind: "quiz", misses: GAP_MAX_MISSES }], done), null);
  assert.deepEqual(gapsForLesson([{ id: "w1", kind: "written", misses: 1 }], "quiz"), []);
});

test("a lesson asks the gaps first and fills the rest with new questions", () => {
  const pool = ["q1", "q2", "q3", "q4", "q5", "q6", "q7", "q8"].map((id) => ({ id }));
  const gaps = ["q2", "q5", "q7", "q8"].map((id) => ({ id, kind: "quiz", misses: 1 }));
  const seen = new Set(["q1", "q2", "q5", "q7", "q8"]);
  const { items, repeated } = withGapsFirst(pool, gaps, seen, 5, "seed");

  // At most three of five are repeats; the rest are unseen.
  assert.deepEqual(repeated, ["q2", "q5", "q7"]);
  assert.equal(items.length, 5);
  assert.deepEqual(items.slice(0, 3).map((item) => item.id), ["q2", "q5", "q7"]);
  assert.ok(items.slice(3).every((item) => !seen.has(item.id)));
  assert.deepEqual(withGapsFirst(pool, [], seen, 5, "seed"), { items: [], repeated: [] });
});


/* ---------------------------------------------------------------- Astra's model */

const shown = (lecture_id, lesson_kind, score, completed_at, item_ids, missed_ids = []) => ({
  ...result(lecture_id, lesson_kind, score, completed_at),
  item_ids,
  missed_ids,
});

/* `count` lessons of `kind` scoring `score` on a topic, a minute apart from `start`. */
function lessons(topic, kind, score, count, start = "2026-10-14T08:00:00Z") {
  const t0 = Date.parse(start);
  return Array.from({ length: count }, (_, index) =>
    result(topic, kind, score, new Date(t0 + index * 60_000).toISOString()),
  );
}

test("mastery moves a step towards what each lesson showed, guesses taken out", () => {
  // Astra's measured step was 0.12 (0 → 5 → 15 → 23 % after 40, 100 and 71 %); ours is 0.2, chosen by
  // the simulated learners in exam-plan.test.mjs. The shape is the same: each lesson adds a step.
  assert.equal(MASTERY_RATE, 0.2);
  assert.ok(Math.abs(masteryAfterLesson(0, "written", 1) - 0.2) < 1e-9);
  assert.ok(Math.abs(masteryAfterLesson(0.2, "written", 1) - 0.36) < 1e-9);
  // A lucky guess is not knowledge: half right on true/false, a quarter on a quiz, is nothing known.
  assert.equal(masteryAfterLesson(0, "true_false", 0.5), 0);
  assert.equal(masteryAfterLesson(0, "quiz", 0.25), 0);
  assert.ok(Math.abs(masteryAfterLesson(0, "true_false", 0.8) - 0.2 * 0.6) < 1e-9);
  // A lesson read alone (no part to test) is saved with nothing to score and moves nothing; a lesson
  // with its parts (flashcards, quiz, written) counts like any other.
  assert.equal(topicMastery([{ ...result("a", "summary", 0), total: 0 }]).mastery, 0);
  assert.ok(topicMastery([{ ...result("a", "summary", 0.9), total: 14 }]).mastery > 0.15);
  // Flashcards move half as far.
  assert.ok(Math.abs(masteryAfterLesson(0, "flashcards", 1) - 0.1) < 1e-9);
});

test("a topic's mastery replays its lessons in order, and a learner at 70 % never reaches 75 %", () => {
  assert.equal(topicMastery([]).mastery, 0);
  const perfect = topicMastery(lessons("a", "quiz", 1, 7)).mastery;
  assert.ok(perfect >= 0.75 && perfect < 0.8, `seven perfect lessons reach 75 %: ${perfect}`);
  const steady = topicMastery(lessons("a", "quiz", 0.7, 60)).mastery;
  assert.ok(steady < 0.75, `mastery is accuracy, earned: ${steady}`);
  // Order matters: the newest lesson weighs most.
  const late = topicMastery([...lessons("a", "quiz", 0, 5), ...lessons("a", "quiz", 1, 5, "2026-10-15T08:00:00Z")]).mastery;
  const early = topicMastery([...lessons("a", "quiz", 1, 5), ...lessons("a", "quiz", 0, 5, "2026-10-15T08:00:00Z")]).mastery;
  assert.ok(late > early);
});

test("lessons to the target count the steps a good learner still needs", () => {
  // About nine a topic from nothing to 75 %, for a learner who gets 90 % right.
  assert.equal(lessonsToTarget(0, 0.75), 9);
  assert.equal(lessonsToTarget(0.8, 0.75), 0);
  assert.equal(lessonsToTarget(0.7, 0.75), 2);
  // A 100 % goal is held to the 95 % cap, and needs near-perfect lessons.
  assert.ok(lessonsToTarget(0, 1) > lessonsToTarget(0, 0.9));
});

test("the next format rotates: every format once, then round the practice ones; gaps come first", () => {
  const none = { summary: false, tutor: false, flashcards: false, quiz: false, true_false: false, written: false };
  const zero = { summary: 0, tutor: 0, flashcards: 0, quiz: 0, true_false: 0, written: 0 };
  assert.equal(suggestedKind({ done: none, lessons: 0, failedToday: zero, gapKind: null }), "summary");
  assert.equal(suggestedKind({ done: { ...none, summary: true }, lessons: 1, failedToday: zero, gapKind: null }), "tutor");
  assert.equal(
    suggestedKind({ done: { ...none, summary: true, tutor: true }, lessons: 2, failedToday: zero, gapKind: null }),
    "quiz",
  );
  const all = { summary: true, tutor: true, flashcards: true, quiz: true, true_false: true, written: true };
  assert.equal(suggestedKind({ done: all, lessons: 6, failedToday: zero, gapKind: null }), "written");
  assert.equal(suggestedKind({ done: all, lessons: 7, failedToday: zero, gapKind: null }), "true_false");
  assert.equal(suggestedKind({ done: all, lessons: 7, failedToday: zero, gapKind: "quiz" }), "quiz");
  // A format failed twice today rests: the rotation moves on.
  assert.equal(suggestedKind({ done: all, lessons: 7, failedToday: { ...zero, true_false: 2 }, gapKind: null }), "tutor");
});

test("topics open in order, only on target: no number of lessons under it opens the next", () => {
  const fresh = examModuleStates(mods("a", "b", "c"), [], 0.75);
  assert.deepEqual(fresh.map((state) => state.unlocked), [true, false, false]);

  for (const score of [0, 0.5, 0.7]) {
    const many = examModuleStates(mods("a", "b", "c"), lessons("a", "quiz", score, 30), 0.75);
    assert.equal(many[0].learned, false, `30 quizzes at ${score}`);
    assert.deepEqual(many.map((state) => state.unlocked), [true, false, false]);
    // The path stays on it, still owing it lessons.
    const stage = examStage(many, null, 0.75);
    assert.equal(examNextStep(many.map((state) => ({ ...state, ready: true })), stage)?.topicId, "a");
    assert.ok(lessonsToTarget(many[0].mastery, 0.75) > 0);
  }

  const onTarget = examModuleStates(mods("a", "b", "c"), lessons("a", "quiz", 1, lessonsToTarget(0, 0.75)), 0.75);
  assert.equal(onTarget[0].learned, true);
  assert.deepEqual(onTarget.map((state) => state.unlocked), [true, true, false]);

  const started = examModuleStates(mods("a", "b", "c"), lessons("c", "quiz", 1, 1), 0.75);
  assert.equal(started[2].unlocked, true);
  // Readiness counts every topic, started or not (Astra: 23 % on one of four topics is 6 %).
  assert.equal(Math.round(examMastery(started) * 100), 7);
  assert.equal(topicsOnTarget(started, 0.75), 0);
});

test("the path takes each topic to the target in order, then practises the weakest, then offers the mock", () => {
  const learning = examModuleStates(mods("a", "b"), [], 0.75);
  assert.deepEqual(examNextStep(learning, examStage(learning, null, 0.75)), {
    type: "lesson", topicId: "a", lectureId: "a", kind: "summary", review: false,
  });

  // Topic a has had four lessons under the target: the path stays on a, and b stays locked.
  const results = [result("a", "summary", 1, "2026-10-14T07:00:00Z"), ...lessons("a", "quiz", 0.6, 4)];
  const second = examModuleStates(mods("a", "b"), results, 0.75);
  assert.equal(examStage(second, null, 0.75), "learn");
  assert.equal(second[1].unlocked, false);
  assert.equal(examNextStep(second, "learn")?.topicId, "a");

  // Both reached the target once, and both have faded under it since: the weaker one is practised.
  const both = [...lessons("a", "quiz", 1, 14, "2026-10-01T08:00:00Z"), ...lessons("b", "quiz", 1, 14, "2026-10-03T08:00:00Z")];
  const practising = examModuleStates(mods("a", "b"), both, 0.75, null, new Date("2026-10-14T12:00:00Z"));
  assert.ok(practising.every((state) => state.learned && !state.mastered));
  assert.equal(examStage(practising, null, 0.75), "practise");
  assert.equal(examNextStep(practising, "practise")?.topicId, "a");

  // Both on target: the mock exam, and passing it makes the learner ready.
  const strong = [...lessons("a", "quiz", 1, 14), ...lessons("b", "quiz", 1, 14, "2026-10-15T08:00:00Z")];
  const proving = examModuleStates(mods("a", "b"), strong, 0.75);
  assert.equal(examStage(proving, null, 0.75), "prove");
  assert.deepEqual(examNextStep(proving, "prove"), { type: "mock" });
  const passed = { at: "2026-10-16T10:00:00Z", percentage: 90, byLecture: { a: 0.9, b: 0.9 } };
  assert.equal(examStage(proving, passed, 0.75), "ready");
  assert.equal(examNextStep(examModuleStates(mods("a", "b"), strong, 0.75, passed), "ready")?.type, "lesson");
});

test("a mock under the target asks its weak topics for a lesson after it", () => {
  const strong = [...lessons("a", "quiz", 1, 14), ...lessons("b", "quiz", 1, 14, "2026-10-14T09:00:00Z")];
  const failed = { at: "2026-10-15T10:00:00Z", percentage: 50, byLecture: { a: 0.9, b: 0.3 } };
  const states = examModuleStates(mods("a", "b"), strong, 0.75, failed);
  assert.equal(states[1].proofOwed, true);
  assert.equal(states[1].mastered, false);
  assert.equal(examNextStep(states, examStage(states, failed, 0.75))?.topicId, "b");

  const proved = examModuleStates(mods("a", "b"), [...strong, result("b", "quiz", 1, "2026-10-15T11:00:00Z")], 0.75, failed);
  assert.equal(proved[1].proofOwed, false);
});

test("mastery fades after a few quiet days, and one lesson brings the topic back", () => {
  const strong = lessons("a", "quiz", 1, 14);
  const now = new Date("2026-10-24T08:00:00Z");
  const [faded] = examModuleStates(mods("a"), strong, 0.75, null, now);
  assert.equal(faded.mastered, false);
  assert.equal(faded.refreshDue, true);
  assert.ok(faded.rawMastery > faded.mastery);

  const [back] = examModuleStates(mods("a"), [...strong, result("a", "quiz", 1, "2026-10-24T07:00:00Z")], 0.75, null, now);
  assert.equal(back.mastered, true);
});

test("open gaps are practised before the mock exam is offered", () => {
  const results = [
    ...lessons("a", "true_false", 1, 7),
    ...lessons("a", "quiz", 1, 7, "2026-10-14T09:00:00Z"),
    shown("a", "quiz", 0.9, "2026-10-14T10:00:00Z", ["q1", "q2"], ["q2"]),
  ];
  const states = examModuleStates(mods("a"), results, 0.75);
  assert.equal(examStage(states, null, 0.75), "prove");
  assert.equal(states[0].pressingGaps, 1);
  // Missed in the quiz, asked again as true/false.
  assert.deepEqual(examNextStep(states, "prove"), { type: "lesson", topicId: "a", lectureId: "a", kind: "true_false", review: true });

  const closed = examModuleStates(mods("a"), [...results, shown("a", "true_false", 1, "2026-10-15T11:00:00Z", ["q2"])], 0.75);
  assert.deepEqual(examNextStep(closed, "prove"), { type: "mock" });
});

test("on the exam's eve each topic gets a flashcard refresher before the mock", () => {
  const now = new Date("2026-10-20T08:00:00Z");
  const strong = [...lessons("a", "quiz", 1, 14, "2026-10-19T08:00:00Z"), ...lessons("b", "quiz", 1, 14, "2026-10-19T09:00:00Z")];
  const states = examModuleStates(mods("a", "b"), strong, 0.75, null, now);
  assert.deepEqual(examNextStep(states, "prove"), { type: "mock" });
  assert.equal(examNextStep(states, "prove", undefined, { finalDay: true })?.kind, "flashcards");

  const refreshed = examModuleStates(
    mods("a", "b"),
    [...strong, result("a", "flashcards", 1, "2026-10-20T07:00:00Z"), result("b", "flashcards", 1, "2026-10-20T07:30:00Z")],
    0.75,
    null,
    now,
  );
  assert.deepEqual(examNextStep(refreshed, "prove", undefined, { finalDay: true }), { type: "mock" });
});

test("the daily plan spreads the lessons every topic still needs over the days left", () => {
  const base = { examDate: "2026-10-26", today: "2026-10-16", dailyMinutes: 6, target: 0.75, resultsToday: 0 };
  // Four fresh topics at 75 %: 9 lessons each, 36 over 10 days is 4 a day.
  const plan = dailyPlan({ ...base, states: [{ mastery: 0 }, { mastery: 0 }, { mastery: 0 }, { mastery: 0 }] });
  assert.equal(plan.remaining, 36);
  assert.equal(plan.goal, 4);
  assert.equal(plan.daysLeft, 10);
  // A topic's open gaps are one lesson more; a topic on target needs none.
  assert.equal(dailyPlan({ ...base, states: [{ mastery: 0.8, pressingGaps: 2 }] }).remaining, 1);
  assert.equal(dailyPlan({ ...base, states: [{ mastery: 0.8 }] }).remaining, 0);
});

test("the forecast is Astra's: gain per lesson, lessons still needed, a day, and where the pace lands", () => {
  const input = { target: 0.75, today: "2026-10-16", examDate: "2026-10-26" };

  assert.equal(examForecast({ ...input, mastery: 0.05, lessonDays: ["2026-10-16"] }), null);

  // Astra after three lessons: readiness 6 %, "+1.9 % per lesson ... about 37 more lessons, about 4 a day".
  const three = examForecast({ ...input, mastery: 0.0575, lessonDays: ["2026-10-16", "2026-10-16", "2026-10-16"] });
  assert.ok(Math.abs(three.perLesson - 0.0575 / 3) < 1e-9);
  assert.equal(three.lessonsNeeded, 37);
  assert.equal(three.perDay, 4);
  assert.equal(three.onTrack, false);
  assert.ok(three.atExam < 0.15);

  assert.equal(examForecast({ ...input, today: "2026-10-27", mastery: 0.5, lessonDays: ["2026-10-16", "2026-10-16"] }), null);
});

test("without talking time the path never suggests the tutor, and picks another exercise", () => {
  const none = { summary: false, tutor: false, flashcards: false, quiz: false, true_false: false, written: false };
  const zero = { summary: 0, tutor: 0, flashcards: 0, quiz: 0, true_false: 0, written: 0 };
  const read = { ...none, summary: true };

  // With time, the tutor is the second lesson of a topic; without it, the quiz is.
  assert.equal(suggestedKind({ done: read, lessons: 1, failedToday: zero, gapKind: null }), "tutor");
  assert.equal(suggestedKind({ done: read, lessons: 1, failedToday: zero, gapKind: null, tutor: false }), "quiz");

  // Round the practice formats, the tutor's turn goes to the next format.
  const all = { summary: true, tutor: true, flashcards: true, quiz: true, true_false: true, written: true };
  for (let lessons = 0; lessons < 20; lessons += 1) {
    assert.notEqual(suggestedKind({ done: all, lessons, failedToday: zero, gapKind: null, tutor: false }), "tutor");
  }

  // The same through the path: no topic's next lesson is the tutor.
  const states = examModuleStates(mods("a", "b"), [result("a", "summary", 0.8)], 0.75, null, null, { tutor: false });
  assert.ok(states.every((state) => state.nextKind !== "tutor"));
});
