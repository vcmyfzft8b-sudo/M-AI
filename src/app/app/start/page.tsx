import { redirect } from "next/navigation";
import { headers } from "next/headers";

import { OnboardingPaywall } from "@/components/onboarding-paywall";
import { PURCHASABLE_BILLING_PLANS, getViewerAppState } from "@/lib/billing";
import { isMemoIosAppUserAgent } from "@/lib/native-platform";

export default async function AppStartPage() {
  const requestHeaders = await headers();
  const appState = await getViewerAppState();
  const commerceMode = isMemoIosAppUserAgent(requestHeaders.get("user-agent"))
    ? "ios-app"
    : "web";

  if (!appState) {
    redirect("/");
  }

  if (appState.onboardingComplete && appState.hasPaidAccess) {
    redirect("/app");
  }

  return (
    <main className="app-start-shell">
      <OnboardingPaywall
        profile={appState.profile}
        subscription={appState.subscription}
        onboardingComplete={appState.onboardingComplete}
        hasPaidAccess={appState.hasPaidAccess}
        subscriptionTrialEligible={appState.subscriptionTrialEligible}
        plans={PURCHASABLE_BILLING_PLANS}
        commerceMode={commerceMode}
        appAccountToken={appState.user.id}
      />
    </main>
  );
}
