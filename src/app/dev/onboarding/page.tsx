import { notFound } from "next/navigation";

import { OnboardingPaywall } from "@/components/onboarding-paywall";
import { BILLING_PLANS } from "@/lib/billing";

export default function DevOnboardingPreviewPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  return (
    <main className="app-start-shell">
      <OnboardingPaywall
        profile={null}
        subscription={null}
        onboardingComplete={false}
        hasPaidAccess={false}
        plans={Object.values(BILLING_PLANS)}
        devPreview
      />
    </main>
  );
}
