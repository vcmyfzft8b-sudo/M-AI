"use client";

import { useSearchParams } from "next/navigation";

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
  const searchParams = useSearchParams();

  /*
   * `?plan=free` shows the demo as somebody who has not paid: the prize wheel,
   * the offer sheet and the upgrade prompts all hang off `hasPaidAccess`, and
   * they are otherwise unreachable here — the demo exists to show the shipping
   * UI, and half of it only exists for people who have not bought yet.
   *
   * Opt-in, and it stays that way. Plain `/creator` is what gets recorded, and
   * a creator's screen should never show a paywall, a discount or an upgrade
   * prompt — it is meant to look like an account that already has everything.
   */
  const isFreePlan = searchParams.get("plan") === "free";

  return (
    <HomeDashboard
      lectures={lectures}
      folders={folders}
      userId={DEMO_USER_ID}
      canCreateNotes={!isFreePlan}
      hasPaidAccess={!isFreePlan}
      trialLectureId={null}
      showDevDashboard={false}
    />
  );
}
