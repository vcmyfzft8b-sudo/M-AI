import { ExamBuilderScreen } from "@/components/exam-prep/exam-builder-screen";
import { requireUser } from "@/lib/auth";
import { getViewerAppState } from "@/lib/billing";
import { listLecturesForUser } from "@/lib/lectures";
import { uuidSchema } from "@/lib/validation";

export default async function NewExamPage({
  searchParams,
}: {
  searchParams: Promise<{ lecture?: string | string[] }>;
}) {
  const [user, appState, query] = await Promise.all([
    requireUser(),
    getViewerAppState(),
    searchParams,
  ]);
  const lectures = await listLecturesForUser(user.id);
  const preselect =
    typeof query.lecture === "string" && uuidSchema.safeParse(query.lecture).success
      ? query.lecture
      : null;

  return (
    <ExamBuilderScreen
      mode="create"
      lectures={lectures}
      hasPaidAccess={Boolean(appState?.hasPaidAccess)}
      trialLectureId={appState?.trialLectureId ?? null}
      defaultScale={appState?.profile?.onboarding_grade_scale === 5 ? "five_point" : "ten_point"}
      preselectLectureId={lectures.some((lecture) => lecture.id === preselect) ? preselect : null}
    />
  );
}
