import "server-only";

import { headers } from "next/headers";

import { getAdminContext } from "@/lib/admin/auth";
import { GEO_COUNTRY_HEADER } from "@/lib/i18n/server";
import { defaultMarket, type CreatorMarket } from "@/lib/ugc/creator-program";

/**
 * Which campaign this request belongs to, decided on the server and nowhere else.
 *
 * The Slovenian and Balkan programs are kept apart: the IP country (Vercel's
 * `x-vercel-ip-country`, set by Vercel's edge and not by the browser) picks one, and a
 * visitor has no way to ask for the other — not the language, not a cookie, not the URL. The one exception is an admin,
 * who can open either with `?market=` to check what each side sees.
 */
export async function resolveCreatorMarket(requested?: string | string[]): Promise<{
  market: CreatorMarket;
  preview: boolean;
}> {
  const headerStore = await headers();
  const detected = defaultMarket(headerStore.get(GEO_COUNTRY_HEADER));
  const wanted = Array.isArray(requested) ? requested[0] : requested;

  if ((wanted === "si" || wanted === "balkans") && wanted !== detected) {
    const admin = await getAdminContext().catch(() => null);

    if (admin?.ok) {
      return { market: wanted, preview: true };
    }
  }

  return { market: detected, preview: false };
}
