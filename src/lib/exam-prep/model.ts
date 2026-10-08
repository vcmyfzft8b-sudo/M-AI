/**
 * The shapes the exam journey is computed from and computed into.
 *
 * Kept free of the database types so the same pure functions serve the real
 * API (built from Supabase rows in `src/lib/exam-prep/server.ts`) and the
 * `/creator` demo (built from its in-memory store).
 */

import type { DayKey } from "./dates.ts";
import type { GradeScaleId } from "./grade-scales.ts";
import type { ExamTopic } from "./topics.ts";

export type ExamTypeId = "multiple_choice" | "written" | "oral" | "problem_solving" | "mixed";

export const EXAM_TYPE_IDS: ExamTypeId[] = [
  "written",
  "multiple_choice",
  "problem_solving",
  "oral",
  "mixed",
];

export interface ExamPlanSettings {
  id: string;
  title: string;
  examDate: DayKey;
  examType: ExamTypeId;
  gradeScale: GradeScaleId;
  targetGrade: string;
  targetPercent: number;
  dailyMinutes: number;
  /** Bit 0 = Monday … bit 6 = Sunday. */
  restDays: number;
  timeZone: string;
  /** The day the plan was made, in its time zone. Phases are anchored here. */
  startDay: DayKey;
  resultPercent: number | null;
  resultGrade: string | null;
}

export interface ExamMaterialSection {
  id: string;
  title: string;
  cardIds: string[];
  /** Estimated words of note text behind this section. */
  words: number;
}

export interface ExamMaterialNote {
  lectureId: string;
  title: string;
  emoji: string | null;
  /** Study sections in note order. A note with no cards has none. */
  sections: ExamMaterialSection[];
  quizQuestionIds: string[];
  practiceQuestionIds: string[];
  /** Words in the whole note, for reading-time estimates. */
  words: number;
  /** False while the note, or its cards, are still being made, or the note failed. */
  ready: boolean;
}

export interface StudyEvent {
  lectureId: string;
  kind: "flashcard" | "quiz";
  itemId: string;
  /** FSRS grade: 1 again/wrong, 3 good/right, 4 easy. */
  outcome: 1 | 2 | 3 | 4;
  atMs: number;
}

export interface PracticeAnswerEvidence {
  lectureId: string;
  attemptId: string;
  questionId: string | null;
  /** 0–1: the marked score over the question's maximum. */
  score: number;
  atMs: number;
}

export interface ExamEvidence {
  events: StudyEvent[];
  practiceAnswers: PracticeAnswerEvidence[];
  checks: Array<{ day: DayKey; taskKey: string }>;
}

export type JourneyPhase = "learn" | "practice" | "mock" | "final";

export type JourneyTaskKind = "learn" | "review" | "quiz" | "mock" | "explain" | "wind_down";

export type JourneyTaskTab = "notes" | "flashcards" | "quiz" | "test" | "tutor" | "podcast" | "mindmap";

export interface JourneyTask {
  /** Stable for the day; the key manual ticks are stored under. */
  key: string;
  kind: JourneyTaskKind;
  lectureId: string | null;
  noteTitle: string | null;
  noteEmoji: string | null;
  sectionTitle: string | null;
  /** Cards or questions involved, where that is meaningful. */
  count: number;
  minutes: number;
  tab: JourneyTaskTab | null;
  /** Ticked by hand rather than detected from study. */
  manual: boolean;
  /** 0–1, filled in for today only. */
  progress: number;
  done: boolean;
}

export interface JourneyActivity {
  cards: number;
  questions: number;
  tests: number;
}

export type JourneyDayKind = "study" | "rest" | "exam";

export interface JourneyDay {
  day: DayKey;
  kind: JourneyDayKind;
  phase: JourneyPhase | null;
  isToday: boolean;
  isPast: boolean;
  tasks: JourneyTask[];
  minutes: number;
  /** What actually happened, for today and earlier days. */
  activity: JourneyActivity | null;
}

export interface ForecastRange {
  /** 10th, 50th and 90th percentile, in percent. */
  low: number;
  mid: number;
  high: number;
  /** Probability (0–1) of reaching the target percentage. */
  chanceOfTarget: number;
  gradeLow: string;
  gradeMid: string;
  gradeHigh: string;
}

export interface NoteReadiness {
  lectureId: string;
  title: string;
  emoji: string | null;
  /** 0–1 share of the note's material studied at least once. */
  coverage: number;
  /** 0–1 mean recall of the studied material, now. */
  memoryNow: number;
  /** 0–1 projected recall on exam morning if the plan is followed. */
  memoryAtExam: number;
  /** 0–1 first-attempt accuracy, or null with no answers yet. */
  accuracy: number | null;
  answers: number;
}

export interface ExamReadiness {
  /** Whether there is enough first-attempt evidence to show a forecast at all. */
  unlocked: boolean;
  /** Weighted first-attempt answers so far, and how many unlock the forecast. */
  evidence: number;
  evidenceNeeded: number;
  coverage: number;
  memoryNow: number;
  memoryAtExamOnPlan: number;
  memoryAtExamIfStopped: number;
  accuracy: number | null;
  /** If the exam were today. */
  today: ForecastRange;
  /** On exam day, if the plan is followed. */
  onPlan: ForecastRange;
  notes: NoteReadiness[];
}

export interface JourneyFeasibility {
  fits: boolean;
  /** Learn units the plan cannot reach before the exam at this budget. */
  unscheduledSections: number;
  totalSections: number;
  /** Daily minutes that would cover everything, rounded up to 5. */
  recommendedMinutes: number;
}

export type JourneyStatus = "upcoming" | "exam_day" | "finished";

export interface ExamJourney {
  status: JourneyStatus;
  today: DayKey;
  daysLeft: number;
  studyDaysLeft: number;
  phase: JourneyPhase | null;
  phaseEnds: Partial<Record<JourneyPhase, DayKey>>;
  days: JourneyDay[];
  todayPlan: JourneyDay | null;
  readiness: ExamReadiness;
  /** The material as topics with mastery, and the exam's overall mastery (0–100). */
  topics: ExamTopic[];
  mastery: number;
  feasibility: JourneyFeasibility;
  /** Days with any study in the last seven days, and days planned in them. */
  week: { studied: number; planned: number };
  materialPending: number;
}

export interface ExamPlanPayload {
  plan: ExamPlanSettings & {
    lectureIds: string[];
  };
  journey: ExamJourney;
}

/** A note the setup offers to add to an exam. */
export interface ExamNoteOption {
  id: string;
  title: string | null;
  sourceType: string | null;
  status: string;
}

export interface ExamPlanSummary {
  id: string;
  lectureIds: string[];
  title: string;
  examDate: DayKey;
  examType: ExamTypeId;
  gradeScale: GradeScaleId;
  targetGrade: string;
  targetPercent: number;
  noteCount: number;
  status: JourneyStatus;
  daysLeft: number;
  phase: JourneyPhase | null;
  todayDone: number;
  todayTotal: number;
  todayMinutes: number;
  coverage: number;
  /** 0–100, as the Exam tab's ring shows it. */
  mastery: number;
  forecastMid: number | null;
  forecastGrade: string | null;
  resultGrade: string | null;
}
