import { CreatorCampaignPage, creatorCampaignMetadata } from "@/components/ugc/creator-campaign-page";

// Guarded per request by the visitor's IP country.
export const dynamic = "force-dynamic";

export function generateMetadata() {
  return creatorCampaignMetadata("balkans");
}

/** The Balkan creator campaign's own link. Applications land in `/admin/applications`. */
export default function BalkanCreatorCampaignPage({ searchParams }: { searchParams: Promise<{ ref?: string | string[] }> }) {
  return <CreatorCampaignPage market="balkans" searchParams={searchParams} />;
}
