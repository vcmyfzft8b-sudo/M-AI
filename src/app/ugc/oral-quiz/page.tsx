import type { Metadata } from "next";

import { UgcOralQuiz } from "@/components/ugc/oral-quiz";
import { parseLocale } from "@/lib/i18n/locales";
import { getOralQuizCopy } from "@/lib/ugc/oral-quiz-copy";

export const metadata: Metadata = {
  title: "Oral quiz",
};

/**
 * The scripted tutor skit for UGC videos. See src/lib/ugc/oral-quiz.ts.
 *
 * Opens on a language picker; `?lang=sl` (set by the picker, so a reload keeps it) skips it.
 */
export default async function UgcOralQuizPage({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string | string[] }>;
}) {
  const { lang } = await searchParams;

  return <UgcOralQuiz copy={getOralQuizCopy()} initialLocale={parseLocale(Array.isArray(lang) ? lang[0] : lang)} />;
}
