import { CreatorLecture } from "@/components/creator-demo/creator-lecture";
import { buildDemoSeedDetail } from "@/lib/creator-demo/build";
import { getLocale } from "@/lib/i18n/server";

export default async function CollegeCreatorDemoLecturePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // Notes created during a recording only exist in the browser, so an unknown
  // id resolves client-side instead of 404-ing here.
  return <CreatorLecture lectureId={id} initialDetail={buildDemoSeedDetail(id, await getLocale())} />;
}
