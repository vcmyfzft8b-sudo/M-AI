"use client";

import {
  useCreatorDemoFolders,
  useCreatorDemoLectures,
} from "@/components/creator-demo/creator-demo-provider";
import { HomeDashboard } from "@/components/home-dashboard";
import { DEMO_USER_ID } from "@/lib/creator-demo/build";
import type { AppLectureListItem, AppLibraryFolder } from "@/lib/types";

export function CreatorHome({
  initialLectures,
  initialFolders,
}: {
  initialLectures: AppLectureListItem[];
  initialFolders: AppLibraryFolder[];
}) {
  const lectures = useCreatorDemoLectures(initialLectures);
  const folders = useCreatorDemoFolders(initialFolders);

  return (
    <HomeDashboard
      lectures={lectures}
      folders={folders}
      userId={DEMO_USER_ID}
      canCreateNotes
      hasPaidAccess
      trialLectureId={null}
      showDevDashboard={false}
    />
  );
}
