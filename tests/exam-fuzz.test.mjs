import assert from "node:assert/strict";
import test from "node:test";

import {
  CHECK_KINDS,
  EXAM_LESSON_KINDS,
  dailyPlan,
  examForecast,
  examMastery,
  examModuleStates,
  examNextStep,
  examStage,
  gradeForPercentage,
  lessonsToTarget,
  masteryAfterPractice,
  masteryGoal,
  meetsPassMark,
  percent,
  practicesOwed,
  reachableModules,
  topicMastery,
  wholePercent,
} from "../src/lib/exams/exam-model.ts";

/*
 * Fuzzing the exam model with seeded random histories, malformed ones included (scores outside
 * 0..1, NaN, totals of 0 or missing, unknown or missing topics, unparseable dates, empty exams,
 * forty modules), and checking what must hold for any of them: nothing throws, every number is
 * finite and in range, modules open in order, "ready" means on target and checked lately, the next
 * step is always one the learner can open, there always is one while anything is open, and the
 * practices owed never run out under the goal. Seeded, so a failure names a reproducible case.
 */

function seeded(seed) {
  let state = seed >>> 0;
  return () => (state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}

const DAY = 86_400_000;
const NOW = Date.parse("2026-10-20T12:00:00Z");

function makeCase(seed) {
  const random = seeded(seed);
  const pick = (list) => list[Math.floor(random() * list.length)];
  const notes = 1 + Math.floor(random() * 8);
  const topicCount = random() < 0.05 ? 0 : 1 + Math.floor(random() * 40);
  const modules = Array.from({ length: topicCount }, (_, index) => ({
    topicId: `t${index}`,
    lectureId: `n${index % notes}`,
  }));
  const target = pick([0.5, 0.6, 0.75, 0.8, 0.9, 0.95, 1, 0, 1.3, Number.NaN]);
  const scores = () =>
    random() < 0.08 ? pick([-0.4, 1.6, Number.NaN, Number.POSITIVE_INFINITY]) : pick([0, 1, random(), Math.round(random() * 5) / 5]);
  const results = Array.from({ length: Math.floor(random() * 300) }, () => {
    const module = modules.length > 0 && random() > 0.04 ? pick(modules) : null;
    const items = Array.from({ length: Math.floor(random() * 6) }, () => `q${Math.floor(random() * 30)}`);
    return {
      lecture_id: module?.lectureId ?? "n0",
      topic_id: module ? module.topicId : pick([null, undefined, "unknown-topic"]),
      lesson_kind: pick(EXAM_LESSON_KINDS),
      score: scores(),
      completed_at:
        random() < 0.03 ? pick(["garbage", "", "2026-13-45T99:00:00Z"]) : new Date(NOW - random() * 40 * DAY).toISOString(),
      total: pick([0, 1, 5, 8, 10, 14, null, undefined, 400]),
      item_ids: items,
      missed_ids: items.filter(() => random() < 0.3),
    };
  });
  const mock =
    random() < 0.3
      ? {
          at: new Date(NOW - random() * 10 * DAY).toISOString(),
          percentage: pick([0, 45, 75, 90, 100, Number.NaN, 140]),
          byLecture: Object.fromEntries(Array.from({ length: notes }, (_, index) => [`n${index}`, random()])),
        }
      : null;
  const now = random() < 0.1 ? null : new Date(NOW);
  const open = new Set(Array.from({ length: notes }, (_, index) => `n${index}`).filter(() => random() > 0.15));
  const canOpen = random() < 0.5 ? () => true : (lectureId) => open.has(lectureId);
  const flags = modules.map(() => ({ ready: random() > 0.05, pending: random() < 0.05 }));
  return { modules, target, results, mock, now, canOpen, flags, finalDay: random() < 0.1, tutor: random() > 0.3 };
}

const inUnit = (value) => Number.isFinite(value) && value >= 0 && value <= 1;

test("fuzz: any history keeps the model's promises", () => {
  let cases = 0;
  let withNext = 0;

  // FUZZ_CASES=50000 for a deeper run; the suite keeps it quick.
  const total = Number(process.env.FUZZ_CASES ?? 3000);

  for (let seed = 1; seed <= total; seed += 1) {
    const c = makeCase(seed);
    const where = `seed ${seed}`;
    const states = examModuleStates(c.modules, c.results, c.target, c.mock, c.now, { tutor: c.tutor });
    const goal = masteryGoal(c.target);
    assert.ok(inUnit(goal) && goal > 0, `${where}: goal ${goal}`);
    assert.equal(states.length, c.modules.length, where);

    states.forEach((state, index) => {
      assert.ok(inUnit(state.mastery) && inUnit(state.rawMastery), `${where}: mastery ${state.mastery}/${state.rawMastery}`);
      assert.ok(state.mastery <= state.rawMastery + 1e-9, `${where}: faded above raw`);
      assert.ok(Number.isInteger(state.perfectRun) && state.perfectRun >= 0, where);
      assert.ok(EXAM_LESSON_KINDS.includes(state.nextKind), `${where}: kind ${state.nextKind}`);
      if (!c.tutor) assert.notEqual(state.nextKind, "tutor", `${where}: tutor offered without talking time`);
      // Modules open in order: one is open only when the one before reached the goal.
      if (index === 0) assert.equal(state.unlocked, true, where);
      else assert.equal(state.unlocked, states[index - 1].learned, `${where}: module ${index} open out of order`);
      // Ready on a topic: on target, checked lately, and nothing owed.
      if (state.mastered) {
        assert.ok(meetsPassMark(state.mastery, goal), `${where}: mastered under the goal`);
        assert.equal(state.checkDue, false, `${where}: mastered with a check due`);
        assert.equal(state.proofOwed, false, where);
      }
      if (state.checkDue) assert.ok(CHECK_KINDS.includes(state.nextKind), `${where}: check as ${state.nextKind}`);
      const owed = practicesOwed(state, c.target);
      assert.ok(Number.isInteger(owed) && owed >= 0, `${where}: owed ${owed}`);
      if (!meetsPassMark(state.rawMastery, goal)) assert.ok(owed >= 1, `${where}: nothing owed under the goal`);
    });

    const stage = examStage(states, c.mock, c.target);
    assert.ok(["learn", "practise", "prove", "ready"].includes(stage), where);
    if (states.some((state) => !state.learned)) assert.equal(stage, "learn", where);
    if (stage === "ready") assert.ok(states.every((state) => state.mastered), `${where}: ready with a topic not on target`);
    assert.ok(inUnit(examMastery(states)), where);

    const view = states.map((state, index) => ({ ...state, ...c.flags[index] }));
    const next = examNextStep(view, stage, c.canOpen, { finalDay: c.finalDay });
    const reached = reachableModules(view, c.canOpen);
    const usable = (state) => state.ready !== false && state.pending !== true && c.canOpen(state.lectureId);
    const openNow = view.filter((state, index) => reached[index] && usable(state));

    if (next?.type === "lesson") {
      withNext += 1;
      const index = view.findIndex((state) => state.topicId === next.topicId);
      assert.ok(index >= 0, where);
      assert.ok(reached[index] && usable(view[index]), `${where}: next step on a module the learner cannot open`);
      assert.ok(EXAM_LESSON_KINDS.includes(next.kind), where);
      if (next.check) assert.ok(CHECK_KINDS.includes(next.kind) && view[index].checkDue, `${where}: check flag on ${next.kind}`);
    } else if (next?.type === "mock") {
      assert.equal(stage, "prove", `${where}: mock offered at ${stage}`);
    }
    if (openNow.length > 0 && stage !== "prove") assert.ok(next !== null, `${where}: nothing to do while modules are open`);

    const today = "2026-10-20";
    const plan = dailyPlan({
      examDate: "2026-11-02",
      today,
      dailyMinutes: 30,
      target: c.target,
      states,
      resultsToday: c.results.length % 9,
    });
    for (const value of Object.values(plan)) assert.ok(Number.isInteger(value) && value >= 0, `${where}: plan ${JSON.stringify(plan)}`);
    const forecast = examForecast({
      mastery: examMastery(states),
      target: c.target,
      lessonDays: c.results.slice(0, 30).map(() => today),
      today,
      examDate: "2026-11-02",
    });
    if (forecast) {
      assert.ok(inUnit(forecast.atExam), where);
      assert.ok(Number.isFinite(forecast.perLesson) && forecast.lessonsNeeded >= 0 && forecast.perDay >= 0, where);
    }
    cases += 1;
  }

  assert.equal(cases, total);
  assert.ok(withNext > total / 2, `${withNext} cases had a next lesson`);
});

test("fuzz: practice moves knowledge the right way, whatever the order results arrive in", () => {
  const random = seeded(7);

  for (let round = 0; round < 2000; round += 1) {
    const mastery = random();
    const run = Math.floor(random() * 5);
    const kind = EXAM_LESSON_KINDS[Math.floor(random() * EXAM_LESSON_KINDS.length)];
    const right = masteryAfterPractice(mastery, run, kind, 1).mastery;
    const wrong = masteryAfterPractice(mastery, run, kind, 0).mastery;
    assert.ok(inUnit(right) && inUnit(wrong));
    // A fully right practice never lowers knowledge; a fully wrong one never raises it.
    assert.ok(right >= mastery - 1e-12, `${kind} at ${mastery}: ${right}`);
    assert.ok(wrong <= mastery + 1e-12, `${kind} at ${mastery}: ${wrong}`);
  }

  // The same results in any order give the same knowledge (they are replayed by time).
  for (let round = 0; round < 200; round += 1) {
    const results = Array.from({ length: 1 + Math.floor(random() * 40) }, (_, index) => ({
      lecture_id: "n",
      topic_id: "t",
      lesson_kind: EXAM_LESSON_KINDS[Math.floor(random() * EXAM_LESSON_KINDS.length)],
      score: random(),
      total: 5,
      completed_at: new Date(NOW - index * 3_600_000).toISOString(),
    }));
    const shuffled = [...results].sort(() => random() - 0.5);
    assert.equal(topicMastery(shuffled, 0.75).mastery, topicMastery(results, 0.75).mastery);
  }
});

test("fuzz: what is shown stays a whole percentage and a grade, whatever comes in", () => {
  for (const value of [-1, 0, 0.4999, 0.5, 0.8999999, 0.9, 1, 1.0001, 7, Number.NaN, Number.POSITIVE_INFINITY, -Infinity]) {
    const shown = percent(value);
    assert.ok(Number.isInteger(shown) && shown >= 0 && shown <= 100, `${value} → ${shown}`);
    const whole = wholePercent(value * 100);
    assert.ok(Number.isInteger(whole) && whole >= 0 && whole <= 100, `${value} → ${whole}`);
    for (const scale of ["uni_5_10", "school_1_5", "percent"]) {
      for (const pass of [50, 0, 100, Number.NaN, 120]) {
        const grade = gradeForPercentage(scale, value * 100, pass);
        assert.ok(typeof grade === "string" && grade.trim().length > 0, `${scale} ${value} ${pass}`);
      }
    }
  }

  for (let mastery = -0.2; mastery <= 1.2; mastery += 0.01) {
    for (const target of [0.5, 0.75, 0.9, 1, Number.NaN]) {
      const owed = lessonsToTarget(mastery, target);
      assert.ok(Number.isInteger(owed) && owed >= 0, `${mastery} ${target}: ${owed}`);
    }
  }
});
