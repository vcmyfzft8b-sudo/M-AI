/**
 * Turning stored rows into the journey's inputs, and a journey into the
 * summary the home screen and the exam list show.
 *
 * Shared by the real API (`./server.ts`) and the `/creator` demo, so both
 * compute the journey from the same shapes.
 */
import { dayKeyAt, type DayKey } from "./dates.ts";
import { isGradeScaleId, type GradeScaleId } from "./grade-scales.ts";
import { noteEmoji } from "../note-emoji.ts";
import type {
  ExamJourney,
  ExamMaterialNote,
  ExamPlanPayload,
  ExamPlanSettings,
  ExamPlanSummary,
  ExamTypeId,
  StudyEvent,
} from "./model.ts";
import { EXAM_TYPE_IDS } from "./model.ts";

export interface ExamPlanRowLike {
  id: string;
  title: string;
  exam_date: string;
  exam_type: string;
  grade_scale: string;
  target_grade: string;
  target_percent: number | string;
  daily_minutes: number;
  rest_days: number;
  time_zone: string;
  result_percent: number | string | null;
  result_grade: string | null;
  created_at: string;
}

function toNumber(value: number | string | null | undefined) {
  if (value == null) {
    return null;
  }

  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function isExamTypeId(value: unknown): value is ExamTypeId {
  return typeof value === "string" && (EXAM_TYPE_IDS as string[]).includes(value);
}

export function settingsFromRow(row: ExamPlanRowLike): ExamPlanSettings {
  const timeZone = row.time_zone || "Europe/Ljubljana";

  return {
    id: row.id,
    title: row.title,
    examDate: row.exam_date.slice(0, 10),
    examType: isExamTypeId(row.exam_type) ? row.exam_type : "mixed",
    gradeScale: (isGradeScaleId(row.grade_scale) ? row.grade_scale : "percent") as GradeScaleId,
    targetGrade: row.target_grade,
    targetPercent: toNumber(row.target_percent) ?? 60,
    dailyMinutes: row.daily_minutes,
    restDays: row.rest_days,
    timeZone,
    startDay: dayKeyAt(Date.parse(row.created_at), timeZone),
    resultPercent: toNumber(row.result_percent),
    resultGrade: row.result_grade,
  };
}

/** Words in a markdown note, near enough for a reading-time estimate. */
export function countWords(markdown: string | null | undefined) {
  if (!markdown) {
    return 0;
  }

  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*_`|[\]()!-]/g, " ")
    .split(/\s+/)
    .filter(Boolean).length;
}

export interface MaterialSource {
  lecture: { id: string; title: string | null; source_type?: string | null; status: string };
  sections: Array<{ id: string; idx: number; title: string }>;
  flashcards: Array<{ id: string; idx: number; section_id: string | null }>;
  quizQuestionIds: string[];
  practiceQuestionIds: string[];
  notesMarkdown: string | null;
  untitled: string;
  /**
   * The note's card generation: `null` when none is on record yet, left out when the
   * caller does not know (the demo, whose notes come with their cards).
   */
  studyStatus?: "queued" | "generating" | "ready" | "failed" | null;
}

export function buildMaterialNote(source: MaterialSource): ExamMaterialNote {
  const words = countWords(source.notesMarkdown);
  const title = source.lecture.title?.trim() || source.untitled;
  const cards = [...source.flashcards].sort((a, b) => a.idx - b.idx);
  const sectionOrder = [...source.sections].sort((a, b) => a.idx - b.idx);
  const bySection = new Map<string, string[]>();
  const unsectioned: string[] = [];

  for (const card of cards) {
    if (card.section_id && sectionOrder.some((section) => section.id === card.section_id)) {
      const list = bySection.get(card.section_id) ?? [];
      list.push(card.id);
      bySection.set(card.section_id, list);
    } else {
      unsectioned.push(card.id);
    }
  }

  const totalCards = Math.max(1, cards.length);
  const sections = sectionOrder
    .map((section) => {
      const cardIds = bySection.get(section.id) ?? [];
      return {
        id: section.id,
        title: section.title,
        cardIds,
        words: Math.round((words * cardIds.length) / totalCards),
      };
    })
    .filter((section) => section.cardIds.length > 0);

  // Cards from before sections existed still have to be learned. Split them
  // into bite-sized units rather than one wall of cards.
  const chunk = 12;

  for (let index = 0; index < unsectioned.length; index += chunk) {
    const cardIds = unsectioned.slice(index, index + chunk);
    sections.push({
      id: `part-${index / chunk + 1}`,
      title: unsectioned.length > chunk ? `${title} · ${index / chunk + 1}` : title,
      cardIds,
      words: Math.round((words * cardIds.length) / totalCards),
    });
  }

  return {
    lectureId: source.lecture.id,
    title,
    // The same glyph the library shows for this note.
    emoji: noteEmoji(source.lecture),
    sections,
    quizQuestionIds: source.quizQuestionIds,
    practiceQuestionIds: source.practiceQuestionIds,
    words,
    // A finished note whose cards are still to come is not ready either: the plan would
    // only have "read it" to offer until they exist.
    ready:
      source.lecture.status === "ready" &&
      !(
        cards.length === 0 &&
        (source.studyStatus === null || source.studyStatus === "queued" || source.studyStatus === "generating")
      ),
  };
}

const BUCKET_GRADE = { again: 1, good: 3, easy: 4 } as const;

/**
 * Flashcards studied before the review log existed carry only their last
 * grade and when it was given. One event at that moment is all we know, and
 * it is better than treating months of study as nothing.
 */
export function legacyProgressEvents(
  progress: Array<{
    flashcard_id: string;
    confidence_bucket: keyof typeof BUCKET_GRADE;
    review_count: number;
    last_reviewed_at: string | null;
  }>,
  cardLecture: Map<string, string>,
  events: StudyEvent[],
): StudyEvent[] {
  const logged = new Set(
    events.filter((event) => event.kind === "flashcard").map((event) => event.itemId),
  );
  const result: StudyEvent[] = [];

  for (const row of progress) {
    const lectureId = cardLecture.get(row.flashcard_id);

    if (!lectureId || logged.has(row.flashcard_id) || !row.last_reviewed_at || row.review_count < 1) {
      continue;
    }

    const atMs = Date.parse(row.last_reviewed_at);

    if (!Number.isFinite(atMs)) {
      continue;
    }

    result.push({
      lectureId,
      kind: "flashcard",
      itemId: row.flashcard_id,
      outcome: BUCKET_GRADE[row.confidence_bucket] ?? 3,
      atMs,
    });
  }

  return result;
}

export function summarizeJourney(
  plan: ExamPlanPayload["plan"],
  journey: ExamJourney,
): ExamPlanSummary {
  const today = journey.todayPlan;
  const forecast = journey.readiness.unlocked ? journey.readiness.onPlan : null;

  return {
    id: plan.id,
    lectureIds: plan.lectureIds,
    title: plan.title,
    examDate: plan.examDate,
    examType: plan.examType,
    gradeScale: plan.gradeScale,
    targetGrade: plan.targetGrade,
    targetPercent: plan.targetPercent,
    noteCount: plan.lectureIds.length,
    status: journey.status,
    daysLeft: journey.daysLeft,
    phase: journey.phase,
    todayDone: today ? today.tasks.filter((task) => task.done).length : 0,
    todayTotal: today ? today.tasks.length : 0,
    todayMinutes: today ? today.minutes : 0,
    coverage: journey.readiness.coverage,
    forecastMid: forecast ? forecast.mid : null,
    forecastGrade: forecast ? forecast.gradeMid : null,
    resultGrade: plan.resultGrade,
  };
}

/** Upcoming first (soonest exam first), finished last (most recent first). */
export function sortSummaries(summaries: ExamPlanSummary[]) {
  return [...summaries].sort((a, b) => {
    const aDone = a.status === "finished" ? 1 : 0;
    const bDone = b.status === "finished" ? 1 : 0;

    if (aDone !== bDone) {
      return aDone - bDone;
    }

    return aDone ? b.examDate.localeCompare(a.examDate) : a.examDate.localeCompare(b.examDate);
  });
}

export type { DayKey };
