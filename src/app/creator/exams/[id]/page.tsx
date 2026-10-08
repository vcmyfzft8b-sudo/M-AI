import { ExamJourneyScreen } from "@/components/exam-prep/exam-journey-screen";

export default async function CreatorDemoExamPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return <ExamJourneyScreen planId={id} initialPayload={null} />;
}
