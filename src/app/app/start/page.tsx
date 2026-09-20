import { redirect } from "next/navigation";

import { OnboardingPaywall } from "@/components/onboarding-paywall";
import { PURCHASABLE_BILLING_PLANS, getViewerCheckoutState } from "@/lib/billing";

export default async function AppStartPage() {
  // The survey answered before signing in is claimed by the layout, which has
  // to do it there rather than here: `getViewerAppState` is memoised per
  // request and the layout reads it first, so a claim made at this point would
  // not be visible to the very render that has to act on it.
  const appState = await getViewerCheckoutState();

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
      />
    </main>
  );
}
