import "server-only";

import type { z } from "zod";

import { stripDashPunctuation } from "@/lib/ai/answer-punctuation";
import {
  buildChatStudyInstructions,
  chatStudyOutputTokens,
  chatStudySchemaFor,
  type chatQuizSetSchema,
} from "@/lib/ai/chat-study-prompt";
import { generateStructuredObject } from "@/lib/ai/json";
import {
  CHAT_STUDY_SET_VERSION,
  parseChatStudyAttachment,
  resolveChatStudyCount,
  type ChatStudyAttachment,
  type ChatStudyRequest,
} from "@/lib/chat-study-set";
import { shuffleIndices } from "@/lib/study/quiz";

/**
 * Writes the study set a learner asked for in the chat.
 *
 * Its own call rather than more fields on the answer, for two reasons. The answer is the one
 * stage somebody watches arrive, and it runs on a latency-sorted model with no thinking; a deck
 * written inside it would hold the closing frame back by the whole deck. And a set is a different
 * piece of writing from a sixty-word reply, judged by different rules (one fact per card, four
 * plausible options), which read far better as their own instructions than as a paragraph
 * buried in the tutor's.
 *
 * It runs on the stage the note's own decks and quizzes are written on, so a chat set and a tab
 * set come from the same model with the same settings.
 */

/*
 * The model is told to spread the right answers and does not: left to itself the correct option
 * is A or B far more often than chance, and a learner learns that rather than the topic. So the
 * options are shuffled once, here, and stored in that order. Doing it on the server rather than
 * in the browser also keeps the order the same across a reload and between the server render
 * and hydration.
 */
function shuffleQuizOptions(raw: z.infer<typeof chatQuizSetSchema>) {
  return {
    ...raw,
    questions: raw.questions.map((question) => {
      const options = question.options.slice(0, 4);
      const order = shuffleIndices(options.length);

      return {
        ...question,
        options: order.map((index) => options[index] ?? ""),
        correctIndex: order.indexOf(question.correctIndex),
      };
    }),
  };
}

function cleanText<T>(value: T): T {
  if (typeof value === "string") {
    return stripDashPunctuation(value) as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => cleanText(item)) as T;
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, cleanText(item)]),
    ) as T;
  }

  return value;
}

export async function generateChatStudySet(params: {
  request: ChatStudyRequest;
  /** The learner's latest message, word for word. */
  question: string;
  /** The tutor's reply the set will sit under; it decides the set's language. */
  reply: string;
  /** Whatever the chat was answering from, as it was sent to the answer call. */
  material: Record<string, unknown>;
  userId: string;
  lectureId: string | null;
}): Promise<ChatStudyAttachment> {
  const { kind } = params.request;
  const count = resolveChatStudyCount(kind, params.request.count);
  const failed = { version: CHAT_STUDY_SET_VERSION, kind, failed: true } as const;

  try {
    const raw = await generateStructuredObject({
      schema: chatStudySchemaFor(kind),
      stage: "study_items",
      maxOutputTokens: chatStudyOutputTokens(kind, count),
      instructions: buildChatStudyInstructions(kind, count),
      input: JSON.stringify(
        {
          focus: params.request.focus,
          learnerAsked: params.question,
          reply: params.reply,
          material: params.material,
        },
        null,
        2,
      ),
      usageContext: {
        userId: params.userId,
        lectureId: params.lectureId,
        metadata: { feature: "chat_study_set", kind },
      },
    });

    const cleaned = cleanText(raw) as Record<string, unknown>;
    const shaped =
      kind === "quiz"
        ? shuffleQuizOptions(cleaned as z.infer<typeof chatQuizSetSchema>)
        : kind === "mindmap"
          ? { title: cleaned.title, doc: { title: cleaned.title, language: "", branches: cleaned.branches } }
          : cleaned;

    return (
      parseChatStudyAttachment({ version: CHAT_STUDY_SET_VERSION, kind, ...shaped }) ?? failed
    );
  } catch (error) {
    /*
     * The answer above it is already written and, on the streamed path, already read. A set that
     * cannot be made costs the set, never the reply, and the card left in its place says so.
     */
    console.error(`[chat-study-set] could not write the ${kind}`, error);
    return failed;
  }
}
