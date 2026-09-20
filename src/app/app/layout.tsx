import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { WindowFileDropGuard } from "@/components/window-file-drop-guard";
import { AppShell } from "@/components/app-shell";
import { ImpersonationBannerSlot } from "@/components/impersonation-banner-slot";
import { NavigationFeedbackProvider } from "@/components/navigation-loading";
import { OfflineProvider } from "@/components/offline/offline-provider";
import { getViewerAppState } from "@/lib/billing";
import { PREVIEW_AUTH_BYPASS_USER_ID, requireUser } from "@/lib/auth";
import { readActiveTestPersona } from "@/lib/test-persona-server";
import { isNativeUserAgent } from "@/lib/mobile/runtime";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [user, appState, headerStore] = await Promise.all([
    requireUser(),
    getViewerAppState(),
    headers(),
  ]);
  const pathname = headerStore.get("x-pathname") ?? "/app";
  const native = isNativeUserAgent(headerStore.get("user-agent"));
  const nativeAccountPage = native && ["/app/consent", "/app/settings", "/app/support"].includes(pathname);
  /*
   * The dev bypass account is taken as having consented, for the same reason it
   * is taken as having onboarded: it is fabricated rather than created, so it
   * has no user_metadata to record a consent in and the route that would record
   * one answers 401. In the wrapper that left the whole app behind a card whose
   * only button could never do anything. `PREVIEW_AUTH_BYPASS` is what mints
   * this id and production never sets it.
   */
  const consented =
    user.id === PREVIEW_AUTH_BYPASS_USER_ID || user.user_metadata?.memo_native_ai_consent === "v1";
  if (native && !consented && !nativeAccountPage) redirect("/app/consent");

  if (appState && !appState.onboardingComplete && pathname !== "/app/start" && !nativeAccountPage) {
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
      {/*
        * Connectivity is owned above the shell rather than by each screen, for
        * two reasons: the fetch stub that answers `/api` from the offline
        * snapshot has to be installed before any child can make a request, and
        * every screen under here — the library, a note, the banner — has to
        * agree about whether there is a connection.
        */}
      <OfflineProvider>
        <WindowFileDropGuard />
        <AppShell
          hasPaidAccess={Boolean(appState?.hasPaidAccess)}
          initialPathname={pathname}
        >
          {children}
        </AppShell>
        <ImpersonationBannerSlot />
      </OfflineProvider>
    </NavigationFeedbackProvider>
  );
}
