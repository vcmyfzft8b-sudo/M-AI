import { notFound } from "next/navigation";

import { ExamJourneyScreen } from "@/components/exam-prep/exam-journey-screen";
import { requireUser } from "@/lib/auth";
import { getExamPlanPayload, isExamPrepUnavailableForUser } from "@/lib/exam-prep/server";
import { routeIdParamSchema } from "@/lib/validation";

export default async function ExamPage({ params }: { params: Promise<{ id: string }> }) {
  const [user, resolved] = await Promise.all([requireUser(), params]);
  const parsed = routeIdParamSchema.safeParse(resolved);

  if (!parsed.success || isExamPrepUnavailableForUser(user.id)) {
    notFound();
  }

  const payload = await getExamPlanPayload(user.id, parsed.data.id);

  if (!payload) {
    notFound();
  }

  return <ExamJourneyScreen planId={parsed.data.id} initialPayload={payload} />;
}
