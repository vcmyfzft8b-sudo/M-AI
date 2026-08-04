import { redirect } from "next/navigation";

import { OnboardingPaywall } from "@/components/onboarding-paywall";
import { DeleteAccountButton } from "@/components/delete-account-button";
import { LogoutForm } from "@/components/logout-form";
import { PURCHASABLE_BILLING_PLANS, getViewerAppState } from "@/lib/billing";
import { isIOSWebWrapperRequest } from "@/lib/ios-web-wrapper";

export default async function AppStartPage() {
  const appState = await getViewerAppState();
  const isIOSWebWrapper = await isIOSWebWrapperRequest();

  if (!appState) {
    redirect("/");
  }

  if (appState.onboardingComplete && appState.hasPaidAccess) {
    redirect("/app");
  }

  if (isIOSWebWrapper) {
    return (
      <main className="app-start-shell">
        <section className="dashboard-surface-card ios-companion-card">
          <p className="dashboard-overline">Memo AI za iOS</p>
          <h1 className="dashboard-page-title">Potreben je aktiven dostop</h1>
          <p className="ios-row-subtitle">
            Prijavi se z računom, ki že ima aktiven dostop do Memo AI. Nakupa naročnine
            v tej različici aplikacije ni mogoče opraviti.
          </p>
          <div className="ios-companion-actions">
            <LogoutForm />
            <DeleteAccountButton />
          </div>
        </section>
      </main>
    );
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
