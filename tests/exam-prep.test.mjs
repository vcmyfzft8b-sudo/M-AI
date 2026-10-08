import assert from "node:assert/strict";
import test from "node:test";

import {
  addDays,
  addMonths,
  dayKeyAt,
  diffDays,
  isDayKey,
  isRestDay,
  monthGrid,
  monthOf,
  weekdayIndex,
} from "../src/lib/exam-prep/dates.ts";
import {
  intervalForRetention,
  retrievability,
  reviewMemory,
} from "../src/lib/exam-prep/fsrs.ts";
import {
  defaultTargetPercent,
  gradeForPercent,
  targetGradeOptions,
} from "../src/lib/exam-prep/grade-scales.ts";
import {
  buildExamJourney,
  buildLearnUnits,
  buildPhaseCalendar,
} from "../src/lib/exam-prep/journey.ts";
import { FORECAST_EVIDENCE_NEEDED } from "../src/lib/exam-prep/forecast.ts";

const TZ = "Europe/Ljubljana";
const DAY = 86_400_000;
// 2026-10-08, 09:00 in Ljubljana.
const NOW = Date.parse("2026-10-08T07:00:00Z");

function note(id, sections = 3, cards = 8) {
  return {
    lectureId: id,
    title: `Note ${id}`,
    emoji: "📘",
    sections: Array.from({ length: sections }, (_, s) => ({
      id: `${id}-s${s}`,
      title: `Section ${s + 1}`,
      cardIds: Array.from({ length: cards }, (_, c) => `${id}-c${s}-${c}`),
      words: 600,
    })),
    quizQuestionIds: Array.from({ length: 8 }, (_, q) => `${id}-q${q}`),
    practiceQuestionIds: Array.from({ length: 6 }, (_, q) => `${id}-p${q}`),
    words: 1800,
    ready: true,
  };
}

function settings(overrides = {}) {
  return {
    id: "plan-1",
    title: "Microeconomics",
    examDate: "2026-10-28",
    examType: "written",
    gradeScale: "ten_point",
    targetGrade: "8",
    targetPercent: 71,
    dailyMinutes: 30,
    restDays: 0,
    timeZone: TZ,
    startDay: "2026-10-08",
    resultPercent: null,
    resultGrade: null,
    ...overrides,
  };
}

const EMPTY = { events: [], practiceAnswers: [], checks: [] };

test("day keys follow the plan's time zone, not UTC", () => {
  // 23:30 UTC on the 7th is already the 8th in Ljubljana.
  assert.equal(dayKeyAt(Date.parse("2026-10-07T23:30:00Z"), TZ), "2026-10-08");
  assert.equal(dayKeyAt(Date.parse("2026-10-07T23:30:00Z"), "UTC"), "2026-10-07");
  assert.equal(addDays("2026-10-31", 1), "2026-11-01");
  assert.equal(diffDays("2026-10-08", "2026-10-28"), 20);
  assert.equal(weekdayIndex("2026-10-12"), 0); // a Monday
  assert.equal(isRestDay("2026-10-18", 1 << 6), true); // Sunday off
  assert.equal(isDayKey("2026-02-30"), false);
  assert.equal(isDayKey("2026-10-08"), true);
});

test("FSRS: stability is the day recall reaches 90%, and reviews grow it", () => {
  assert.ok(Math.abs(retrievability(10, 10) - 0.9) < 1e-9);
  assert.ok(Math.abs(intervalForRetention(10, 0.9) - 10) < 1e-9);

  const first = reviewMemory(null, 3, NOW, "2026-10-08");
  assert.ok(Math.abs(first.stability - 3.173) < 1e-9);

  const second = reviewMemory(first, 3, NOW + 3 * DAY, "2026-10-11");
  assert.ok(second.stability > first.stability * 2, "a successful spaced review should multiply S");

  const lapse = reviewMemory(second, 1, NOW + 30 * DAY, "2026-11-07");
  assert.ok(lapse.stability < second.stability, "forgetting must lower S");
  assert.equal(lapse.lapses, 1);

  // Cramming: a second look the same day barely moves stability.
  const sameDay = reviewMemory(first, 3, NOW + 60_000, "2026-10-08");
  assert.ok(sameDay.stability < second.stability);
});

test("grade scales map percentages and respect the learner's own cut-off", () => {
  assert.equal(gradeForPercent("ten_point", 50, {}), "5");
  assert.equal(gradeForPercent("ten_point", 71, {}), "8");
  assert.equal(gradeForPercent("ten_point", 95, {}), "10");
  assert.equal(defaultTargetPercent("five_point", "4", "sl"), 77);
  assert.equal(defaultTargetPercent("five_point", "4", "hr"), 75);
  assert.equal(gradeForPercent("letter", 85, {}), "B");
  // A faculty that needs 85% for a 9 should not have 83% called a 9.
  const target = { label: "9", percent: 85 };
  assert.equal(gradeForPercent("ten_point", 83, { target }), "8");
  assert.equal(gradeForPercent("ten_point", 86, { target }), "9");
  assert.deepEqual(
    targetGradeOptions("ten_point").map((step) => step.label),
    ["6", "7", "8", "9", "10"],
  );
});

test("phases are learn → practice → mock → final, anchored to the plan's start", () => {
  const { calendar, studyDays } = buildPhaseCalendar("2026-10-08", "2026-10-28", 0);
  const phases = [...calendar.values()];

  assert.equal(studyDays.length, 20);
  assert.equal(phases.at(-1), "final");
  assert.equal(phases[0], "learn");
  assert.ok(phases.indexOf("practice") > phases.lastIndexOf("learn"));
  assert.ok(phases.indexOf("mock") > phases.lastIndexOf("practice"));
  // 19 days before the final one: about half learning.
  assert.equal(phases.filter((phase) => phase === "learn").length, 10);
});

test("rest days are skipped, unless every day is a rest day", () => {
  const weekends = (1 << 5) | (1 << 6);
  const { studyDays } = buildPhaseCalendar("2026-10-08", "2026-10-28", weekends);
  assert.ok(studyDays.every((day) => !isRestDay(day, weekends)));

  const allButSunday = 0b0111111;
  const { studyDays: tight } = buildPhaseCalendar("2026-10-08", "2026-10-10", allButSunday);
  assert.ok(tight.length > 0, "a plan with no study days falls back to studying");
});

test("learn units interleave notes", () => {
  const units = buildLearnUnits([note("a", 2), note("b", 2)]);
  assert.deepEqual(
    units.map((unit) => unit.key),
    ["a:a-s0", "b:b-s0", "a:a-s1", "b:b-s1"],
  );
});

test("a fresh plan starts with new material today and covers everything before the exam", () => {
  const journey = buildExamJourney({
    settings: settings(),
    notes: [note("a"), note("b")],
    evidence: EMPTY,
    nowMs: NOW,
    locale: "sl",
  });

  assert.equal(journey.status, "upcoming");
  assert.equal(journey.daysLeft, 20);
  assert.equal(journey.phase, "learn");
  assert.ok(journey.todayPlan);
  assert.ok(journey.todayPlan.tasks.some((task) => task.kind === "learn"));
  assert.ok(journey.todayPlan.minutes <= 40, "today stays near the daily budget");
  assert.equal(journey.feasibility.fits, true);
  assert.equal(journey.days.at(-1).kind, "exam");

  // Reviews appear on later days, and the final day is light with a wind-down.
  const study = journey.days.filter((day) => day.kind === "study");
  assert.ok(study.slice(1).some((day) => day.tasks.some((task) => task.kind === "review")));
  const finalDay = study.at(-1);
  assert.equal(finalDay.phase, "final");
  assert.ok(finalDay.tasks.some((task) => task.kind === "wind_down"));
  assert.ok(!finalDay.tasks.some((task) => task.kind === "learn"), "no new material the day before");
  // Mock exams in the exam's format happen before the final day.
  assert.ok(study.some((day) => day.tasks.some((task) => task.kind === "mock")));
});

test("the plan says so when the material does not fit the time", () => {
  const journey = buildExamJourney({
    settings: settings({ examDate: "2026-10-11", dailyMinutes: 10 }),
    notes: [note("a", 6, 20), note("b", 6, 20)],
    evidence: EMPTY,
    nowMs: NOW,
  });

  assert.equal(journey.feasibility.fits, false);
  assert.ok(journey.feasibility.unscheduledSections > 0);
  assert.ok(journey.feasibility.recommendedMinutes > 10);
});

function cardEvents(ids, atMs, outcome = 3, lectureId = "a") {
  return ids.map((itemId, index) => ({
    lectureId,
    kind: "flashcard",
    itemId,
    outcome,
    atMs: atMs + index * 1000,
  }));
}

test("today's tasks tick off from real study, and the plan moves on tomorrow", () => {
  const notes = [note("a"), note("b")];
  const base = { settings: settings(), notes, nowMs: NOW };
  const before = buildExamJourney({ ...base, evidence: EMPTY });
  const learn = before.todayPlan.tasks.find((task) => task.kind === "learn");
  const unitCards = notes[0].sections[0].cardIds;

  const after = buildExamJourney({
    ...base,
    nowMs: NOW + 60 * 60 * 1000,
    evidence: { ...EMPTY, events: cardEvents(unitCards, NOW + 10 * 60 * 1000) },
  });
  const learnAfter = after.todayPlan.tasks.find((task) => task.key === learn.key);

  assert.equal(learnAfter.done, true);
  assert.equal(learnAfter.progress, 1);
  assert.ok(after.readiness.coverage > before.readiness.coverage);
  assert.ok(after.days.find((day) => day.isToday).activity.cards === unitCards.length);
});

test("a missed week is re-planned into the days left, not left as a backlog", () => {
  const notes = [note("a"), note("b")];
  const studied = cardEvents(notes[0].sections[0].cardIds, NOW);
  const later = NOW + 7 * DAY;
  const journey = buildExamJourney({
    settings: settings(),
    notes,
    evidence: { ...EMPTY, events: studied },
    nowMs: later,
  });

  assert.equal(journey.daysLeft, 13);
  const past = journey.days.filter((day) => day.isPast);
  assert.equal(past.length, 7);
  assert.equal(past.filter((day) => day.activity.cards > 0).length, 1);
  // Today asks for the overdue review first, within a sane day.
  const today = journey.todayPlan;
  assert.ok(today.tasks[0].kind === "review");
  assert.ok(today.minutes <= 30 * 1.5 + 5);
  // Every remaining unit is still scheduled before the exam.
  assert.equal(journey.feasibility.fits, true);
});

test("the forecast stays locked until there is enough first-attempt evidence", () => {
  const notes = [note("a"), note("b")];
  const locked = buildExamJourney({ settings: settings(), notes, evidence: EMPTY, nowMs: NOW });
  assert.equal(locked.readiness.unlocked, false);
  assert.equal(locked.readiness.evidenceNeeded, FORECAST_EVIDENCE_NEEDED);
});

function quizEvents(lectureId, correct, total, atMs) {
  return Array.from({ length: total }, (_, index) => ({
    lectureId,
    kind: "quiz",
    itemId: `${lectureId}-q${index}`,
    outcome: index < correct ? 3 : 1,
    atMs: atMs + index * 1000,
  }));
}

test("better first-attempt answers forecast a higher score, with an honest range", () => {
  const notes = [note("a"), note("b")];
  const cards = notes.flatMap((n) => n.sections.flatMap((s) => s.cardIds));
  const studied = cards.map((itemId, index) => ({
    lectureId: itemId.startsWith("a") ? "a" : "b",
    kind: "flashcard",
    itemId,
    outcome: 3,
    atMs: NOW - 2 * DAY + index * 1000,
  }));
  const run = (correct) =>
    buildExamJourney({
      settings: settings({ examType: "multiple_choice" }),
      notes,
      evidence: {
        ...EMPTY,
        events: [
          ...studied,
          ...quizEvents("a", correct, 8, NOW - DAY),
          ...quizEvents("b", correct, 8, NOW - DAY),
        ],
      },
      nowMs: NOW,
    }).readiness;

  const strong = run(8);
  const weak = run(3);

  assert.equal(strong.unlocked, true);
  assert.ok(strong.today.mid > weak.today.mid);
  assert.ok(strong.today.low <= strong.today.mid && strong.today.mid <= strong.today.high);
  assert.ok(strong.today.high - strong.today.low >= 5, "a range, not a point");
  assert.ok(strong.today.chanceOfTarget > weak.today.chanceOfTarget);
  // Deterministic for the same evidence.
  assert.deepEqual(run(8).today, strong.today);
});

test("repeating the same questions does not inflate the forecast", () => {
  const notes = [note("a")];
  const once = quizEvents("a", 8, 8, NOW - DAY);
  const drilled = [
    ...once,
    ...quizEvents("a", 8, 8, NOW - DAY + 60_000),
    ...quizEvents("a", 8, 8, NOW - DAY + 120_000),
  ];
  const run = (events) =>
    buildExamJourney({
      settings: settings({ examType: "multiple_choice" }),
      notes,
      evidence: { ...EMPTY, events },
      nowMs: NOW,
    }).readiness;

  const a = run(once);
  const b = run(drilled);
  // Repeats are weighted 0.3 then 0: a little more evidence, not a new score.
  assert.ok(b.evidence < a.evidence * 1.4);
  assert.ok(Math.abs(b.today.mid - a.today.mid) <= 4);
});

test("an exam in the past asks for the result instead of planning", () => {
  const journey = buildExamJourney({
    settings: settings({ examDate: "2026-10-01", startDay: "2026-09-20" }),
    notes: [note("a")],
    evidence: EMPTY,
    nowMs: NOW,
  });

  assert.equal(journey.status, "finished");
  assert.equal(journey.todayPlan, null);
  assert.equal(journey.days.at(-1).kind, "exam");
});

test("plan requests are validated: real notes are uuids, the demo's are readable ids", async () => {
  const { createExamPlanSchema, demoCreateExamPlanSchema } = await import("../src/lib/exam-prep/schema.ts");
  const body = {
    title: "  Anatomy   midterm ",
    examDate: "2026-10-22",
    examType: "written",
    gradeScale: "ten_point",
    targetGrade: "9",
    targetPercent: 83,
    dailyMinutes: 30,
    restDays: 64,
    timeZone: "Europe/Ljubljana",
  };

  const real = createExamPlanSchema.safeParse({ ...body, lectureIds: ["0b5c0d9e-6f1a-4c55-8a51-0d6f1b4e9a10"] });
  assert.equal(real.success, true);
  assert.equal(real.data.title, "Anatomy midterm");
  assert.equal(createExamPlanSchema.safeParse({ ...body, lectureIds: ["demo-note-anatomija"] }).success, false);
  assert.equal(demoCreateExamPlanSchema.safeParse({ ...body, lectureIds: ["demo-note-anatomija"] }).success, true);
  assert.equal(createExamPlanSchema.safeParse({ ...body, restDays: 127, lectureIds: ["0b5c0d9e-6f1a-4c55-8a51-0d6f1b4e9a10"] }).success, false);
  assert.equal(createExamPlanSchema.safeParse({ ...body, examDate: "2026-02-30", lectureIds: ["0b5c0d9e-6f1a-4c55-8a51-0d6f1b4e9a10"] }).success, false);
});

test("the date calendar lays a month out Monday-first in six fixed weeks", () => {
  assert.equal(monthOf("2026-10-08"), "2026-10-01");
  assert.equal(addMonths("2026-10-08", 1), "2026-11-01");
  assert.equal(addMonths("2026-01-31", 1), "2026-02-01");
  assert.equal(addMonths("2026-01-15", -1), "2025-12-01");

  // October 2026 starts on a Thursday: three blanks, then 1–31.
  const october = monthGrid("2026-10-20");
  assert.equal(october.length, 42);
  assert.deepEqual(october.slice(0, 4), [null, null, null, "2026-10-01"]);
  assert.equal(october.filter(Boolean).length, 31);
  assert.equal(october[3 + 30], "2026-10-31");
  assert.equal(october[3 + 31], null);

  // A month starting on Sunday and running 31 days fills the sixth week.
  const march = monthGrid("2026-03-01");
  assert.equal(march.indexOf("2026-03-01"), 6);
  assert.equal(march[41], null);
  assert.equal(march[36], "2026-03-31");

  for (const day of october.filter(Boolean)) {
    assert.equal(october.indexOf(day) % 7, weekdayIndex(day));
  }
});

test("a note counts as ready only once its cards exist or their generation has ended", async () => {
  const { buildMaterialNote } = await import("../src/lib/exam-prep/build.ts");
  const base = {
    lecture: { id: "n1", title: "Uploaded slides", source_type: "pdf", status: "ready" },
    sections: [],
    flashcards: [],
    quizQuestionIds: [],
    practiceQuestionIds: [],
    notesMarkdown: "Some notes",
    untitled: "Untitled",
  };
  const card = { id: "c1", idx: 0, section_id: null };

  // Still being written from the upload.
  assert.equal(buildMaterialNote({ ...base, lecture: { ...base.lecture, status: "processing" } }).ready, false);
  // Written, but its cards are not made yet (none asked for, or on their way).
  assert.equal(buildMaterialNote({ ...base, studyStatus: null }).ready, false);
  assert.equal(buildMaterialNote({ ...base, studyStatus: "queued" }).ready, false);
  assert.equal(buildMaterialNote({ ...base, studyStatus: "generating" }).ready, false);
  // Cards made, or generation over: planned now (a failed one as "read the note").
  assert.equal(buildMaterialNote({ ...base, flashcards: [card], studyStatus: "ready" }).ready, true);
  assert.equal(buildMaterialNote({ ...base, studyStatus: "failed" }).ready, true);
  // Older notes with cards and no status row, and the demo, which does not say.
  assert.equal(buildMaterialNote({ ...base, flashcards: [card], studyStatus: null }).ready, true);
  assert.equal(buildMaterialNote(base).ready, true);
});
