import assert from "node:assert/strict";
import test from "node:test";

import {
  EXAM_LESSON_KINDS,
  LESSON_PASS_CAP,
  MAX_FAILED_TRIES_PER_DAY,
  PRACTICE_LESSON_KINDS,
  dayKey,
  examModuleStates,
  examNextStep,
  examStage,
  gradeForPercentage,
  lessonPassThreshold,
  lessonPassed,
  mockPassed,
  passThreshold,
  percent,
  summarizeMock,
  tutorStepPoints,
  wholePercent,
} from "../src/lib/exams/exam-model.ts";

/*
 * The study plan, run as a learner would live it: a fake clock, a few lessons a day, each result
 * fed back into the model, scores stored as `real` (Math.fround) the way Postgres keeps them.
 */
const DAY = 86_400_000;
const START = Date.parse("2026-10-01T06:00:00Z"); // 08:00 in Ljubljana

function simulate({ topics = 8, days = 21, perDay = 5, target = 0.9, score, mockScore = 1 }) {
  const modules = Array.from({ length: topics }, (_, index) => ({ topicId: `t${index + 1}`, lectureId: `n${index + 1}` }));
  const results = [];
  const log = [];
  let mock = null;

  for (let day = 0; day < days; day += 1) {
    for (let slot = 0; slot < perDay; slot += 1) {
      const now = new Date(START + day * DAY + slot * 20 * 60_000);
      const states = examModuleStates(modules, results, target, mock, now);
      const stage = examStage(states, mock, target);
      const next = examNextStep(states, stage);

      if (!next) {
        break;
      }

      if (next.type === "mock") {
        mock = {
          at: now.toISOString(),
          percentage: mockScore * 100,
          byLecture: Object.fromEntries(modules.map((module) => [module.lectureId, mockScore])),
        };
        log.push({ day, type: "mock", stage });
        continue;
      }

      const tries = results.filter((entry) => entry.topic_id === next.topicId && entry.lesson_kind === next.kind).length;
      const value = Math.fround(next.kind === "summary" ? 1 : score(next.kind, next.topicId, tries));
      results.push({
        lecture_id: next.lectureId,
        topic_id: next.topicId,
        lesson_kind: next.kind,
        score: value,
        completed_at: now.toISOString(),
      });
      log.push({ day, stage, ...next, score: value });
    }
  }

  const end = new Date(START + days * DAY);
  const states = examModuleStates(modules, results, target, mock, end);

  return { modules, results, log, mock, states, stage: examStage(states, mock, target), end };
}

const ONE_SLIP = tutorStepPoints(["correct"]) * 2 + tutorStepPoints(["wrong", "correct"]); // 2.5 of 3

test("a perfect learner with 8 topics in 21 days learns every topic, then proves it", () => {
  const run = simulate({ score: () => 1 });

  assert.ok(run.states.every((state) => state.learned), "every module learned");
  assert.equal(run.stage, "ready");

  // Nothing is repeated or refreshed before the last module's first lesson.
  const lastStart = run.log.findIndex((entry) => entry.topicId === "t8");
  assert.ok(lastStart > 0);
  assert.equal(run.log.slice(0, lastStart).filter((entry) => entry.review).length, 0);
  // 48 first passes take under ten days at five a day, and the mock comes right after.
  assert.ok(run.log.findIndex((entry) => entry.type === "mock") === 48);
});

test("a learner who scores exactly 90 % (one slip on the tutor) learns all 8 and is ready at a 90 % target", () => {
  const run = simulate({ score: (kind) => (kind === "tutor" ? ONE_SLIP / 3 : 0.9), mockScore: 0.9 });

  assert.ok(run.states.every((state) => state.learned));
  assert.ok(run.states.every((state) => state.mastered), "0.9 stored as real still passes a 90 % mark");
  assert.equal(run.stage, "ready");
});

test("a learner who plateaus on two lessons still reaches every module, and is not drilled all day", () => {
  // Two slips on the tutor every time (75 %) and 80 % on every written answer, against 90 %.
  const run = simulate({ score: (kind) => (kind === "tutor" ? 0.75 : kind === "written" ? 0.8 : 1) });

  assert.ok(run.states.every((state) => state.learned), "every module learned");
  assert.ok(run.states.every((state) => state.unlocked));
  assert.equal(run.stage, "practise");

  // The last module's first pass comes before any repeat at all.
  const lastLearned = run.log.findLastIndex((entry) => entry.review === false);
  assert.equal(run.log.slice(0, lastLearned).filter((entry) => entry.review).length, 0);

  // No lesson is failed more than the daily cap on one day while other work exists.
  const perDay = new Map();
  for (const entry of run.log.filter((item) => item.review)) {
    const key = `${entry.day}:${entry.topicId}:${entry.kind}`;
    perDay.set(key, (perDay.get(key) ?? 0) + 1);
  }
  assert.ok(Math.max(...perDay.values()) <= MAX_FAILED_TRIES_PER_DAY);
});

test("the reviewer's tutor plateau (83 %) is a pass at 85, 90 and 100 % targets", () => {
  for (const target of [0.85, 0.9, 1]) {
    const run = simulate({ target, score: (kind) => (kind === "tutor" ? ONE_SLIP / 3 : 1), mockScore: 0.96 });

    assert.ok(run.states.every((state) => state.mastered), `mastered at ${target}`);
    assert.equal(run.stage, "ready", `ready at ${target}`);
  }
});

test("at a 100 % target, fading never takes 'ready' away again", () => {
  const run = simulate({ target: 1, topics: 2, days: 3, score: (kind) => (kind === "tutor" ? ONE_SLIP / 3 : 1), mockScore: 0.96 });
  assert.equal(run.stage, "ready");

  // Three weeks later every lesson has faded to its floor: due for a refresh, still mastered.
  const later = new Date(run.end.getTime() + 21 * DAY);
  const states = examModuleStates(run.modules, run.results, 1, run.mock, later);
  const stage = examStage(states, run.mock, 1);

  assert.equal(stage, "ready");
  assert.ok(states.every((state) => state.mastered && state.refresh.length === PRACTICE_LESSON_KINDS.length));
  assert.equal(examNextStep(states, stage)?.type, "lesson");

  // And a refreshed lesson passes again, so the pass marks are reachable after any amount of fading.
  for (const kind of PRACTICE_LESSON_KINDS) {
    assert.ok(lessonPassed(kind, kind === "tutor" ? Math.fround(ONE_SLIP / 3) : 1, 1), kind);
  }
});

test("pass marks: capped at 95 %, the tutor at what one slip leaves", () => {
  assert.equal(passThreshold(1), LESSON_PASS_CAP);
  assert.equal(passThreshold(0.75), 0.75);
  assert.equal(passThreshold(Number.NaN), LESSON_PASS_CAP);
  assert.equal(lessonPassThreshold("quiz", 1), 0.95);
  assert.equal(lessonPassThreshold("tutor", 0.75), 0.75);
  assert.ok(Math.abs(lessonPassThreshold("tutor", 0.9) - 2.5 / 3) < 1e-12);
  assert.equal(lessonPassThreshold("summary", 1), 0);

  // A 9/10 quiz read back from a `real` column passes a 90 % mark; 89.6 % does not.
  assert.equal(lessonPassed("quiz", Math.fround(0.9), 0.9), true);
  assert.equal(lessonPassed("quiz", 0.896, 0.9), false);
  // Two slips on the tutor do not pass 85 %.
  assert.equal(lessonPassed("tutor", 0.75, 0.85), false);
  assert.equal(mockPassed(90, 0.9), true);
  assert.equal(mockPassed(89.6, 0.9), false);
  assert.equal(mockPassed(96, 1), true);
  assert.equal(mockPassed(Number.NaN, 0.5), false);
});

const result = (topic, lesson_kind, score, completed_at = "2026-10-14T10:00:00Z") => ({
  lecture_id: topic,
  topic_id: topic,
  lesson_kind,
  score,
  completed_at,
});
const learned = (topic, scores = {}, at = "2026-10-14T10:00:00Z") =>
  EXAM_LESSON_KINDS.map((kind) => result(topic, kind, scores[kind] ?? 1, at));
const mods = (...ids) => ids.map((id) => ({ topicId: id, lectureId: id }));

test("an untried module comes before repeats of an earlier one", () => {
  const states = examModuleStates(mods("a", "b"), learned("a", { quiz: 0.4 }), 0.9);

  assert.deepEqual(states[0].review, ["quiz"]);
  assert.deepEqual(examNextStep(states, examStage(states, null, 0.9)), {
    type: "lesson",
    topicId: "b",
    lectureId: "b",
    kind: "summary",
    review: false,
  });
});

test("a lesson failed twice today rests, and the next weakest is offered instead", () => {
  const now = new Date("2026-10-15T15:00:00Z");
  const results = [
    ...learned("a", { quiz: 0.6 }),
    result("a", "written", 0.4, "2026-10-15T09:00:00Z"),
    result("a", "written", 0.4, "2026-10-15T10:00:00Z"),
  ];
  const states = examModuleStates(mods("a"), results, 0.9, null, now);

  assert.equal(states[0].failedToday.written, 2);
  assert.deepEqual(states[0].review, ["written", "quiz"]);
  assert.equal(states[0].nextKind, "quiz");
  assert.equal(examNextStep(states, "practise")?.kind, "quiz");

  // Tomorrow it is back, weakest first.
  const tomorrow = examModuleStates(mods("a"), results, 0.9, null, new Date("2026-10-16T08:00:00Z"));
  assert.equal(examNextStep(tomorrow, "practise")?.kind, "written");

  // With nothing else left, the resting lesson is still offered rather than nothing.
  const only = examModuleStates(
    mods("a"),
    [...learned("a"), ...results.slice(-2)],
    0.9,
    null,
    now,
  );
  assert.equal(examNextStep(only, "practise")?.kind, "written");
});

test("modules that cannot be opened, are not ready or are placeholders are skipped and do not lock the rest", () => {
  const states = examModuleStates(mods("a", "b", "c"), learned("a"), 0.9);
  // Without knowing about b, the model keeps c locked behind it.
  assert.equal(states[2].unlocked, false);

  const view = (overrides) => states.map((state, index) => ({ ...state, ready: true, pending: false, ...overrides[index] }));
  const expectC = { type: "lesson", topicId: "c", lectureId: "c", kind: "summary", review: false };

  assert.deepEqual(examNextStep(states, "learn", (lectureId) => lectureId !== "b"), expectC);
  assert.deepEqual(examNextStep(view({ 1: { ready: false } }), "learn"), expectC);
  assert.deepEqual(examNextStep(view({ 1: { pending: true } }), "learn"), expectC);

  // Told that b is unavailable, the model unlocks c itself.
  const told = examModuleStates(
    [{ topicId: "a", lectureId: "a" }, { topicId: "b", lectureId: "b", available: false }, { topicId: "c", lectureId: "c" }],
    learned("a"),
    0.9,
  );
  assert.deepEqual(told.map((state) => state.unlocked), [true, true, true]);

  // Nothing openable at all: no step, rather than a placeholder with no stations.
  assert.equal(examNextStep(view({ 0: { pending: true }, 1: { pending: true }, 2: { ready: false } }), "learn"), null);
});

test("an exam with no modules is still learning and has no next step", () => {
  assert.equal(examStage([], null, 0.9), "learn");
  assert.equal(examStage([], { at: "2026-10-14T10:00:00Z", percentage: 100, byLecture: {} }, 0.9), "learn");
  assert.equal(examNextStep([], "learn"), null);
  assert.equal(examNextStep([], "prove"), null);
});

test("a percentage shown beside the target is floored, so 89.6 never reads as a 90 % pass", () => {
  assert.equal(percent(0.896), 89);
  assert.equal(percent(Math.fround(0.9)), 90);
  assert.equal(percent(1), 100);
  assert.equal(wholePercent(89.6), 89);
  assert.equal(wholePercent(Math.fround(0.9) * 100), 90);
  assert.equal(wholePercent(Number.NaN), 0);
  assert.equal(gradeForPercentage("percent", 89.6, 50), "89 %");
  assert.equal(gradeForPercentage("percent", 90, 50), "90 %");
});

test("grades, mock summaries and proof times survive bad numbers and mixed timestamps", () => {
  assert.equal(gradeForPercentage("percent", Number.NaN, 50), "0 %");
  assert.equal(gradeForPercentage("uni_5_10", Number.NaN, 50), "5");
  assert.equal(gradeForPercentage("school_1_5", 80, Number.NaN), "4");

  const summary = summarizeMock([
    { questionId: "1", lectureId: "a", kind: "written", score: 0, maxScore: 0, strengths: "Nothing asked.", missingPoints: "Empty." },
    { questionId: "2", lectureId: "a", kind: "written", score: 5, maxScore: 5, strengths: "Full marks.", missingPoints: "" },
    { questionId: "3", lectureId: "b", kind: "written", score: 1, maxScore: 5, strengths: "", missingPoints: "Most of it." },
  ]);
  assert.deepEqual(summary.strengths, ["Full marks.", "Nothing asked."]);
  assert.deepEqual(summary.weakPoints, ["Empty.", "Most of it."]);

  // The mock was graded at 10:00 UTC (written with an offset); the quiz redone at 11:00 UTC is after
  // it, although "…T11:00:00Z" sorts before "…T12:00:00+02:00" as text.
  const failed = { at: "2026-10-16T12:00:00+02:00", percentage: 60, byLecture: { a: 0.5 } };
  const [state] = examModuleStates(
    mods("a"),
    [...learned("a"), result("a", "quiz", 1, "2026-10-16T11:00:00Z"), result("a", "written", 1, "2026-10-16T11:30:00Z")],
    0.9,
    failed,
  );
  assert.deepEqual(state.review, []);
  assert.equal(state.mastered, true);
  // Sanity: Ljubljana days still key the daily cap.
  assert.equal(dayKey("2026-10-16T22:30:00Z"), "2026-10-17");
});
