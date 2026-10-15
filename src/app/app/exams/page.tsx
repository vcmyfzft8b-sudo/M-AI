import { redirect } from "next/navigation";

import { EXAM_PREPS_HREF } from "@/components/exams/exam-links";

/** Every prep lives in the library, in its exam-prep folder; this address opens that folder. */
export default function ExamsPage() {
  redirect(EXAM_PREPS_HREF);
}
