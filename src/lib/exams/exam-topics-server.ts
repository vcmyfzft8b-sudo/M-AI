import "server-only";

import { z } from "zod";

import { generateStructuredObject } from "@/lib/ai/json";
import type { ExamTopicRow } from "@/lib/database.types";
import type { createSupabaseServerClient } from "@/lib/supabase/server";

/*
 * Exam topics, as Astra builds its study path: the learner's material is split into topics when
 * the exam is set up, and each topic is a module on the path. A topic from the material teaches
 * from the note's own flashcards, quiz and practice questions, sorted into topics the first time a
 * lesson needs them. A topic the learner added on the plan review, or one the AI added because
 * the learner allowed it, has nothing in the material to draw on, so its lesson content is
 * written for it the first time it is opened.
 */

type TopicSupabase = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export type TopicItemGroup = "flashcards" | "quiz" | "written";

export type PlannedTopic = {
  title: string;
  summary: string;
  keyPoints: string[];
};

export type GeneratedTopicContent = {
  flashcards: { front: string; back: string }[];
  quiz: { prompt: string; options: string[]; correctIndex: number; explanation: string }[];
  written: { prompt: string; answerGuide: string }[];
};

/** How much of a note the planner reads; the tutor grounds itself on the same amount. */
const NOTE_CHARS = 24_000;
const MAX_TOPICS_PER_NOTE = 6;
const MAX_KEY_POINTS = 6;

/** A readable line about the learner's level for the prompts, from the setup's school step. */
export function schoolLine(level: string | null, year: string | null) {
  const parts = [level, year].filter((part): part is string => Boolean(part && part.trim()));
  return parts.length > 0 ? parts.join(", ").replace(/_/g, " ") : "not given";
}

/** Fewer topics for a short note: about one per 5,000 characters of notes, two to six. */
export function topicCountFor(noteLength: number) {
  return Math.min(MAX_TOPICS_PER_NOTE, Math.max(2, Math.round(noteLength / 5000)));
}

function clean(text: unknown, max: number) {
  return typeof text === "string" ? text.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function cleanTopic(topic: { title?: unknown; summary?: unknown; keyPoints?: unknown }): PlannedTopic | null {
  const title = clean(topic.title, 160);

  if (!title) {
    return null;
  }

  return {
    title,
    summary: typeof topic.summary === "string" ? topic.summary.trim().slice(0, 2400) : "",
    keyPoints: (Array.isArray(topic.keyPoints) ? topic.keyPoints : [])
      .map((point) => clean(point, 400))
      .filter(Boolean)
      .slice(0, MAX_KEY_POINTS),
  };
}

/* ---------------------------------------------------------------- planning */

// No .max() on wire schemas: the gateway rejects some of them; lengths are clamped afterwards.
const planSchema = z.object({
  topics: z.array(
    z.object({
      title: z.string(),
      summary: z.string(),
      keyPoints: z.array(z.string()),
    }),
  ),
});

const PLAN_INSTRUCTIONS = `You split one student's study note into the topics an exam on it would cover, the way a good tutor plans a course.

Return the topics in the order the note teaches them. Every important idea in the note must belong to exactly one topic; do not leave parts of the note out and do not repeat an idea in two topics.

For each topic:
- title: 2 to 6 words, the name a teacher would give the topic.
- summary: 3 to 5 sentences that teach the topic's core idea, using only what the note says.
- keyPoints: 3 to 6 points, one sentence each: the definitions, facts, formulas or steps a student must know for the exam.

Never invent facts that are not in the note. Write in the same language as the note. Pitch the wording at the student's level.`;

/**
 * Splits one note into topics. A note the model cannot split comes back as one topic made of the
 * note itself, so setup never fails because planning did.
 */
export async function planNoteTopics(params: {
  lectureId: string;
  userId: string;
  title: string | null;
  summary: string;
  keyTopics: string[];
  notesMarkdown: string;
  school: string;
}): Promise<PlannedTopic[]> {
  const notes = params.notesMarkdown.slice(0, NOTE_CHARS);
  const count = topicCountFor(notes.length);
  const fallback: PlannedTopic[] = [
    {
      title: clean(params.title, 160) || clean(params.keyTopics[0], 160) || "Topic",
      summary: params.summary.trim().slice(0, 2400),
      keyPoints: params.keyTopics.map((point) => clean(point, 400)).filter(Boolean).slice(0, MAX_KEY_POINTS),
    },
  ];

  if (!notes.trim()) {
    return fallback;
  }

  try {
    const result = await generateStructuredObject({
      schema: planSchema,
      stage: "study_items",
      maxOutputTokens: 5000,
      instructions: `${PLAN_INSTRUCTIONS}\n\nMake ${count === 2 ? "2 or 3" : `about ${count}`} topics. Student level: ${params.school}.`,
      input: JSON.stringify({
        noteTitle: params.title ?? "",
        keyTopics: params.keyTopics,
        note: notes,
      }),
      usageContext: { stage: "exam_topic_plan", userId: params.userId, lectureId: params.lectureId },
    });
    const topics = result.topics.map(cleanTopic).filter((topic): topic is PlannedTopic => topic !== null);

    return topics.length > 0 ? topics.slice(0, MAX_TOPICS_PER_NOTE + 2) : fallback;
  } catch {
    return fallback;
  }
}

const expansionSchema = z.object({
  topics: z.array(
    z.object({
      title: z.string(),
      summary: z.string(),
      keyPoints: z.array(z.string()),
      noteIndex: z.number().int(),
    }),
  ),
});

/**
 * Astra's "AI may add topics" switch: at most two topics an exam on this material is likely to
 * ask about but the material does not cover. Off unless the learner turned it on.
 */
export async function planExpansionTopics(params: {
  userId: string;
  notes: { title: string; summary: string; topicTitles: string[] }[];
  school: string;
}): Promise<(PlannedTopic & { noteIndex: number })[]> {
  if (params.notes.length === 0) {
    return [];
  }

  try {
    const result = await generateStructuredObject({
      schema: expansionSchema,
      stage: "study_items",
      maxOutputTokens: 2500,
      instructions: `A student is preparing for an exam from the notes listed in the input, already split into the topics listed. Suggest at most 2 further topics that an exam on this subject is very likely to ask about but that the notes do not cover. Suggest none if the notes are complete.

For each: a title (2 to 6 words), a 3 to 5 sentence summary that teaches it, 3 to 6 key points, and noteIndex: the index of the note it belongs with. Only standard, well-established material for the subject. Write in the language of the notes. Student level: ${params.school}.`,
      input: JSON.stringify({ notes: params.notes.map((note, index) => ({ index, ...note })) }),
      usageContext: { stage: "exam_topic_expand", userId: params.userId },
    });

    return result.topics
      .slice(0, 2)
      .map((topic) => {
        const cleaned = cleanTopic(topic);
        return cleaned
          ? { ...cleaned, noteIndex: Math.min(params.notes.length - 1, Math.max(0, topic.noteIndex)) }
          : null;
      })
      .filter((topic): topic is PlannedTopic & { noteIndex: number } => topic !== null);
  } catch {
    return [];
  }
}

/* ---------------------------------------------------------------- assigning */

const assignSchema = z.object({
  assignments: z.array(z.object({ item: z.number().int(), topic: z.number().int() })),
});

/**
 * Which topic each item teaches, by index. Items the model leaves out, or a call that fails, are
 * spread evenly in note order instead, which follows the order the topics were planned in.
 */
export async function assignItemsToTopics(params: {
  userId: string;
  lectureId: string;
  topics: { title: string; keyPoints: string[] }[];
  items: string[];
}): Promise<number[]> {
  const evenly = (index: number) =>
    Math.min(params.topics.length - 1, Math.floor((index * params.topics.length) / Math.max(1, params.items.length)));
  const out = params.items.map((_, index) => evenly(index));

  if (params.topics.length < 2 || params.items.length === 0) {
    return out.map(() => 0);
  }

  try {
    const result = await generateStructuredObject({
      schema: assignSchema,
      stage: "study_items",
      maxOutputTokens: Math.min(12_000, params.items.length * 14 + 400),
      instructions:
        "Sort study items into the topic each one tests. Return one assignment for every item: its index and the index of the topic it belongs to. Choose the single best topic.",
      input: JSON.stringify({
        topics: params.topics.map((topic, index) => ({ index, title: topic.title, keyPoints: topic.keyPoints })),
        items: params.items.map((text, index) => ({ index, text: text.slice(0, 220) })),
      }),
      usageContext: { stage: "exam_topic_assign", userId: params.userId, lectureId: params.lectureId },
    });

    for (const assignment of result.assignments) {
      if (
        assignment.item >= 0 &&
        assignment.item < out.length &&
        assignment.topic >= 0 &&
        assignment.topic < params.topics.length
      ) {
        out[assignment.item] = assignment.topic;
      }
    }
  } catch {
    // Keep the even spread.
  }

  return out;
}

const ITEM_SOURCES: Record<TopicItemGroup, { table: string; column: "flashcard_ids" | "quiz_ids" | "written_ids"; text: string }> = {
  flashcards: { table: "flashcards", column: "flashcard_ids", text: "front" },
  quiz: { table: "quiz_questions", column: "quiz_ids", text: "prompt" },
  written: { table: "practice_test_questions", column: "written_ids", text: "prompt" },
};

/**
 * Sorts a note's items of one kind into the exam's topics of that note, once. Runs again if the
 * note's items were regenerated since (the stored ids no longer exist).
 */
export async function ensureTopicItems(
  supabase: TopicSupabase,
  userId: string,
  input: { examId: string; lectureId: string; group: TopicItemGroup },
) {
  const source = ITEM_SOURCES[input.group];
  const { data: topicRows, error: topicError } = await supabase
    .from("exam_topics")
    .select("*")
    .eq("exam_id", input.examId)
    .eq("lecture_id", input.lectureId)
    .eq("user_id", userId)
    .eq("source", "material")
    .order("position", { ascending: true });

  if (topicError) {
    throw topicError;
  }

  const topics = (topicRows ?? []) as ExamTopicRow[];

  if (topics.length === 0) {
    return;
  }

  const { data: itemRows, error: itemError } = await supabase
    .from(source.table as "quiz_questions")
    .select(`id, ${source.text}`)
    .eq("lecture_id", input.lectureId)
    .order("idx", { ascending: true })
    .limit(400);

  if (itemError) {
    throw itemError;
  }

  const items = (itemRows ?? []) as unknown as Record<string, string>[];

  if (items.length === 0) {
    return;
  }

  const live = new Set(items.map((item) => item.id));
  const stale = topics.some(
    (topic) => topic.assigned_kinds.includes(input.group) && topic[source.column].some((id) => !live.has(id)),
  );

  if (!stale && topics.every((topic) => topic.assigned_kinds.includes(input.group))) {
    return;
  }

  const placement = await assignItemsToTopics({
    userId,
    lectureId: input.lectureId,
    topics: topics.map((topic) => ({
      title: topic.title,
      keyPoints: Array.isArray(topic.key_points) ? (topic.key_points as string[]) : [],
    })),
    items: items.map((item) => item[source.text] ?? ""),
  });

  await Promise.all(
    topics.map((topic, topicIndex) =>
      supabase
        .from("exam_topics")
        .update({
          [source.column]: items.filter((_, itemIndex) => placement[itemIndex] === topicIndex).map((item) => item.id),
          assigned_kinds: [...new Set([...topic.assigned_kinds, input.group])],
        } as never)
        .eq("id", topic.id)
        .eq("user_id", userId),
    ),
  );
}

/* ---------------------------------------------------------------- written for a topic */

const contentSchema = z.object({
  summary: z.string(),
  keyPoints: z.array(z.string()),
  flashcards: z.array(z.object({ front: z.string(), back: z.string() })),
  quiz: z.array(
    z.object({
      prompt: z.string(),
      options: z.array(z.string()),
      correctIndex: z.number().int(),
      explanation: z.string(),
    }),
  ),
  written: z.array(z.object({ prompt: z.string(), answerGuide: z.string() })),
});

/**
 * The lessons of a topic the material does not cover: its summary, eight flashcards, eight quiz
 * questions and two written questions with a marking guide. Grounded on the learner's note when it
 * says anything about the topic; otherwise standard knowledge of the subject.
 */
export async function writeTopicContent(params: {
  userId: string;
  lectureId: string;
  topicTitle: string;
  summary: string;
  keyPoints: string[];
  noteTitle: string | null;
  notesMarkdown: string;
  school: string;
}): Promise<{ summary: string; keyPoints: string[]; content: GeneratedTopicContent }> {
  const result = await generateStructuredObject({
    schema: contentSchema,
    stage: "study_items",
    maxOutputTokens: 7000,
    instructions: `Write the study material for one exam topic a student asked to learn: "${params.topicTitle}".

Use the student's note in the input where it covers the topic; where it does not, use standard, well-established knowledge of the subject. Never invent specifics (names, numbers, dates) you are not sure of.

Return:
- summary: 3 to 5 sentences that teach the topic.
- keyPoints: 3 to 6 one-sentence points to know.
- flashcards: 8 cards, a question or term on the front and a short answer on the back.
- quiz: 8 multiple-choice questions, 4 options each, exactly one correct (correctIndex is 0-based), with a one-sentence explanation of the right answer.
- written: 2 open questions, each with an answerGuide written as a bullet list ("- ") of the 2 to 4 points a full answer must contain.

Write in the language of the note (if the note is empty, the language of the topic title). Student level: ${params.school}.`,
    input: JSON.stringify({
      topic: params.topicTitle,
      knownSummary: params.summary,
      knownKeyPoints: params.keyPoints,
      noteTitle: params.noteTitle ?? "",
      note: params.notesMarkdown.slice(0, 12_000),
    }),
    usageContext: { stage: "exam_topic_write", userId: params.userId, lectureId: params.lectureId },
  });

  return {
    summary: result.summary.trim().slice(0, 2400) || params.summary,
    keyPoints: result.keyPoints.map((point) => clean(point, 400)).filter(Boolean).slice(0, MAX_KEY_POINTS),
    content: {
      flashcards: result.flashcards
        .map((card) => ({ front: clean(card.front, 400), back: clean(card.back, 800) }))
        .filter((card) => card.front && card.back)
        .slice(0, 12),
      quiz: result.quiz
        .map((question) => ({
          prompt: clean(question.prompt, 600),
          options: question.options.map((option) => clean(option, 300)).filter(Boolean).slice(0, 5),
          correctIndex: question.correctIndex,
          explanation: clean(question.explanation, 800),
        }))
        .filter(
          (question) =>
            question.prompt && question.options.length >= 2 && question.correctIndex >= 0 && question.correctIndex < question.options.length,
        )
        .slice(0, 12),
      written: result.written
        .map((question) => ({ prompt: clean(question.prompt, 600), answerGuide: question.answerGuide.trim().slice(0, 1500) }))
        .filter((question) => question.prompt && question.answerGuide)
        .slice(0, 3),
    },
  };
}
