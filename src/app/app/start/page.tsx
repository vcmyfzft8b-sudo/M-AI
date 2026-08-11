import { redirect } from "next/navigation";

import { OnboardingPaywall } from "@/components/onboarding-paywall";
import { PURCHASABLE_BILLING_PLANS, getViewerAppState } from "@/lib/billing";
import { isNativeAppRequest } from "@/lib/native-app";

export default async function AppStartPage() {
  const appState = await getViewerAppState();
  // Guideline 3.1.1 — no purchase surface inside the iOS app.
  const allowPurchases = !(await isNativeAppRequest());

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
        allowPurchases={allowPurchases}
      />
    </main>
  );
}
