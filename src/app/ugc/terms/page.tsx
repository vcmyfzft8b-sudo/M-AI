import { redirect } from "next/navigation";

import { CREATOR_TERMS_PATHS } from "@/lib/ugc/creator-campaigns";
import { defaultCampaign } from "@/lib/ugc/creator-market.server";

export const dynamic = "force-dynamic";

/** The terms live under each campaign's page; this older link sends a visitor to theirs. */
export default async function CreatorTermsRedirect() {
  redirect(CREATOR_TERMS_PATHS[await defaultCampaign()]);
}
