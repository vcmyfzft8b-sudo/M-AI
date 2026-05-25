import { headers } from "next/headers";

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
  const host = (await headers()).get("host") ?? "";
  const showDevDashboard =
    process.env.NODE_ENV !== "production" &&
    (host.startsWith("localhost:") ||
      host.startsWith("127.0.0.1:") ||
      host.startsWith("[::1]:"));
  await searchParams;

  return (
    <HomeDashboard
      lectures={lectures}
      folders={folders}
      userId={user.id}
      canCreateNotes={Boolean(appState?.onboardingComplete && appState?.canCreateNotes)}
      hasPaidAccess={Boolean(appState?.hasPaidAccess)}
      trialLectureId={appState?.trialLectureId ?? null}
      showDevDashboard={showDevDashboard}
    />
  );
}
