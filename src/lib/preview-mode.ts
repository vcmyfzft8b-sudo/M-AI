import "server-only";

import { cookies } from "next/headers";

export const PREVIEW_AUTH_BYPASS_DISABLED_COOKIE = "memo-preview-auth-disabled";

export async function isPreviewAuthBypassEnabled() {
  if (process.env.PREVIEW_AUTH_BYPASS !== "true") {
    return false;
  }

  if (process.env.NODE_ENV === "development") {
    return true;
  }

  const cookieStore = await cookies();
  return cookieStore.get(PREVIEW_AUTH_BYPASS_DISABLED_COOKIE)?.value !== "true";
}

/**
 * Cookie that gives the preview account a subscription.
 *
 * The bypass account is deliberately unpaid — the paywalls, the trial and the
 * prize wheel are most of what anyone opens a preview to look at. But the other
 * half of the app is behind that paywall, and there is no way to sign a
 * fabricated account up for Stripe, so this switches the same account between
 * the two views without a restart.
 *
 * It is read only for the bypass account, and the bypass itself only exists
 * when PREVIEW_AUTH_BYPASS is set, which production never sets.
 */
export const PREVIEW_PREMIUM_COOKIE = "memo-preview-premium";

export async function isPreviewPremiumEnabled() {
  if (!(await isPreviewAuthBypassEnabled())) {
    return false;
  }

  const cookieStore = await cookies();
  return cookieStore.get(PREVIEW_PREMIUM_COOKIE)?.value === "true";
}
