import type { ExamLessonKind } from "@/lib/exams/exam-model";

/*
 * The tutor lesson is planned by a model call on every open (3–20 s). The screen before it (the
 * topic's summary, or the exam path when the tutor is the next step) asks for it in the background,
 * so by the time the learner taps it the plan is usually there. A prefetched answer is used once,
 * by the next open of that lesson in this tab, and only while it is fresh; anything else loads as
 * before. Kept in memory: a client navigation keeps it, a reload starts over.
 */

type Prefetched = { at: number; answer: Promise<{ status: number; body: unknown } | null> };

const FRESH_MS = 10 * 60 * 1000;
const prefetched = new Map<string, Prefetched>();

const keyOf = (examId: string, topicId: string, kind: ExamLessonKind) => `${examId}:${topicId}:${kind}`;

export function lessonUrl(examId: string, topicId: string, kind: ExamLessonKind) {
  return `/api/exams/${examId}/lesson?topicId=${topicId}&kind=${kind}`;
}

/** Starts loading a lesson ahead of time, once; a second call for the same lesson does nothing. */
export function prefetchLesson(examId: string, topicId: string, kind: ExamLessonKind) {
  const key = keyOf(examId, topicId, kind);
  const current = prefetched.get(key);

  if (current && Date.now() - current.at < FRESH_MS) {
    return;
  }

  const answer = fetch(lessonUrl(examId, topicId, kind), { cache: "no-store" })
    .then(async (response) => ({ status: response.status, body: await response.json().catch(() => null) }))
    .catch(() => null);
  prefetched.set(key, { at: Date.now(), answer });
}

/** The prefetched answer for a lesson, taken (so it is used once), or null when there is none. */
export async function takePrefetchedLesson(examId: string, topicId: string, kind: ExamLessonKind) {
  const key = keyOf(examId, topicId, kind);
  const entry = prefetched.get(key);
  prefetched.delete(key);

  if (!entry || Date.now() - entry.at >= FRESH_MS) {
    return null;
  }

  const answer = await entry.answer;
  // Only a lesson that is ready is worth using; anything else is asked again, as it would have been.
  return answer && answer.status === 200 && (answer.body as { status?: string } | null)?.status === "ready"
    ? answer
    : null;
}
