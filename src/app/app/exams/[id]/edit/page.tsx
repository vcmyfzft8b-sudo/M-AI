import { notFound } from "next/navigation";

import { ExamBuilderScreen } from "@/components/exam-prep/exam-builder-screen";
import { requireUser } from "@/lib/auth";
import { getViewerAppState } from "@/lib/billing";
import { getExamPlanPayload, isExamPrepUnavailableForUser } from "@/lib/exam-prep/server";
import { listLecturesForUser } from "@/lib/lectures";
import { routeIdParamSchema } from "@/lib/validation";

export default async function EditExamPage({ params }: { params: Promise<{ id: string }> }) {
  const [user, resolved, appState] = await Promise.all([
    requireUser(),
    params,
    getViewerAppState(),
  ]);
  const parsed = routeIdParamSchema.safeParse(resolved);

  if (!parsed.success || isExamPrepUnavailableForUser(user.id)) {
    notFound();
  }

  const [payload, lectures] = await Promise.all([
    getExamPlanPayload(user.id, parsed.data.id),
    listLecturesForUser(user.id),
  ]);

  if (!payload) {
    notFound();
  }

  return (
    <ExamBuilderScreen
      mode="edit"
      lectures={lectures}
      hasPaidAccess={Boolean(appState?.hasPaidAccess)}
      trialLectureId={appState?.trialLectureId ?? null}
      initialPlan={payload.plan}
    />
  );
}
