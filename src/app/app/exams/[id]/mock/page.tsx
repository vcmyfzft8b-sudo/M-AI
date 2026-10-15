import { notFound } from "next/navigation";

import { ExamMock } from "@/components/exams/exam-mock";
import { requireUser } from "@/lib/auth";
import { getViewerAppState } from "@/lib/billing";
import type { ExamMockAttemptRow } from "@/lib/database.types";
import { getExamDetail, mockResultFromAttempt } from "@/lib/exams/exams-server";
import { getTranslations } from "@/lib/i18n/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { routeIdParamSchema } from "@/lib/validation";

export default async function ExamMockPage({ params }: { params: Promise<{ id: string }> }) {
  const [user, appState, resolved, { t }] = await Promise.all([
    requireUser(),
    getViewerAppState(),
    params,
    getTranslations(),
  ]);
  const parsed = routeIdParamSchema.safeParse(resolved);

  if (!parsed.success) {
    notFound();
  }

  const supabase = await createSupabaseServerClient();
  const detail = await getExamDetail(supabase, user.id, parsed.data.id);

  if (!detail) {
    notFound();
  }

  const { data: lastAttempt } = await supabase
    .from("exam_mock_attempts")
    .select("*")
    .eq("exam_id", detail.exam.id)
    .eq("user_id", user.id)
    .eq("status", "graded")
    .order("graded_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (
    <ExamMock
      examId={detail.exam.id}
      examTitle={detail.exam.title}
      // The mock draws from the exam's notes, so it counts and names notes, not topics.
      moduleCount={new Set(detail.modules.map((module) => module.lectureId)).size}
      passPercentage={detail.exam.pass_percentage}
      hasPaidAccess={Boolean(appState?.hasPaidAccess)}
      moduleTitles={Object.fromEntries(
        detail.modules.map((module) => [module.lectureId, module.noteTitle?.trim() || t("note.untitled")]),
      )}
      lastResult={
        lastAttempt ? mockResultFromAttempt(detail.exam, lastAttempt as ExamMockAttemptRow) : null
      }
    />
  );
}
