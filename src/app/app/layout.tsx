import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { WindowFileDropGuard } from "@/components/window-file-drop-guard";
import { AppShell } from "@/components/app-shell";
import { ImpersonationBannerSlot } from "@/components/impersonation-banner-slot";
import { NavigationFeedbackProvider } from "@/components/navigation-loading";
import { getViewerAppState } from "@/lib/billing";
import { requireUser } from "@/lib/auth";

/**
 * The signed-in app is `Disallow`ed in robots.txt, which stops it being
 * crawled but not being indexed: a URL somebody links to from outside can
 * still be listed, and a disallowed page is one Google cannot read the tag on.
 * This is the half that actually keeps it out, for anything that does reach it.
 */
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

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
    redirect("/app/start");
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
