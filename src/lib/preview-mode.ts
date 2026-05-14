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
