import { notFound, redirect } from "next/navigation";

import { LectureWorkspace } from "@/components/lecture-workspace";
import { OfflineLectureCapture } from "@/components/offline/offline-capture";
import { requireUser } from "@/lib/auth";
import { getPaywallPath, getViewerAppState } from "@/lib/billing";
import { ensureUserOwnsLecture, getLectureDetailForUser } from "@/lib/lectures";
import { routeIdParamSchema } from "@/lib/validation";

export default async function LecturePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [user, resolvedParams, appState] = await Promise.all([
    requireUser(),
    params,
    getViewerAppState(),
  ]);
  const parsedParams = routeIdParamSchema.safeParse(resolvedParams);

  if (!parsedParams.success) {
    notFound();
  }

  const { id } = parsedParams.data;
  const lecture = await ensureUserOwnsLecture({
    lectureId: id,
    user,
  });

  if (!lecture) {
    notFound();
  }

  if (!appState?.hasPaidAccess && appState?.trialLectureId !== id) {
    redirect(getPaywallPath());
  }

  const detail = await getLectureDetailForUser({
    lectureId: id,
    userId: user.id,
    verifiedLecture: lecture,
  });

  if (!detail) {
    notFound();
  }

  return (
    <>
      {/* Saves this note for reading with no connection. See offline-capture.tsx. */}
      <OfflineLectureCapture
        userId={user.id}
        detail={detail}
        hasPaidAccess={Boolean(appState?.hasPaidAccess)}
        trialLectureId={appState?.trialLectureId ?? null}
      />
      <LectureWorkspace
        initialDetail={detail}
        hasPaidAccess={Boolean(appState?.hasPaidAccess)}
        trialLectureId={appState?.trialLectureId ?? null}
        initialTrialChatMessagesRemaining={appState?.trialChatMessagesRemaining ?? 5}
      />
    </>
  );
}
