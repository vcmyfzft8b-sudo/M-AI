import { SettingsScreen } from "@/components/settings-screen";
import { getViewerAppState } from "@/lib/billing";
import { requireUser } from "@/lib/auth";
import type { BillingSubscriptionRow } from "@/lib/database.types";
import { getTranslations } from "@/lib/i18n/server";
import type { MessageKey } from "@/lib/i18n/messages/keys";
import { formatCalendarDate } from "@/lib/utils";

const PLAN_LABEL_KEYS = {
  weekly: "billing.plan.weekly",
  monthly: "billing.plan.monthly",
  yearly: "billing.plan.yearly",
} as const satisfies Record<BillingSubscriptionRow["plan"], MessageKey>;

const SUBSCRIPTION_STATUS_KEYS = {
  incomplete: "settings.subscriptionStatus.incomplete",
  incomplete_expired: "settings.subscriptionStatus.incompleteExpired",
  trialing: "settings.subscriptionStatus.trialing",
  active: "settings.subscriptionStatus.active",
  past_due: "settings.subscriptionStatus.pastDue",
  canceled: "settings.subscriptionStatus.canceled",
  unpaid: "settings.subscriptionStatus.unpaid",
  paused: "settings.subscriptionStatus.paused",
} as const satisfies Record<BillingSubscriptionRow["status"], MessageKey>;

export default async function SettingsPage() {
  const [user, appState, { locale, t }] = await Promise.all([
    requireUser(),
    getViewerAppState(),
    getTranslations(),
  ]);
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
          ? t("settings.plan.summary", {
              plan: t(PLAN_LABEL_KEYS[subscription.plan]),
              status: t(SUBSCRIPTION_STATUS_KEYS[subscription.status]),
            })
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
