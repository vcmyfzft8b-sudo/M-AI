/**
 * The exam's topics, as Astra AI lays out exam prep: the material split into
 * topics, a mastery percentage for each and for the whole exam, and a ladder of
 * steps per topic that ends in mock exams.
 *
 * A topic is one learn unit of the planner (a study section of a note, or a
 * whole note that has no sections), so the topics and the daily plan always
 * agree. Everything is derived from the review log and the learner's ticks:
 * nothing here is stored.
 */
import { recallAt, type MemoryState } from "./fsrs.ts";
import type { MemoryMap } from "./journey.ts";
import type { ExamEvidence, ExamMaterialNote, JourneyTaskTab } from "./model.ts";

export type TopicStepId =
  | "lesson"
  | "podcast"
  | "flashcards"
  | "quiz"
  | "mindmap"
  | "explain"
  | "repetition"
  | "gaps"
  | "oral"
  | "written";

/** The ladder, in order, and the note tool each step opens. */
export const TOPIC_STEPS: ReadonlyArray<{ id: TopicStepId; tab: JourneyTaskTab }> = [
  { id: "lesson", tab: "notes" },
  { id: "podcast", tab: "podcast" },
  { id: "flashcards", tab: "flashcards" },
  { id: "quiz", tab: "quiz" },
  { id: "mindmap", tab: "mindmap" },
  { id: "explain", tab: "tutor" },
  { id: "repetition", tab: "flashcards" },
  { id: "gaps", tab: "quiz" },
  { id: "oral", tab: "tutor" },
  { id: "written", tab: "test" },
];

/**
 * An item is mastered once it has been recalled on two separate reviews and is
 * still above 90% recall now: one right answer can be luck, and a card that
 * has since faded is not mastered any more.
 */
const MASTERED_RECALL = 0.9;
const MASTERED_REVIEWS = 2;
/** What an item seen but not yet mastered counts towards its topic. */
const LEARNING_CREDIT = 0.4;
/** A topic at or above this is mastered, and the next one is the current one. */
export const TOPIC_MASTERED = 85;
/** Quiz answers on the note that count as having done its quiz step. */
const QUIZ_STEP_ANSWERS = 5;

export interface ExamTopicStep {
  id: TopicStepId;
  tab: JourneyTaskTab;
  done: boolean;
  /** 0–1, for steps the app can measure (flashcards, repetition). */
  progress: number;
}

export type ExamTopicState = "mastered" | "current" | "later";

export interface ExamTopic {
  key: string;
  lectureId: string;
  noteTitle: string;
  noteEmoji: string | null;
  /** The section's title, or the note's when the topic is a whole note. */
  title: string;
  /** Cards (or questions) behind the topic; 0 when it can only be read. */
  items: number;
  seen: number;
  mastered: number;
  /** 0–100. */
  mastery: number;
  steps: ExamTopicStep[];
  /** The step to do next: the first open one after the furthest done. */
  currentStep: TopicStepId | null;
  state: ExamTopicState;
}

export interface ExamTopics {
  topics: ExamTopic[];
  /** 0–100 over the whole exam, each topic weighted by its items. */
  mastery: number;
  masteredCount: number;
}

export function topicStepKey(topicKey: string, step: TopicStepId) {
  return `step:${topicKey}:${step}`;
}

function isMastered(state: MemoryState | undefined, nowMs: number) {
  return Boolean(
    state && state.reviews >= MASTERED_REVIEWS && recallAt(state, nowMs) >= MASTERED_RECALL,
  );
}

/** The planner's learn units, as far as topics need them. */
export interface TopicUnit {
  key: string;
  lectureId: string;
  noteTitle: string;
  noteEmoji: string | null;
  sectionTitle: string | null;
  itemKeys: string[];
}

export function buildExamTopics(input: {
  notes: ExamMaterialNote[];
  units: TopicUnit[];
  evidence: ExamEvidence;
  memory: MemoryMap;
  nowMs: number;
}): ExamTopics {
  const { notes, evidence, memory, nowMs } = input;
  const checks = new Set(evidence.checks.map((check) => check.taskKey));
  const noteOrder = new Map(notes.map((note, index) => [note.lectureId, index]));
  const sectionOrder = new Map(
    notes.flatMap((note) => note.sections.map((section, index) => [`${note.lectureId}:${section.id}`, index])),
  );
  // Topics in note order, not the planner's interleaved order: that is how
  // the learner reads their material.
  const units = [...input.units].sort(
    (a, b) =>
      (noteOrder.get(a.lectureId) ?? 0) - (noteOrder.get(b.lectureId) ?? 0) ||
      (sectionOrder.get(a.key) ?? 0) - (sectionOrder.get(b.key) ?? 0),
  );
  const quizAnswersByNote = new Map<string, number>();

  for (const event of evidence.events) {
    if (event.kind === "quiz") {
      quizAnswersByNote.set(event.lectureId, (quizAnswersByNote.get(event.lectureId) ?? 0) + 1);
    }
  }

  const testedNotes = new Set(evidence.practiceAnswers.map((answer) => answer.lectureId));

  const built = units.map((unit) => {
    const states = unit.itemKeys.map((key) => memory.get(key));
    const items = unit.itemKeys.length;
    const seen = states.filter(Boolean).length;
    const mastered = states.filter((state) => isMastered(state, nowMs)).length;
    const repeated = states.filter((state) => (state?.reviews ?? 0) >= MASTERED_REVIEWS).length;
    const ticked = (step: TopicStepId) => checks.has(topicStepKey(unit.key, step));
    const read = ticked("lesson") || checks.has(`learn:${unit.key}`);

    const flashcardsDone = items > 0 && seen === items;
    const repetitionDone = items > 0 && repeated === items;
    const gapsDone = items > 0 && mastered / items >= TOPIC_MASTERED / 100;
    const quizDone =
      ticked("quiz") ||
      (seen > 0 && (quizAnswersByNote.get(unit.lectureId) ?? 0) >= QUIZ_STEP_ANSWERS);

    const done: Record<TopicStepId, boolean> = {
      lesson: read || flashcardsDone,
      podcast: ticked("podcast"),
      flashcards: flashcardsDone || (items === 0 && ticked("flashcards")),
      quiz: quizDone,
      mindmap: ticked("mindmap"),
      explain: ticked("explain"),
      repetition: repetitionDone || (items === 0 && ticked("repetition")),
      gaps: gapsDone || (items === 0 && ticked("gaps")),
      oral: ticked("oral"),
      written: ticked("written") || testedNotes.has(unit.lectureId),
    };
    const progress: Partial<Record<TopicStepId, number>> = {
      flashcards: items > 0 ? seen / items : 0,
      repetition: items > 0 ? repeated / items : 0,
      gaps: items > 0 ? Math.min(1, mastered / items / (TOPIC_MASTERED / 100)) : 0,
    };
    const steps = TOPIC_STEPS.map(({ id, tab }) => ({
      id,
      tab,
      done: done[id],
      progress: done[id] ? 1 : (progress[id] ?? 0),
    }));

    let furthest = -1;
    steps.forEach((step, index) => {
      if (step.done) {
        furthest = index;
      }
    });
    const current =
      steps.find((step, index) => !step.done && index > furthest) ?? steps.find((step) => !step.done) ?? null;

    // A topic with nothing to measure is as mastered as its ladder is climbed.
    const mastery =
      items > 0
        ? Math.round((100 * (mastered + LEARNING_CREDIT * (seen - mastered))) / items)
        : Math.round((100 * steps.filter((step) => step.done).length) / steps.length);

    return {
      key: unit.key,
      lectureId: unit.lectureId,
      noteTitle: unit.noteTitle,
      noteEmoji: unit.noteEmoji,
      title: unit.sectionTitle ?? unit.noteTitle,
      items,
      seen,
      mastered,
      mastery,
      steps,
      currentStep: current?.id ?? null,
    };
  });

  const firstOpen = built.findIndex((topic) => topic.mastery < TOPIC_MASTERED);
  const topics: ExamTopic[] = built.map((topic, index) => ({
    ...topic,
    state: topic.mastery >= TOPIC_MASTERED ? "mastered" : index === firstOpen ? "current" : "later",
  }));
  // Each topic weighs as many items as it has; one that can only be read weighs one.
  const weight = (topic: { items: number }) => Math.max(1, topic.items);
  const totalWeight = built.reduce((sum, topic) => sum + weight(topic), 0);
  const mastery =
    totalWeight > 0
      ? Math.round(built.reduce((sum, topic) => sum + topic.mastery * weight(topic), 0) / totalWeight)
      : 0;

  return {
    topics,
    mastery,
    masteredCount: topics.filter((topic) => topic.state === "mastered").length,
  };
}
