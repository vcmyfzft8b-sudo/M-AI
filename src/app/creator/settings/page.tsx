import { SettingsScreen } from "@/components/settings-screen";

/**
 * The demo runs the real settings screen so recordings show the shipping UI.
 * The demo has no account, so logging out resets the demo library instead.
 */
export default function CreatorDemoSettingsPage() {
  return (
    <SettingsScreen
      email="demo@memoai.eu"
      hasSubscription={false}
      planLabel="Letni paket (aktiven)"
      planDetail="Demo račun za snemanje – plačila niso vključena."
      isDemo
    />
  );
}
