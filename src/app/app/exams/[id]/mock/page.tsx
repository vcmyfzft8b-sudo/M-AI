import { notFound } from "next/navigation";

import { ExamMock } from "@/components/exams/exam-mock";
import { requireUser } from "@/lib/auth";
import { getViewerAppState } from "@/lib/billing";
import type { ExamMockAttemptRow } from "@/lib/database.types";
import { getExamDetail, mockAttemptExpired, mockResultFromAttempt, openWrittenMockAttempt } from "@/lib/exams/exams-server";
import { getTranslations } from "@/lib/i18n/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { routeIdParamSchema } from "@/lib/validation";

export default async function ExamMockPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ mode?: string }>;
}) {
  const [user, appState, resolved, query, { t }] = await Promise.all([
    requireUser(),
    getViewerAppState(),
    params,
    searchParams ?? Promise.resolve({ mode: undefined }),
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

  /* A written mock left mid-way (a reload, a closed tab) is carried on with, if its time is not up. */
  const { data: openRow } = await supabase
    .from("exam_mock_attempts")
    .select("*")
    .eq("exam_id", detail.exam.id)
    .eq("user_id", user.id)
    .eq("status", "in_progress")
    .eq("mode", "written")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const open = openRow as ExamMockAttemptRow | null;

  return (
    <ExamMock
      openAttempt={open && !mockAttemptExpired(open) ? openWrittenMockAttempt(open) : null}
      examId={detail.exam.id}
      examTitle={detail.exam.title}
      // The mock draws from the exam's notes, so it counts and names notes, not topics.
      moduleCount={new Set(detail.modules.map((module) => module.lectureId)).size}
      target={detail.exam.target_mastery}
      // The path's picker opens the oral mock with `?mode=oral`; anything else is the written one.
      initialMode={query.mode === "oral" ? "oral" : "written"}
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
