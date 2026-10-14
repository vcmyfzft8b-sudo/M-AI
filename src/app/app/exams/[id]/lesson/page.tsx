import { notFound, redirect } from "next/navigation";

import { ExamLesson } from "@/components/exams/exam-lesson";
import { requireUser } from "@/lib/auth";
import { getPaywallPath, getViewerAppState } from "@/lib/billing";
import { isExamLessonKind } from "@/lib/exams/exam-model";
import { getExamDetail } from "@/lib/exams/exams-server";
import { getTranslations } from "@/lib/i18n/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { routeIdParamSchema } from "@/lib/validation";

export default async function ExamLessonPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ lecture?: string; kind?: string }>;
}) {
  const [user, appState, resolved, query, { t }] = await Promise.all([
    requireUser(),
    getViewerAppState(),
    params,
    searchParams ?? Promise.resolve({ lecture: undefined, kind: undefined }),
    getTranslations(),
  ]);
  const parsed = routeIdParamSchema.safeParse(resolved);

  if (!parsed.success || !isExamLessonKind(query.kind) || !query.lecture) {
    notFound();
  }

  const supabase = await createSupabaseServerClient();
  const detail = await getExamDetail(supabase, user.id, parsed.data.id);
  const index = detail?.modules.findIndex((entry) => entry.lectureId === query.lecture) ?? -1;

  if (!detail || index < 0) {
    notFound();
  }

  const current = detail.modules[index];

  if (!appState?.hasPaidAccess && appState?.trialLectureId !== current.lectureId) {
    redirect(getPaywallPath());
  }

  /*
   * After this module the path goes to the next module in order that is not mastered yet (the
   * learner can open it), or, when every other module is mastered, to the mock exam.
   */
  const canOpen = (lectureId: string) => Boolean(appState?.hasPaidAccess) || appState?.trialLectureId === lectureId;
  const others = [...detail.modules.slice(index + 1), ...detail.modules.slice(0, index)];
  const following = others.find((entry) => entry.ready && !entry.mastered && canOpen(entry.lectureId)) ?? null;
  const after = following
    ? {
        type: "module" as const,
        lectureId: following.lectureId,
        title: following.title?.trim() || t("note.untitled"),
        kind: following.nextKind,
      }
    : others.every((entry) => entry.mastered)
      ? { type: "mock" as const }
      : null;

  return (
    <ExamLesson
      examId={detail.exam.id}
      examTitle={detail.exam.title}
      kind={query.kind}
      module={{
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
