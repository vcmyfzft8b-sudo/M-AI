import { notFound, redirect } from "next/navigation";

import { ExamLesson } from "@/components/exams/exam-lesson";
import { lessonHref } from "@/components/exams/exam-links";
import { requireUser } from "@/lib/auth";
import { getViewerAppState } from "@/lib/billing";
import { isExamLessonKind, reachableModules, suggestedKind } from "@/lib/exams/exam-model";
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
  searchParams?: Promise<{ topic?: string; kind?: string; check?: string }>;
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

  // A module the path has not reached yet (the one before it is not on target) is not studied by link.
  // Reached as the path reaches it, so a module past one the account cannot open is not refused.
  const canOpen = (lectureId: string) => Boolean(appState?.hasPaidAccess) || appState?.trialLectureId === lectureId;

  if (!reachableModules(detail.modules, canOpen)[index]) {
    redirect(`/app/exams/${detail.exam.id}`);
  }

  if (!appState?.hasPaidAccess && appState?.trialLectureId !== current.lectureId) {
    redirect(paywallPath("exam", `/app/exams/${detail.exam.id}`));
  }

  /*
   * What takes a tutor lesson's place when there is no talking time: the topic's next lesson as the
   * path would choose it without the tutor. Opening the tutor then simply opens that.
   */
  const instead = suggestedKind({
    done: current.done,
    lessons: current.lessons,
    failedToday: current.failedToday,
    gapKind: current.gapKind,
    tutor: false,
  });

  if (query.kind === "tutor" && !detail.tutorAvailable) {
    redirect(lessonHref(detail.exam.id, current.topicId, instead));
  }

  return (
    <ExamLesson
      examId={detail.exam.id}
      examTitle={detail.exam.title}
      kind={query.kind}
      check={query.check === "1"}
      module={{
        topicId: current.topicId,
        lectureId: current.lectureId,
        title: current.title?.trim() || t("note.untitled"),
        position: current.position,
        mastery: current.mastery,
        rawMastery: current.rawMastery,
        perfectRun: current.perfectRun,
      }}
      target={detail.exam.target_mastery}
      instead={instead}
    />
  );
}
