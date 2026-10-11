import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getAdminContext } from "@/lib/admin/auth";
import { GEO_COUNTRY_HEADER } from "@/lib/i18n/server";
import { CREATOR_CAMPAIGN_PATHS } from "@/lib/ugc/creator-campaigns";
import { campaignLocale, defaultMarket, marketForCountry, type CampaignLocale, type CreatorMarket } from "@/lib/ugc/creator-program";

/**
 * Which campaign a request may see, decided on the server and nowhere else.
 *
 * The Slovenian and Balkan programs have separate links (`/ugc/slovenija`,
 * `/ugc/balkan`), each in its own language with no language switch. The IP country
 * (Vercel's `x-vercel-ip-country`, set by Vercel's edge and not by the browser) guards
 * them: a visitor from Slovenia who opens the Balkan link lands on the Slovenian page,
 * and the other way round. A visitor from anywhere else sees the link they were given.
 * An admin may open either, to check what each side sees.
 */

async function requestCountry(): Promise<string | null> {
  return (await headers()).get(GEO_COUNTRY_HEADER);
}

/** The campaign of the visitor's IP country, or `null` outside both. */
export async function ipCampaign(): Promise<CreatorMarket | null> {
  return marketForCountry(await requestCountry());
}

/** Where `/ugc` sends a visitor: the Balkan page for a Balkan IP, else the Slovenian. */
export async function defaultCampaign(): Promise<CreatorMarket> {
  return defaultMarket(await requestCountry());
}

/** The language a campaign page is rendered in for this request. */
export async function campaignPageLocale(market: CreatorMarket): Promise<CampaignLocale> {
  return campaignLocale(market, await requestCountry());
}

/**
 * Lets the request see `market`'s page, or redirects it to the same page of its own
 * campaign (`paths`: the landing by default, or the terms). `preview` is an admin
 * looking at the other campaign's page.
 */
export async function guardCampaignPage(
  market: CreatorMarket,
  { paths = CREATOR_CAMPAIGN_PATHS, query }: { paths?: Record<CreatorMarket, string>; query?: URLSearchParams } = {},
): Promise<{ preview: boolean }> {
  const own = await ipCampaign();

  if (!own || own === market) {
    return { preview: false };
  }

  const admin = await getAdminContext().catch(() => null);

  if (admin?.ok) {
    return { preview: true };
  }

  const search = query && query.size > 0 ? `?${query.toString()}` : "";

  redirect(`${paths[own]}${search}`);
}
