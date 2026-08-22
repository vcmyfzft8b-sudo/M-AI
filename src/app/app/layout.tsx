import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { NavigationFeedbackProvider } from "@/components/navigation-loading";
import { getViewerAppState } from "@/lib/billing";
import { requireUser } from "@/lib/auth";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireUser();
  const appState = await getViewerAppState();
  const headerStore = await headers();
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
      <AppShell
        hasPaidAccess={Boolean(appState?.hasPaidAccess)}
        initialPathname={pathname}
      >
        {children}
      </AppShell>
    </NavigationFeedbackProvider>
  );
}
