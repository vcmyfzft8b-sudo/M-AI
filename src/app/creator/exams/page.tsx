import { ExamListScreen } from "@/components/exam-prep/exam-list-screen";

/** Exam prep in the demo: plans live in the tab, so the list loads on the client. */
export default function CreatorDemoExamsPage() {
  return <ExamListScreen initialPlans={null} />;
}
