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

  const following = detail.modules[index + 1] ?? null;

  return (
    <ExamLesson
      examId={detail.exam.id}
      kind={query.kind}
      module={{
        lectureId: current.lectureId,
        title: current.title?.trim() || t("note.untitled"),
        position: current.position,
        done: current.done,
      }}
      nextModule={
        following && following.ready
          ? { lectureId: following.lectureId, title: following.title?.trim() || t("note.untitled") }
          : null
      }
    />
  );
}
