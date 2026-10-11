import { CreatorCampaignTerms, creatorTermsMetadata } from "@/components/ugc/creator-campaign-page";

export const dynamic = "force-dynamic";

export function generateMetadata() {
  return creatorTermsMetadata("si");
}

export default function SlovenianCreatorTermsPage() {
  return <CreatorCampaignTerms market="si" />;
}
