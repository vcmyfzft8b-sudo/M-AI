import { headers } from "next/headers";

import { getImpersonationState } from "@/lib/admin/impersonation";

import { ImpersonationBanner } from "./impersonation-banner";

/**
 * Renders the impersonation marker from the server, wherever the admin navigates.
 *
 * The state cookie is httpOnly, so this is the only place that can see it — the value never
 * reaches client JavaScript, and an ordinary user's browser has nothing to render.
 *
 * Skipped on `/admin*`: the dashboard is the admin's own account by definition, and the pill
 * would only be there to overlap the dashboard's own chrome.
 */
export async function ImpersonationBannerSlot() {
  const [state, headerStore] = await Promise.all([getImpersonationState(), headers()]);

  if (!state) {
    return null;
  }

  const pathname = headerStore.get("x-pathname") ?? "";

  if (pathname.startsWith("/admin")) {
    return null;
  }

  return <ImpersonationBanner targetEmail={state.targetEmail} />;
}
