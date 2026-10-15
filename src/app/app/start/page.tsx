import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { OnboardingPaywall } from "@/components/onboarding-paywall";
import {
  getPricingCountry,
  getSubscriptionTrialEligibility,
  getViewerAppState,
  purchasableBillingPlansFor,
} from "@/lib/billing";
import { isPaywallReason, readPaywallBack } from "@/lib/paywall-reasons";
import { paywallOfferFor, recordSeenReason } from "@/lib/paywall-ladder";
import { readPaywallMoments } from "@/lib/paywall-moments";
import { isNativeUserAgent } from "@/lib/mobile/runtime";

export default async function AppStartPage({
  searchParams,
}: {
  searchParams: Promise<{ for?: string | string[]; back?: string | string[] }>;
}) {
  const query = await searchParams;
  const reason = isPaywallReason(query.for) ? query.for : null;
  const backHref = readPaywallBack(query.back);

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

  // Every paywall moment offers a rung more than the last, and never less; the
  // app keeps Apple's prices, so it always shows the first step
  // (`paywall-ladder.ts`).
  const native = isNativeUserAgent((await headers()).get("user-agent"));
  const seen = native ? [] : await readPaywallMoments(appState.user.id);
  const offerStep = native ? 1 : paywallOfferFor(reason, seen).step;
  // A browsing offer may say it got better only when its moment lifts the price.
  const offerImproved = reason !== null && recordSeenReason(seen, reason).length > seen.length;

  return (
    <main className="app-start-shell">
      <OnboardingPaywall
        profile={appState.profile}
        subscription={appState.subscription}
        onboardingComplete={appState.onboardingComplete}
        hasPaidAccess={appState.hasPaidAccess}
        subscriptionTrialEligible={subscriptionTrialEligible}
        plans={purchasableBillingPlansFor(await getPricingCountry())}
        reason={reason}
        backHref={backHref}
        offerStep={offerStep}
        offerImproved={offerImproved}
      />
    </main>
  );
}
