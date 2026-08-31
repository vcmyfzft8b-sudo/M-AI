import { SettingsScreen } from "@/components/settings-screen";
import { getViewerAppState } from "@/lib/billing";
import { requireUser } from "@/lib/auth";
import { formatCalendarDate } from "@/lib/utils";

export default async function SettingsPage() {
  const user = await requireUser();
  const appState = await getViewerAppState();
  const email = user.email ?? user.user_metadata.email ?? "Prijavljen uporabnik";
  const subscription = appState?.subscription ?? null;
  // The badge on the "add to home screen" row comes from the profile rather
  // than from this browser's storage, so opening the guide once answers it on
  // every device this account signs in on.
  const installGuideSeen = Boolean(appState?.profile?.install_guide_seen_at);

  return (
    <SettingsScreen
      email={email}
      hasSubscription={Boolean(subscription)}
      installGuideSeen={installGuideSeen}
      planLabel={
        subscription
          ? `${subscription.plan} (${subscription.status.replaceAll("_", " ")})`
          : "Brez naročnine"
      }
      planDetail={
        subscription?.current_period_end
          ? `Aktivno do ${formatCalendarDate(subscription.current_period_end)}`
          : "Izberi paket za neomejene zapiske in učna orodja."
      }
    />
  );
}
