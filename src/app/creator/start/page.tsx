import { OnboardingPaywall } from "@/components/onboarding-paywall";
import { getPricingCountry, purchasableBillingPlansFor } from "@/lib/billing";
import { isPaywallReason, readPaywallBack } from "@/lib/paywall-reasons";

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
 * visible error than a fake success. Prices are the visitor's own, as on the
 * real screen (`billing-regions.ts`). `?for=` shows each feature's version of it,
 * and `?step=` each rung of the offer ladder (`paywall-ladder.ts`).
 */
export default async function CreatorDemoStartPage({
  searchParams,
}: {
  searchParams: Promise<{ for?: string | string[]; back?: string | string[]; step?: string | string[] }>;
}) {
  const query = await searchParams;

  return (
    <main className="app-start-shell">
      <OnboardingPaywall
        profile={null}
        subscription={null}
        onboardingComplete
        hasPaidAccess={false}
        plans={purchasableBillingPlansFor(await getPricingCountry())}
        reason={isPaywallReason(query.for) ? query.for : null}
        backHref={readPaywallBack(query.back) ?? "/creator"}
        offerStep={typeof query.step === "string" ? Number.parseInt(query.step, 10) || 1 : 1}
      />
    </main>
  );
}
