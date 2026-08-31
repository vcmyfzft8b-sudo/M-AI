import { SettingsScreen } from "@/components/settings-screen";
import { getViewerAppState } from "@/lib/billing";
import { requireUser } from "@/lib/auth";
import { getTranslations } from "@/lib/i18n/server";
import { formatCalendarDate } from "@/lib/utils";

export default async function SettingsPage() {
  const user = await requireUser();
  const appState = await getViewerAppState();
  const { locale, t } = await getTranslations();
  const email = user.email ?? user.user_metadata.email ?? t("settings.signedInUser");
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
          : t("settings.plan.none")
      }
      planDetail={
        subscription?.current_period_end
          ? t("settings.plan.activeUntil", {
              date: formatCalendarDate(subscription.current_period_end, locale),
            })
          : t("settings.plan.choosePrompt")
      }
    />
  );
}
