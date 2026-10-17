import { notFound } from "next/navigation";

import { ExamDashboard } from "@/components/exams/exam-dashboard";
import { requireUser } from "@/lib/auth";
import { getViewerAppState } from "@/lib/billing";
import { getExamDetail } from "@/lib/exams/exams-server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { routeIdParamSchema } from "@/lib/validation";

export default async function ExamPage({ params }: { params: Promise<{ id: string }> }) {
  const [user, appState, resolved] = await Promise.all([requireUser(), getViewerAppState(), params]);
  const parsed = routeIdParamSchema.safeParse(resolved);

  if (!parsed.success) {
    notFound();
  }

  const supabase = await createSupabaseServerClient();
  const detail = await getExamDetail(supabase, user.id, parsed.data.id);

  if (!detail) {
    notFound();
  }

  return (
    <ExamDashboard
      detail={detail}
      hasPaidAccess={Boolean(appState?.hasPaidAccess)}
      trialLectureId={appState?.trialLectureId ?? null}
    />
  );
}
