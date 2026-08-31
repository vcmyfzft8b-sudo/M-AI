import { Suspense } from "react";

import { CreatorHome } from "@/components/creator-demo/creator-home";
import { DashboardLoading } from "@/components/dashboard-loading";
import { toLectureListItems } from "@/lib/creator-demo/build";
import { getCreatorDemoSeed } from "@/lib/creator-demo/server-seed";

/**
 * The student cut of the creator demo. Identical to `/creator` — same library,
 * same shell, same components — apart from the record flow, which the college
 * base path swaps for the live note-writing takeover.
 */
export default function CollegeCreatorDemoHomePage() {
  const seed = getCreatorDemoSeed();

  return (
    <Suspense fallback={<DashboardLoading promoPlaceholder={false} />}>
      <CreatorHome
        initialLectures={toLectureListItems(seed)}
        initialFolders={seed.folders}
      />
    </Suspense>
  );
}
