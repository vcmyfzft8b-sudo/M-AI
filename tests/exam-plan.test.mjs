import assert from "node:assert/strict";
import test from "node:test";

import {
  EXAM_LESSON_KINDS,
  LESSON_PASS_CAP,
  LESSONS_TO_OPEN_NEXT,
  MAX_FAILED_TRIES_PER_DAY,
  lessonsToTarget,
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
 * `pick` is the learner choosing a lesson format other than the one the path suggests.
 */
const DAY = 86_400_000;
const START = Date.parse("2026-10-01T06:00:00Z"); // 08:00 in Ljubljana

function simulate({ topics = 8, days = 21, perDay = 5, target = 0.9, score, mockScore = 1, pick = null }) {
  const modules = Array.from({ length: topics }, (_, index) => ({ topicId: `t${index + 1}`, lectureId: `n${index + 1}` }));
  const results = [];
  const log = [];
  let mock = null;

  for (let day = 0; day < days; day += 1) {
    for (let slot = 0; slot < perDay; slot += 1) {
      const now = new Date(START + day * DAY + slot * 20 * 60_000);
      const states = examModuleStates(modules, results, target, mock, now);
      const stage = examStage(states, mock, target);
      const suggested = examNextStep(states, stage);

      if (!suggested) {
        break;
      }

      const next =
        pick && suggested.type === "lesson"
          ? { ...suggested, kind: pick(suggested, states.find((state) => state.topicId === suggested.topicId)) }
          : suggested;

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

test("a perfect learner with 4 topics in 14 days learns every topic, brings each to the goal, then proves it", () => {
  const run = simulate({ topics: 4, days: 14, perDay: 6, target: 0.75, score: () => 1 });

  assert.ok(run.states.every((state) => state.learned), "every topic learned");
  assert.equal(run.stage, "ready");

  // Every topic is started before any topic is practised past its first four lessons.
  const lastStart = run.log.findIndex((entry) => entry.topicId === "t4");
  assert.ok(lastStart > 0);
  const before = run.log.slice(0, lastStart).filter((entry) => entry.topicId === "t1").length;
  assert.ok(before <= 1 + LESSONS_TO_OPEN_NEXT + 1, `t1 had ${before} lessons before t4 started`);

  // About what the plan promised: every topic from 0 to 75 %, a lesson at a time.
  const mockAt = run.log.findIndex((entry) => entry.type === "mock");
  assert.ok(mockAt > 4 * 6 && mockAt < 4 * (lessonsToTarget(0, 0.75) + 6), `mock after ${mockAt} lessons`);
});

test("a learner who gets 70 % right never reaches a 75 % goal, but reaches every topic and is not drilled", () => {
  const run = simulate({ topics: 6, days: 14, perDay: 6, target: 0.75, score: () => 0.7 });

  assert.ok(run.states.every((state) => state.unlocked && state.learned), "every topic reached");
  assert.ok(run.states.every((state) => !state.mastered));
  assert.equal(run.stage, "practise");
  assert.ok(run.log.every((entry) => entry.type !== "mock"));

  // No format is failed more than the daily cap on one topic and day while other work exists.
  const perDay = new Map();
  for (const entry of run.log.filter((item) => item.type !== "mock" && item.kind !== "summary")) {
    const key = `${entry.day}:${entry.topicId}:${entry.kind}`;
    perDay.set(key, (perDay.get(key) ?? 0) + 1);
  }
  assert.ok(Math.max(...perDay.values()) <= MAX_FAILED_TRIES_PER_DAY + 1);
});

test("at a 100 % goal the learner is held to 95 % and still gets there with near-perfect lessons", () => {
  const run = simulate({ topics: 2, days: 14, perDay: 8, target: 1, score: () => 1, mockScore: 0.96 });

  assert.ok(run.states.every((state) => state.mastered));
  assert.equal(run.stage, "ready");
  for (const kind of EXAM_LESSON_KINDS.filter((entry) => entry !== "summary")) {
    assert.ok(lessonPassed(kind, kind === "tutor" ? Math.fround(ONE_SLIP / 3) : 1, 1), kind);
  }
});

test("a learner who swaps every lesson for flashcards and quizzes still reaches the goal, never meeting the tutor", () => {
  const CHOSEN = ["flashcards", "quiz"];
  const run = simulate({
    topics: 3,
    days: 14,
    perDay: 6,
    target: 0.75,
    score: () => 1,
    pick: (next) => (next.kind === "summary" || CHOSEN.includes(next.kind) ? next.kind : "quiz"),
  });

  assert.ok(run.states.every((state) => state.mastered), "every topic on target");
  assert.equal(run.stage, "ready");
  assert.ok(run.states.every((state) => !state.done.tutor));
});

test("weeks after being ready, faded topics come back as lessons and one lesson restores each", () => {
  const run = simulate({ topics: 2, days: 10, perDay: 8, target: 0.75, score: () => 1 });
  assert.equal(run.stage, "ready");

  const later = new Date(run.end.getTime() + 14 * DAY);
  const states = examModuleStates(run.modules, run.results, 0.75, run.mock, later);
  assert.ok(states.every((state) => state.refreshDue && !state.mastered));
  const stage = examStage(states, run.mock, 0.75);
  assert.equal(stage, "practise");
  assert.equal(examNextStep(states, stage)?.type, "lesson");
});

test("a topic whose suggested lesson failed twice today rests while another topic has work", () => {
  const now = new Date("2026-10-15T15:00:00Z");
  const results = [
    ...learned("a", 0.4),
    ...learned("b", 0.4),
    result("a", "summary", 1, "2026-10-15T08:00:00Z"),
  ];
  const states = examModuleStates(mods("a", "b"), results, 0.9, null, now);
  const kind = states[0].nextKind;
  const failedTwice = [...results, result("a", kind, 0.2, "2026-10-15T09:00:00Z"), result("a", kind, 0.2, "2026-10-15T10:00:00Z")];
  const resting = examModuleStates(mods("a", "b"), failedTwice, 0.9, null, now);

  assert.equal(resting[0].failedToday[kind], 2);
  assert.notEqual(resting[0].nextKind, kind, "the rotation moves on from a format failed twice today");
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
/* A topic far enough along to open the next one: its summary and `LESSONS_TO_OPEN_NEXT` quizzes. */
const learned = (topic, score = 1, at = "2026-10-14T10:00:00Z") => [
  result(topic, "summary", 1, at),
  ...Array.from({ length: LESSONS_TO_OPEN_NEXT }, () => result(topic, "quiz", score, at)),
];
const mods = (...ids) => ids.map((id) => ({ topicId: id, lectureId: id }));

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
    [...learned("a"), result("a", "quiz", 1, "2026-10-16T11:00:00Z")],
    0.9,
    failed,
  );
  assert.equal(state.proofOwed, false);
  // Sanity: Ljubljana days still key the daily cap.
  assert.equal(dayKey("2026-10-16T22:30:00Z"), "2026-10-17");
});

/* ---------------------------------------------------------------- learners with hidden knowledge */

/*
 * The question that matters: when the prep says a learner is ready, do they know the material at
 * their goal? Each simulated learner has a true knowledge per topic, unknown to the model: it starts
 * low, grows with every lesson on the topic and fades on days the topic is not studied. Answers
 * follow it (a quiz is right by luck a quarter of the time, true/false half, flashcards are graded a
 * little generously), the mock exam is mostly written. The plan drives them, eight lessons a day.
 */
function seeded(seed) {
  let state = seed >>> 0;
  return () => (state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}

const GUESS = { quiz: 0.25, true_false: 0.5, written: 0, tutor: 0, flashcards: 0, summary: 0 };
const ITEMS = { quiz: 5, true_false: 5, written: 1, tutor: 3, flashcards: 8, summary: 0 };

function hiddenKnowledge({ topics, days, target, start, learn, seed, perDay = 8 }) {
  const random = seeded(seed);
  const modules = Array.from({ length: topics }, (_, index) => ({ topicId: `t${index}`, lectureId: `n${index}` }));
  const known = modules.map(() => Math.max(0.05, start + (random() - 0.5) * 0.2));
  const studied = modules.map(() => START);
  const results = [];
  let mock = null;
  let readyKnown = null;

  for (let day = 0; day < days; day += 1) {
    known.forEach((value, index) => {
      if ((START + day * DAY - studied[index]) / DAY > 1) known[index] = value * 0.98;
    });

    for (let slot = 0; slot < perDay; slot += 1) {
      const now = new Date(START + day * DAY + slot * 25 * 60_000);
      const states = examModuleStates(modules, results, target, mock, now);
      const stage = examStage(states, mock, target);

      if (stage === "ready" && readyKnown === null) {
        readyKnown = [...known];
      }

      const next = examNextStep(states, stage, () => true, { finalDay: days - day <= 1 });

      if (!next) {
        break;
      }

      if (next.type === "mock") {
        const byLecture = Object.fromEntries(
          modules.map((module, index) => [module.lectureId, (2 * known[index] + known[index] + (1 - known[index]) * 0.25) / 3]),
        );
        const percentage = (Object.values(byLecture).reduce((sum, value) => sum + value, 0) / topics) * 100;
        mock = { at: now.toISOString(), percentage, byLecture };
        continue;
      }

      const index = modules.findIndex((module) => module.topicId === next.topicId);
      let score = 1;

      if (next.kind !== "summary") {
        const chance = next.kind === "flashcards" ? Math.min(1, known[index] + 0.1) : known[index] + (1 - known[index]) * GUESS[next.kind];
        let right = 0;
        for (let item = 0; item < ITEMS[next.kind]; item += 1) {
          if (random() < chance) right += 1;
        }
        score = right / ITEMS[next.kind];
      }

      results.push({ lecture_id: next.lectureId, topic_id: next.topicId, lesson_kind: next.kind, score: Math.fround(score), completed_at: now.toISOString() });
      known[index] += (next.kind === "flashcards" ? learn * 0.7 : learn) * (1 - known[index]);
      studied[index] = now.getTime();
    }
  }

  return { readyKnown, finalKnown: known };
}

const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;

test("a learner the prep calls ready knows the material at their goal, then and on the exam day", () => {
  let ready = 0;

  for (const target of [0.75, 0.9]) {
    for (const learn of [0.06, 0.08, 0.12]) {
      for (const seed of [1, 2, 3, 4]) {
        const run = hiddenKnowledge({ topics: 4, days: 14, target, start: 0.25, learn, seed });

        if (run.readyKnown) {
          ready += 1;
          assert.ok(mean(run.readyKnown) >= target - 0.02, `ready at ${mean(run.readyKnown).toFixed(2)} against ${target}`);
          assert.ok(mean(run.finalKnown) >= target - 0.02, `exam day at ${mean(run.finalKnown).toFixed(2)} against ${target}`);
        }
      }
    }
  }

  assert.ok(ready >= 12, `most learners get there in two weeks (${ready} of 24)`);
});

test("a learner who knows the material is told so before the exam, not held back by old lessons", () => {
  // Quick learners: they know every topic well above the goal well before the exam day.
  let knewIt = 0;
  let toldReady = 0;

  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const run = hiddenKnowledge({ topics: 4, days: 14, target: 0.75, start: 0.4, learn: 0.12, seed });

    if (Math.min(...run.finalKnown) >= 0.85) {
      knewIt += 1;
      toldReady += run.readyKnown ? 1 : 0;
    }
  }

  assert.ok(knewIt >= 4);
  assert.equal(toldReady, knewIt);
});
