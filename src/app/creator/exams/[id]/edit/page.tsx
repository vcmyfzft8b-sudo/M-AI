import { CreatorExamEditor } from "@/components/creator-demo/creator-exams";
import { toLectureListItems } from "@/lib/creator-demo/build";
import { getCreatorDemoSeed } from "@/lib/creator-demo/server-seed";

export default async function CreatorDemoEditExamPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <CreatorExamEditor planId={id} initialLectures={toLectureListItems(getCreatorDemoSeed())} />
  );
}
