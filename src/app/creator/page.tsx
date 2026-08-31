import { Suspense } from "react";

import { CreatorHome } from "@/components/creator-demo/creator-home";
import { DashboardLoading } from "@/components/dashboard-loading";
import { toLectureListItems } from "@/lib/creator-demo/build";
import { getCreatorDemoSeed } from "@/lib/creator-demo/server-seed";

export default function CreatorDemoHomePage() {
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
