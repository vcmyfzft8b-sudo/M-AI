import { SettingsScreen } from "@/components/settings-screen";
import { getTranslations } from "@/lib/i18n/server";

/**
 * The demo runs the real settings screen so recordings show the shipping UI.
 * The demo has no account, so logging out resets the demo library instead.
 */
export default async function CreatorDemoSettingsPage() {
  const { t } = await getTranslations();

  return (
    <SettingsScreen
      email="demo@memoai.eu"
      hasSubscription={false}
      planLabel={t("creator.demoPlanLabel")}
      planDetail={t("creator.demoPlanDetail")}
      isDemo
    />
  );
}
