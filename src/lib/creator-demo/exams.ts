"use client";

/**
 * Exam prep in the `/creator` demo: plans, the review log and manual ticks,
 * kept in this browser tab like the rest of the demo library.
 *
 * The journey itself is computed by the same pure functions the real API
 * uses (`src/lib/exam-prep/journey.ts`), from the demo's notes, so the demo
 * plans exactly as production would. One exam comes pre-made with a week of
 * study behind it, simulated by following that same planner day by day (with
 * one day skipped), so a recording can show a journey in progress — past
 * days, a rebalanced plan, an unlocked forecast — without waiting a week.
 */
import { getCreatorDemoState } from "@/lib/creator-demo/store";
import { addDays, dayKeyAt } from "@/lib/exam-prep/dates";
import {
  buildMaterialNote,
  settingsFromRow,
  sortSummaries,
  summarizeJourney,
  type ExamPlanRowLike,
} from "@/lib/exam-prep/build";
import { buildExamJourney } from "@/lib/exam-prep/journey";
import { defaultTargetPercent } from "@/lib/exam-prep/grade-scales";
import type {
  ExamEvidence,
  ExamMaterialNote,
  ExamPlanPayload,
  PracticeAnswerEvidence,
  StudyEvent,
} from "@/lib/exam-prep/model";
import type { CreateExamPlanInput, UpdateExamPlanInput } from "@/lib/exam-prep/schema";

const STORAGE_KEY = "memoai:creator-demo:exams:v1";
const DAY_MS = 86_400_000;
const SEED_PLAN_ID = "demo-exam-mikroekonomija";
const SEED_LECTURE_ID = "demo-note-mikroekonomija";

type DemoExamPlan = ExamPlanRowLike & { lectureIds: string[] };

interface DemoExamState {
  plans: DemoExamPlan[];
  events: StudyEvent[];
  practice: PracticeAnswerEvidence[];
  checks: Array<{ planId: string; day: string; taskKey: string }>;
}

let state: DemoExamState | null = null;
let counter = 0;

function timeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Ljubljana";
  } catch {
    return "Europe/Ljubljana";
  }
}

function persist() {
  if (!state) {
    return;
  }

  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // A convenience, as for the rest of the demo.
  }
}

function demoMaterial(lectureIds: string[]): ExamMaterialNote[] {
  const library = getCreatorDemoState();

  return lectureIds
    .map((lectureId) => library.details[lectureId])
    .filter(Boolean)
    .map((detail) =>
      buildMaterialNote({
        lecture: {
          id: detail.lecture.id,
          title: detail.lecture.title,
          source_type: detail.lecture.source_type,
          status: detail.lecture.status,
        },
        sections: detail.studySections.map((section) => ({
          id: section.id,
          idx: section.idx,
          title: section.title,
        })),
        flashcards: detail.flashcards.map((card) => ({
          id: card.id,
          idx: card.idx,
          section_id: card.section_id,
        })),
        quizQuestionIds: detail.quizQuestions.map((question) => question.id),
        practiceQuestionIds: detail.practiceTestQuestions.map((question) => question.id),
        notesMarkdown: detail.artifact?.structured_notes_md ?? null,
        untitled: detail.lecture.title ?? "",
      }),
    );
}

/** Practice tests the visitor takes in the demo are graded into the note itself. */
function practiceFromLibrary(lectureIds: string[]): PracticeAnswerEvidence[] {
  const library = getCreatorDemoState();
  const answers: PracticeAnswerEvidence[] = [];

  for (const lectureId of lectureIds) {
    const detail = library.details[lectureId];

    for (const attempt of detail?.practiceTestAttempts ?? []) {
      if (attempt.status !== "graded") {
        continue;
      }

      const atMs = Date.parse(attempt.graded_at ?? attempt.created_at);

      for (const answer of attempt.answers) {
        if (answer.score == null) {
          continue;
        }

        answers.push({
          lectureId,
          attemptId: attempt.id,
          questionId: answer.practice_test_question_id,
          score: Number(answer.score) / 5,
          atMs,
        });
      }
    }
  }

  return answers;
}

function evidenceFor(plan: DemoExamPlan): ExamEvidence {
  const current = getState();
  const lectures = new Set(plan.lectureIds);

  return {
    events: current.events.filter((event) => lectures.has(event.lectureId)),
    practiceAnswers: [
      ...current.practice.filter((answer) => lectures.has(answer.lectureId)),
      ...practiceFromLibrary(plan.lectureIds),
    ],
    checks: current.checks
      .filter((check) => check.planId === plan.id)
      .map((check) => ({ day: check.day, taskKey: check.taskKey })),
  };
}

/**
 * A learner who mostly keeps to the plan: they do each day's tasks with
 * realistic, imperfect answers, and skip one day in the middle.
 */
function seedHistory(plan: DemoExamPlan, now: number) {
  const settings = settingsFromRow(plan);
  const notes = demoMaterial(plan.lectureIds);
  const events: StudyEvent[] = [];
  const practice: PracticeAnswerEvidence[] = [];
  const cardsOf = new Map(notes.map((note) => [note.lectureId, note]));
  const createdAt = Date.parse(plan.created_at);
  let quizCursor = 0;

  for (let day = 0; ; day += 1) {
    const studyAt = createdAt + day * DAY_MS + 2 * 60 * 60 * 1000;

    if (dayKeyAt(studyAt, settings.timeZone) >= dayKeyAt(now, settings.timeZone)) {
      break;
    }

    // A missed day, so the journey shows how it recovers.
    if (day === 4) {
      continue;
    }

    const journey = buildExamJourney({
      settings,
      notes,
      evidence: { events, practiceAnswers: practice, checks: [] },
      nowMs: studyAt,
    });

    let at = studyAt;

    for (const task of journey.todayPlan?.tasks ?? []) {
      const note = task.lectureId ? cardsOf.get(task.lectureId) : null;

      if (!note) {
        continue;
      }

      if (task.kind === "learn") {
        const section = note.sections.find((item) => item.title === task.sectionTitle);

        section?.cardIds.forEach((itemId, index) => {
          events.push({ lectureId: note.lectureId, kind: "flashcard", itemId, outcome: index % 4 === 1 ? 1 : 3, atMs: (at += 40_000) });
        });
      } else if (task.kind === "review") {
        const seen = note.sections
          .flatMap((section) => section.cardIds)
          .filter((id) => events.some((event) => event.itemId === id));

        seen.slice(0, task.count).forEach((itemId, index) => {
          events.push({ lectureId: note.lectureId, kind: "flashcard", itemId, outcome: index % 5 === 2 ? 1 : index % 3 === 0 ? 4 : 3, atMs: (at += 15_000) });
        });
      } else if (task.kind === "quiz") {
        for (let index = 0; index < task.count; index += 1) {
          const itemId = note.quizQuestionIds[(quizCursor + index) % note.quizQuestionIds.length];
          events.push({ lectureId: note.lectureId, kind: "quiz", itemId, outcome: (quizCursor + index) % 4 === 3 ? 1 : 3, atMs: (at += 30_000) });
        }

        quizCursor += task.count;
      } else if (task.kind === "mock") {
        note.practiceQuestionIds.slice(0, task.count).forEach((questionId, index) => {
          practice.push({ lectureId: note.lectureId, attemptId: `seed-${day}`, questionId, score: [0.8, 0.6, 0.7, 0.9, 0.5][index % 5], atMs: (at += 150_000) });
        });
      }
    }
  }

  return { events, practice };
}

function seededState(): DemoExamState {
  const now = Date.now();
  const zone = timeZone();
  const today = dayKeyAt(now, zone);
  const plan: DemoExamPlan = {
    id: SEED_PLAN_ID,
    title: "Kolokvij: Mikroekonomija",
    exam_date: addDays(today, 9),
    exam_type: "written",
    grade_scale: "percent",
    target_grade: "80",
    target_percent: 80,
    daily_minutes: 15,
    rest_days: 1 << 6,
    time_zone: zone,
    result_percent: null,
    result_grade: null,
    created_at: new Date(now - 11 * DAY_MS).toISOString(),
    lectureIds: [SEED_LECTURE_ID],
  };

  if (!getCreatorDemoState().details[SEED_LECTURE_ID]) {
    return { plans: [], events: [], practice: [], checks: [] };
  }

  const history = seedHistory(plan, now);
  return { plans: [plan], events: history.events, practice: history.practice, checks: [] };
}

function getState(): DemoExamState {
  if (state) {
    return state;
  }

  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);

    if (raw) {
      const parsed = JSON.parse(raw) as DemoExamState;

      if (parsed && Array.isArray(parsed.plans)) {
        state = parsed;
        return state;
      }
    }
  } catch {
    // Start from the seed.
  }

  state = seededState();
  persist();
  return state;
}

export function resetDemoExams() {
  state = null;

  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // The in-memory reset is what matters.
  }
}

export function recordDemoStudyEvent(event: Omit<StudyEvent, "atMs">) {
  const current = getState();
  current.events.push({ ...event, atMs: Date.now() });
  persist();
}

function payloadFor(plan: DemoExamPlan): ExamPlanPayload {
  const settings = settingsFromRow(plan);
  const notes = demoMaterial(plan.lectureIds);
  const journey = buildExamJourney({
    settings,
    notes,
    evidence: evidenceFor(plan),
    nowMs: Date.now(),
    locale: "sl",
  });

  return { plan: { ...settings, lectureIds: notes.map((note) => note.lectureId) }, journey };
}

export function getDemoExamPayload(planId: string) {
  const plan = getState().plans.find((item) => item.id === planId);
  return plan ? payloadFor(plan) : null;
}

export function listDemoExamSummaries(lectureId?: string | null) {
  return sortSummaries(
    getState()
      .plans.filter((plan) => !lectureId || plan.lectureIds.includes(lectureId))
      .map((plan) => {
        const payload = payloadFor(plan);
        return summarizeJourney(payload.plan, payload.journey);
      }),
  );
}

/** The demo library, as the setup's note picker lists it. */
export function listDemoExamNoteOptions() {
  const library = getCreatorDemoState();

  return library.order
    .map((id) => library.details[id]?.lecture)
    .filter((lecture) => lecture && lecture.status !== "failed")
    .map((lecture) => ({
      id: lecture!.id,
      title: lecture!.title,
      sourceType: lecture!.source_type,
      status: lecture!.status,
    }));
}

export function createDemoExam(input: CreateExamPlanInput) {
  const current = getState();
  counter += 1;
  const id = `demo-exam-${Date.now().toString(36)}-${counter}`;

  current.plans.push({
    id,
    title: input.title,
    exam_date: input.examDate,
    exam_type: input.examType,
    grade_scale: input.gradeScale,
    target_grade: input.targetGrade,
    target_percent: input.targetPercent,
    daily_minutes: input.dailyMinutes,
    rest_days: input.restDays,
    time_zone: input.timeZone || timeZone(),
    result_percent: null,
    result_grade: null,
    created_at: new Date().toISOString(),
    lectureIds: [...new Set(input.lectureIds)],
  });
  persist();
  return id;
}

export function updateDemoExam(planId: string, input: UpdateExamPlanInput) {
  const plan = getState().plans.find((item) => item.id === planId);

  if (!plan) {
    return false;
  }

  if (input.title !== undefined) plan.title = input.title;
  if (input.examDate !== undefined) plan.exam_date = input.examDate;
  if (input.examType !== undefined) plan.exam_type = input.examType;
  if (input.gradeScale !== undefined) plan.grade_scale = input.gradeScale;
  if (input.targetGrade !== undefined) plan.target_grade = input.targetGrade;
  if (input.targetPercent !== undefined) plan.target_percent = input.targetPercent;
  if (input.dailyMinutes !== undefined) plan.daily_minutes = input.dailyMinutes;
  if (input.restDays !== undefined) plan.rest_days = input.restDays;
  if (input.resultPercent !== undefined) plan.result_percent = input.resultPercent;
  if (input.resultGrade !== undefined) plan.result_grade = input.resultGrade;
  if (input.lectureIds !== undefined) plan.lectureIds = [...new Set(input.lectureIds)];

  if (plan.target_percent == null) {
    plan.target_percent = defaultTargetPercent("ten_point", plan.target_grade) ?? 71;
  }

  persist();
  return true;
}

export function deleteDemoExam(planId: string) {
  const current = getState();
  const before = current.plans.length;
  current.plans = current.plans.filter((plan) => plan.id !== planId);
  current.checks = current.checks.filter((check) => check.planId !== planId);
  persist();
  return current.plans.length < before;
}

export function setDemoExamCheck(planId: string, check: { day: string; taskKey: string; done: boolean }) {
  const current = getState();

  if (!current.plans.some((plan) => plan.id === planId)) {
    return false;
  }

  current.checks = current.checks.filter(
    (item) => !(item.planId === planId && item.day === check.day && item.taskKey === check.taskKey),
  );

  if (check.done) {
    current.checks.push({ planId, day: check.day, taskKey: check.taskKey });
  }

  persist();
  return true;
}
