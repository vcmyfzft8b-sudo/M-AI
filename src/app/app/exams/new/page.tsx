import { ExamSetup } from "@/components/exams/exam-setup";
import { requireUser } from "@/lib/auth";
import { getViewerAppState } from "@/lib/billing";
import { dayKey } from "@/lib/exams/exam-model";
import { listLibraryFoldersForUser } from "@/lib/library-folders";
import { listLecturesForUser } from "@/lib/lectures";

/** The onboarding's daily goal, in the minutes its label promises. */
const GOAL_MINUTES: Record<string, number> = {
  casual: 10,
  regular: 20,
  serious: 60,
  intensive: 90,
};

export default async function NewExamPage({
  searchParams,
}: {
  searchParams?: Promise<{ folder?: string }>;
}) {
  const [user, appState, params] = await Promise.all([
    requireUser(),
    getViewerAppState(),
    searchParams ?? Promise.resolve({ folder: undefined }),
  ]);
  const [lectures, folders] = await Promise.all([
    listLecturesForUser(user.id),
    listLibraryFoldersForUser(user.id),
  ]);
  const hasPaidAccess = Boolean(appState?.hasPaidAccess);
  const trialLectureId = appState?.trialLectureId ?? null;
  // Without a plan only the free note can be studied, so only it is offered.
  const notes = lectures
    .filter((lecture) => hasPaidAccess || lecture.id === trialLectureId)
    .map((lecture) => ({
      id: lecture.id,
      title: lecture.title,
      emoji: lecture.emoji,
      ready: lecture.status === "ready",
    }));
  const noteIds = new Set(notes.map((note) => note.id));
  const lockedCount = lectures.length - notes.length;
  const goal = appState?.profile?.onboarding_daily_goal ?? null;

  return (
    <ExamSetup
      notes={notes}
      folders={folders
        .map((folder) => ({
          id: folder.id,
          name: folder.name,
          lectureIds: folder.lectureIds.filter((id) => noteIds.has(id)),
        }))
        .filter((folder) => folder.lectureIds.length > 0)}
      today={dayKey(new Date())}
      initialFolderId={params.folder ?? null}
      defaultMinutes={(goal && GOAL_MINUTES[goal]) || 30}
      lockedCount={lockedCount}
      canCreateNotes={Boolean(appState?.onboardingComplete && appState?.canCreateNotes)}
    />
  );
}
