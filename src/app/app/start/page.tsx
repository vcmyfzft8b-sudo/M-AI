import { redirect } from "next/navigation";

import { OnboardingPaywall } from "@/components/onboarding-paywall";
import {
  PURCHASABLE_BILLING_PLANS,
  getSubscriptionTrialEligibility,
  getViewerAppState,
} from "@/lib/billing";

export default async function AppStartPage() {
  // The survey answered before signing in is claimed by the layout, which has
  // to do it there rather than here: `getViewerAppState` is memoised per
  // request and the layout reads it first, so a claim made at this point would
  // not be visible to the very render that has to act on it.
  const appState = await getViewerAppState();

  if (!appState) {
    redirect("/");
  }

  if (appState.onboardingComplete && appState.hasPaidAccess) {
    redirect("/app");
  }

  // Somebody still answering the survey sees no price, so the free-trial answer
  // — the one read here that goes to Stripe, and the slowest thing on this page
  // — waits until the paywall is what renders. Finishing the survey refreshes
  // this page, and that render asks.
  const subscriptionTrialEligible = appState.onboardingComplete
    ? await getSubscriptionTrialEligibility(appState.user.id)
    : false;

  return (
    <main className="app-start-shell">
      <OnboardingPaywall
        profile={appState.profile}
        subscription={appState.subscription}
        onboardingComplete={appState.onboardingComplete}
        hasPaidAccess={appState.hasPaidAccess}
        subscriptionTrialEligible={subscriptionTrialEligible}
        plans={PURCHASABLE_BILLING_PLANS}
      />
    </main>
  );
}
