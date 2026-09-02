import { redirect } from "next/navigation";

import { OnboardingPaywall } from "@/components/onboarding-paywall";
import { PURCHASABLE_BILLING_PLANS, getViewerCheckoutState } from "@/lib/billing";
import { resolveGiveawayReferral } from "@/lib/giveaway";

export default async function AppStartPage() {
  const appState = await getViewerCheckoutState();

  if (!appState) {
    redirect("/");
  }

  if (appState.onboardingComplete && appState.hasPaidAccess) {
    redirect("/app");
  }

  // A friend's giveaway code, if one came in with this visitor. Checkout
  // applies it on its own; the paywall only has to say that it will.
  const referral = await resolveGiveawayReferral(appState.user.id).catch(() => null);

  return (
    <main className="app-start-shell">
      <OnboardingPaywall
        profile={appState.profile}
        subscription={appState.subscription}
        onboardingComplete={appState.onboardingComplete}
        hasPaidAccess={appState.hasPaidAccess}
        subscriptionTrialEligible={appState.subscriptionTrialEligible}
        plans={PURCHASABLE_BILLING_PLANS}
        referral={referral ? { code: referral.code, referrerName: referral.referrerName } : null}
      />
    </main>
  );
}
