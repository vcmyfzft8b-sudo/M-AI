import { notFound } from "next/navigation";
import { LecturePalace } from "@/components/lecture-palace";
import type {
  FlashcardWithCitations,
  QuizQuestionWithOptions,
  PracticeTestQuestion,
  StudySectionWithProgress,
} from "@/lib/types";

export default async function PalaceLocalQA({
  searchParams,
}: {
  searchParams: Promise<{ large?: string; isolated?: string }>;
}) {
  const { large, isolated } = await searchParams;
  if (process.env.NODE_ENV !== "development") notFound();
  const cards = [
    {
      id: "qa-card",
      front: "What does the hippocampus help us do?",
      back: "It helps form new memories and supports spatial navigation.",
      section_id: "qa-neuroscience",
      coverage_rank: 1,
      concept_key: "hippocampus",
      citations: [],
      progress: null,
    },
  ] as unknown as FlashcardWithCitations[];
  const quiz = [
    {
      id: "qa-quiz",
      prompt: "Which technique strengthens long-term recall?",
      options: [
        "Retrieving an answer from memory",
        "Only rereading a paragraph",
        "Skipping sleep",
      ],
      correct_option_idx: 0,
      explanation:
        "Active recall asks you to retrieve knowledge before checking the answer. Returning to a familiar place provides a spatial cue for that knowledge.",
    },
  ] as unknown as QuizQuestionWithOptions[];
  const practice = [
    {
      id: "qa-test",
      prompt: "Explain why landmarks help recall.",
      answer_guide:
        "Distinctive landmarks connect information to stable spatial cues.",
      importance: 1,
    },
  ] as unknown as PracticeTestQuestion[];
  const sections = [
    { id: "qa-neuroscience", title: "The art of remembering" },
  ] as unknown as StudySectionWithProgress[];
  return (
    <main style={{ padding: 32 }}>
      <LecturePalace
        lectureId={`palace-local-synthetic${large ? "-large" : isolated ? "-isolated" : ""}`}
        cards={
          large
            ? Array.from({ length: 60 }, (_, index) => ({
                ...cards[0],
                id: `qa-card-${index}`,
                concept_key: `concept-${index}`,
              }))
            : cards
        }
        quizQuestions={quiz}
        practiceQuestions={practice}
        sections={sections}
        isReady
      />
    </main>
  );
}
