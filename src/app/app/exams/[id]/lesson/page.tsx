import { notFound, redirect } from "next/navigation";

import { ExamLesson } from "@/components/exams/exam-lesson";
import { requireUser } from "@/lib/auth";
import { getViewerAppState } from "@/lib/billing";
import { examNextStep, isExamLessonKind } from "@/lib/exams/exam-model";
import { getExamDetail } from "@/lib/exams/exams-server";
import { getTranslations } from "@/lib/i18n/server";
import { paywallPath } from "@/lib/paywall-reasons";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { routeIdParamSchema } from "@/lib/validation";

export default async function ExamLessonPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ topic?: string; kind?: string }>;
}) {
  const [user, appState, resolved, query, { t }] = await Promise.all([
    requireUser(),
    getViewerAppState(),
    params,
    searchParams ?? Promise.resolve({ topic: undefined, kind: undefined }),
    getTranslations(),
  ]);
  const parsed = routeIdParamSchema.safeParse(resolved);

  if (!parsed.success || !isExamLessonKind(query.kind) || !query.topic) {
    notFound();
  }

  const supabase = await createSupabaseServerClient();
  const detail = await getExamDetail(supabase, user.id, parsed.data.id);
  const index = detail?.modules.findIndex((entry) => entry.topicId === query.topic) ?? -1;

  if (!detail || index < 0 || detail.modules[index].pending) {
    notFound();
  }

  // An archived exam takes no more lessons; its screen offers to bring it back.
  if (detail.exam.archived_at) {
    redirect(`/app/exams/${detail.exam.id}`);
  }

  const current = detail.modules[index];

  if (!appState?.hasPaidAccess && appState?.trialLectureId !== current.lectureId) {
    redirect(paywallPath("exam", `/app/exams/${detail.exam.id}`));
  }

  /*
   * After this lesson the path's own next step (`examNextStep`), looked at as if this module were
   * done: the next module it would open, or the mock exam once the plan is at that stage.
   */
  const canOpen = (lectureId: string) => Boolean(appState?.hasPaidAccess) || appState?.trialLectureId === lectureId;
  const others = detail.modules.filter((_, position) => position !== index);
  const step = examNextStep(others, detail.stage, canOpen);
  const following = step?.type === "lesson" ? others.find((entry) => entry.topicId === step.topicId) ?? null : null;
  const after = following && step?.type === "lesson"
    ? {
        type: "module" as const,
        topicId: following.topicId,
        title: following.title?.trim() || t("note.untitled"),
        kind: step.kind,
      }
    : step?.type === "mock" || (step === null && others.every((entry) => entry.mastered))
      ? { type: "mock" as const }
      : null;

  return (
    <ExamLesson
      examId={detail.exam.id}
      examTitle={detail.exam.title}
      kind={query.kind}
      module={{
        topicId: current.topicId,
        lectureId: current.lectureId,
        title: current.title?.trim() || t("note.untitled"),
        position: current.position,
        done: current.done,
        latest: current.latest,
        review: current.review,
        learned: current.learned,
        mastered: current.mastered,
      }}
      target={detail.exam.target_mastery}
      after={after}
    />
  );
}
