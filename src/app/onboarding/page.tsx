import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { OnboardingFlow } from "@/components/onboarding-flow";
import { getOptionalUserOrPreviewBypass } from "@/lib/auth";
import { getViewerCheckoutState } from "@/lib/billing";
import { hasSeenOnboarding } from "@/lib/onboarding-anonymous";
import { isNativeUserAgent } from "@/lib/mobile/runtime";
import { hasPublicSupabaseEnv } from "@/lib/public-env";

/**
 * The survey, in front of the sign-in wall.
 *
 * This is the door the landing page's "Try it for €0" opens, and the one the
 * iOS app opens on a fresh install. It has to be right for four different
 * people arriving at the same URL, so it decides rather than assumes:
 *
 *   signed in, already onboarded   → the app; they have done this
 *   signed in, not onboarded       → the survey, saved to their profile
 *   signed out, been here before   → sign-in; do not ask it all again
 *   signed out, first time         → the survey, saved anonymously
 *
 * The third case is what makes the app's start URL safe to point here: a
 * returning reader who signed out still lands on sign-in, not on twenty-three
 * questions they already answered.
 */

export const metadata: Metadata = {
  title: "Memo AI",
  // A funnel step, not a landing page. Nothing here should rank.
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  if (hasPublicSupabaseEnv) {
    const user = await getOptionalUserOrPreviewBypass();
    if (user) {
      const appState = await getViewerCheckoutState();
      // Already answered: `/app/start` is the screen that decides what comes
      // after, and it will not send them back here.
      if (appState?.onboardingComplete) redirect("/app/start");
      return (
        <main className="app-start-shell">
          <OnboardingFlow profile={appState?.profile ?? null} />
        </main>
      );
    }
  }

  if (await hasSeenOnboarding()) redirect("/auth/continue");

  // The arrow goes back to the landing page they pressed "Try it for €0" on.
  // The app has no landing page — the wrapper rewrites `/` to this screen — so
  // there it stays where it was, which is off.
  const native = isNativeUserAgent((await headers()).get("user-agent"));

  return (
    <main className="app-start-shell">
      <OnboardingFlow anonymous backHref={native ? undefined : "/"} />
    </main>
  );
}
