import { ExamList } from "@/components/exams/exam-list";
import { requireUser } from "@/lib/auth";
import { listExamsForUser } from "@/lib/exams/exams-server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function ExamsPage() {
  const user = await requireUser();
  const supabase = await createSupabaseServerClient();
  const items = await listExamsForUser(supabase, user.id);

  return <ExamList items={items} />;
}
