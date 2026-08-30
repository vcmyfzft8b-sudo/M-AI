import { headers } from "next/headers";

import { HomeDashboard } from "@/components/home-dashboard";
import { getViewerAppState } from "@/lib/billing";
import { getDiscountWheelState } from "@/lib/discount-wheel";
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
  /*
   * The wheel's state is read here rather than from the client.
   *
   * The home screen has one card slot that is either the prize or the plain
   * upgrade, and asking after mount meant neither could be drawn on the first
   * paint — the slot appeared empty and then filled, which reads as the page
   * still loading after it has loaded.
   *
   * Never at the cost of the page, though: a promo card is not worth the home
   * screen, so a failure here answers `null` and the client asks again after
   * mount, exactly as it used to. Paid accounts skip the query entirely — the
   * slot they would fill does not exist for them.
   */
  const [lectures, folders, wheel] = await Promise.all([
    listLecturesForUser(user.id),
    listLibraryFoldersForUser(user.id),
    appState?.hasPaidAccess
      ? Promise.resolve(null)
      : getDiscountWheelState(user.id).catch((error) => {
          console.error("[app] discount wheel state failed", error);
          return null;
        }),
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
      canSpinWheel={wheel ? wheel.canSpin && !wheel.spunToday : null}
      showDevDashboard={showDevDashboard}
    />
  );
}
