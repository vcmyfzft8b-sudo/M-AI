import { ExamListScreen } from "@/components/exam-prep/exam-list-screen";
import { requireUser } from "@/lib/auth";
import { listExamPlanSummaries } from "@/lib/exam-prep/server";
import { captureRouteError } from "@/lib/monitoring";

export default async function ExamsPage() {
  const user = await requireUser();
  let plans = null;

  try {
    plans = await listExamPlanSummaries(user.id);
  } catch (error) {
    // The screen fetches again on mount and shows its own error if that fails too.
    captureRouteError(error, { route: "/app/exams", operation: "list" });
  }

  return <ExamListScreen initialPlans={plans} />;
}
