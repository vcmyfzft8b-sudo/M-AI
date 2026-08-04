import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { getViewerAppState } from "@/lib/billing";
import { requireUser } from "@/lib/auth";
import { isIOSWebWrapperRequest } from "@/lib/ios-web-wrapper";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireUser();
  const appState = await getViewerAppState();
  const headerStore = await headers();
  const pathname = headerStore.get("x-pathname") ?? "/app";
  const isIOSWebWrapper = await isIOSWebWrapperRequest();

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
    <AppShell
      hasPaidAccess={Boolean(appState?.hasPaidAccess)}
      initialPathname={pathname}
      suppressPurchaseActions={isIOSWebWrapper}
    >
      {children}
    </AppShell>
  );
}
