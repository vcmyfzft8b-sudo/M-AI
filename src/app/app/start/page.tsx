import { redirect } from "next/navigation";

import { OnboardingPaywall } from "@/components/onboarding-paywall";
import { PURCHASABLE_BILLING_PLANS, getViewerAppState } from "@/lib/billing";
import { getDiscountWheelState } from "@/lib/discount-wheel";

export default async function AppStartPage() {
  const appState = await getViewerAppState();

  if (!appState) {
    redirect("/");
  }

  if (appState.onboardingComplete && appState.hasPaidAccess) {
    redirect("/app");
  }

  // Checkout attaches the wheel's coupon on its own; this only tells the buyer
  // the discount is already waiting for them.
  const wheel = await getDiscountWheelState(appState.user.id);

  return (
    <main className="app-start-shell">
      <OnboardingPaywall
        profile={appState.profile}
        subscription={appState.subscription}
        onboardingComplete={appState.onboardingComplete}
        hasPaidAccess={appState.hasPaidAccess}
        subscriptionTrialEligible={appState.subscriptionTrialEligible}
        plans={PURCHASABLE_BILLING_PLANS}
        discountCouponPending={wheel.hasUnredeemedPrize}
      />
    </main>
  );
}
