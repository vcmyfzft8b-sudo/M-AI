import type { ExamLessonKind } from "@/lib/exams/exam-model";
import type { MessageKey } from "@/lib/i18n/messages/keys";

export const LESSON_KIND_KEY: Record<ExamLessonKind, MessageKey> = {
  summary: "exam.lesson.kind.summary",
  tutor: "exam.lesson.kind.tutor",
  flashcards: "exam.lesson.kind.flashcards",
  quiz: "exam.lesson.kind.quiz",
  true_false: "exam.lesson.kind.trueFalse",
  written: "exam.lesson.kind.written",
};

/** Each lesson's picture on the study path. */
export const LESSON_KIND_EMOJI: Record<ExamLessonKind, string> = {
  summary: "📖",
  tutor: "🎙️",
  flashcards: "🃏",
  quiz: "❓",
  true_false: "⚖️",
  written: "✍️",
};

/** The library opened on its exam-prep folder: where every prep lives, and where leaving one goes. */
export const EXAM_PREPS_HREF = "/app?view=preps";

/** A lesson of one topic (a module on the path). */
/** A lesson's screen; `check` makes it the topic's check ("Preverjanje"), a longer quiz. */
export function lessonHref(examId: string, topicId: string, kind: ExamLessonKind, check = false) {
  return `/app/exams/${examId}/lesson?topic=${topicId}&kind=${kind}${check ? "&check=1" : ""}`;
}
