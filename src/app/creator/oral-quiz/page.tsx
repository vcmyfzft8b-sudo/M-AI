import type { Metadata } from "next";

import { CreatorOralQuiz } from "@/components/creator-demo/oral-quiz";

export const metadata: Metadata = {
  title: "Oral quiz",
};

/** The scripted tutor skit for UGC videos. See src/lib/creator-demo/oral-quiz.ts. */
export default function CreatorOralQuizPage() {
  return <CreatorOralQuiz />;
}
