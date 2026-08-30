import { OnboardingPaywall } from "@/components/onboarding-paywall";
import { PURCHASABLE_BILLING_PLANS } from "@/lib/billing";

/**
 * The upgrade screen, on the demo.
 *
 * `/app/start` is behind an account that has not paid, which makes the one
 * screen nobody on the team can easily open the one the whole business runs
 * through. This mounts the same component against demo props so it can be
 * looked at and worked on like every other screen here.
 *
 * Checkout still posts to the real endpoint and will fail without an account,
 * which is the honest behaviour for a demo of a payment screen — better a
 * visible error than a fake success.
 */
export default function CreatorDemoStartPage() {
  return (
    <main className="app-start-shell">
      <OnboardingPaywall
        profile={null}
        subscription={null}
        onboardingComplete
        hasPaidAccess={false}
        plans={PURCHASABLE_BILLING_PLANS}
      />
    </main>
  );
}
