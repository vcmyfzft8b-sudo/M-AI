import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { WindowFileDropGuard } from "@/components/window-file-drop-guard";
import { AppShell } from "@/components/app-shell";
import { ImpersonationBannerSlot } from "@/components/impersonation-banner-slot";
import { NavigationFeedbackProvider } from "@/components/navigation-loading";
import { getViewerAppState } from "@/lib/billing";
import { requireUser } from "@/lib/auth";
import { readActiveTestPersona } from "@/lib/test-persona-server";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [, appState, headerStore] = await Promise.all([
    requireUser(),
    getViewerAppState(),
    headers(),
  ]);
  const pathname = headerStore.get("x-pathname") ?? "/app";

  if (appState && !appState.onboardingComplete && pathname !== "/app/start") {
    /*
     * Settings is the one exception, and only ever for the one account that can
     * hold a test persona.
     *
     * "Not onboarded" is a state you can be put into deliberately, and the
     * switch that puts you there lives in Settings — which this redirect would
     * otherwise make unreachable, leaving the survey as the only screen the
     * account can open and no way back out of it. The redirect is what real
     * users get, unchanged; a persona simply cannot be a door that locks
     * behind you.
     */
    const trapped = pathname === "/app/settings" && (await readActiveTestPersona());

    if (!trapped) {
      redirect("/app/start");
    }
  }

  if (
    appState?.onboardingComplete &&
    appState.hasPaidAccess &&
    pathname === "/app/start"
  ) {
    redirect("/app");
  }

  return (
    <NavigationFeedbackProvider>
      <WindowFileDropGuard />
      <AppShell
        hasPaidAccess={Boolean(appState?.hasPaidAccess)}
        initialPathname={pathname}
      >
        {children}
      </AppShell>
      <ImpersonationBannerSlot />
    </NavigationFeedbackProvider>
  );
}
