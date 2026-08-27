import { getImpersonationState } from "@/lib/admin/impersonation";

import { ImpersonationBanner } from "./impersonation-banner";

/**
 * Renders the impersonation marker from the server.
 *
 * The state cookie is httpOnly, so this is the only place that can see it — the value never
 * reaches client JavaScript, and an ordinary user's browser has nothing to render.
 *
 * Mounted in the app layout rather than the root one on purpose: reading a cookie in the root
 * layout opts every page out of static rendering, and it took the prerendered legal pages with
 * it. The app layout is already dynamic (it resolves the signed-in user), so the marker is free
 * here — and `/app` is where an admin inspecting an account actually is.
 */
export async function ImpersonationBannerSlot() {
  const state = await getImpersonationState();

  if (!state) {
    return null;
  }

  return <ImpersonationBanner targetEmail={state.targetEmail} />;
}
