import { redirect } from "next/navigation";

import { normalizeReferrer } from "@/lib/ugc/creator-application";
import { CREATOR_CAMPAIGN_PATHS } from "@/lib/ugc/creator-campaigns";
import { defaultCampaign } from "@/lib/ugc/creator-market.server";

export const dynamic = "force-dynamic";

/**
 * The creator program has one link per campaign (`/ugc/slovenija`, `/ugc/balkan`); this
 * short one sends a visitor to theirs by IP country, keeping a `?ref=` tag.
 */
export default async function UgcCreatorProgramRedirect({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string | string[] }>;
}) {
  const { ref } = await searchParams;
  const referrer = normalizeReferrer(Array.isArray(ref) ? ref[0] : ref);

  redirect(`${CREATOR_CAMPAIGN_PATHS[await defaultCampaign()]}${referrer ? `?ref=${encodeURIComponent(referrer)}` : ""}`);
}
