import { notFound } from "next/navigation";

import { LectureWorkspaceLoader } from "@/components/lecture-workspace-loader";
import { requireUser } from "@/lib/auth";
import { getViewerAppState } from "@/lib/billing";
import { routeIdParamSchema } from "@/lib/validation";

export default async function LecturePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireUser();
  const parsedParams = routeIdParamSchema.safeParse(await params);

  if (!parsedParams.success) {
    notFound();
  }

  const { id } = parsedParams.data;
  const appState = await getViewerAppState();

  return (
    <LectureWorkspaceLoader
      lectureId={id}
      hasPaidAccess={Boolean(appState?.hasPaidAccess)}
      trialLectureId={appState?.trialLectureId ?? null}
      initialTrialChatMessagesRemaining={appState?.trialChatMessagesRemaining ?? 5}
    />
  );
}
