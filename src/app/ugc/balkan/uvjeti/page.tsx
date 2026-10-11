import { CreatorCampaignTerms, creatorTermsMetadata } from "@/components/ugc/creator-campaign-page";

export const dynamic = "force-dynamic";

export function generateMetadata() {
  return creatorTermsMetadata("balkans");
}

export default function BalkanCreatorTermsPage() {
  return <CreatorCampaignTerms market="balkans" />;
}
