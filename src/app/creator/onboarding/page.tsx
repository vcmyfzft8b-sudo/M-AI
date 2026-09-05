import { OnboardingFlow } from "@/components/onboarding-flow";

/**
 * The interactive onboarding, on the demo.
 *
 * The real flow only exists behind a brand-new account that has not answered
 * it yet, which makes the first thing every user sees the hardest screen on
 * the site to look at twice. This mounts the same component with `demo` set,
 * so every step, animation and try-it works and nothing is written to a
 * profile — the last screen's button simply stops rather than moving on to
 * the paywall.
 */
export default function CreatorDemoOnboardingPage() {
  return <OnboardingFlow demo />;
}
