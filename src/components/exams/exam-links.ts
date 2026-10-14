import type { ExamLessonKind } from "@/lib/exams/exam-model";
import type { MessageKey } from "@/lib/i18n/messages/keys";

export const LESSON_KIND_KEY: Record<ExamLessonKind, MessageKey> = {
  summary: "exam.lesson.kind.summary",
  flashcards: "exam.lesson.kind.flashcards",
  quiz: "exam.lesson.kind.quiz",
  true_false: "exam.lesson.kind.trueFalse",
  written: "exam.lesson.kind.written",
};

export function lessonHref(examId: string, lectureId: string, kind: ExamLessonKind) {
  return `/app/exams/${examId}/lesson?lecture=${lectureId}&kind=${kind}`;
}
