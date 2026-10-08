import { CreatorLecture } from "@/components/creator-demo/creator-lecture";
import { buildDemoSeedDetail } from "@/lib/creator-demo/build";

export default async function CreatorDemoLecturePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);

  // Notes created during a recording only exist in the browser, so an unknown
  // id resolves client-side instead of 404-ing here.
  return (
    <CreatorLecture
      lectureId={id}
      initialDetail={buildDemoSeedDetail(id)}
      initialTabId={typeof query.tab === "string" ? query.tab : null}
    />
  );
}
