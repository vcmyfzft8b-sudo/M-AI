import { CreatorExamBuilder } from "@/components/creator-demo/creator-exams";
import { toLectureListItems } from "@/lib/creator-demo/build";
import { getCreatorDemoSeed } from "@/lib/creator-demo/server-seed";

export default function CreatorDemoNewExamPage() {
  return <CreatorExamBuilder initialLectures={toLectureListItems(getCreatorDemoSeed())} />;
}
