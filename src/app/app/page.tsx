import { HomeDashboard } from "@/components/home-dashboard";
import { getViewerAppState } from "@/lib/billing";
import { requireUser } from "@/lib/auth";
import { listLibraryFoldersForUser } from "@/lib/library-folders";
import { listLecturesForUser } from "@/lib/lectures";

type SearchParams = Promise<{
  mode?: string;
}>;

export default async function AppHomePage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const appState = await getViewerAppState();
  const user = appState?.user ?? (await requireUser());
  const [lectures, folders] = await Promise.all([
    listLecturesForUser(user.id),
    listLibraryFoldersForUser(user.id),
  ]);
  await searchParams;

  return (
    <HomeDashboard
      lectures={lectures}
      folders={folders}
      userId={user.id}
      canCreateNotes={Boolean(appState?.onboardingComplete && appState?.canCreateNotes)}
      hasPaidAccess={Boolean(appState?.hasPaidAccess)}
    />
  );
}
