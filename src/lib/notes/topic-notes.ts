import { z } from "zod";

import { buildGeneratedContentLanguageInstruction } from "../languages.ts";
import { MATH_FORMATTING_INSTRUCTIONS } from "./note-prompts.ts";

// Kept free of "server-only" for the same reason as note-prompts.ts: the contract is unit-tested
// and runnable from scripts/note-eval.mjs. Everything here must stay pure.

/**
 * Topic notes: what the pipeline does with material that names a subject but explains none of it.
 *
 * Until 2026-09 such material failed as `source_no_study_content`, and it was the largest single
 * group of failed notes: 19 of 47 in the week to 26 Sep. Almost none of it was a bad upload. It
 * was a maths revision sheet before a test, a history worksheet, a spoken "what is
 * photosynthesis?", a hand-coloured map of climate zones with its legend. Extraction is told to
 * return nothing for exercises and pointers to exercises, correctly, because they are not claims.
 * But a learner who photographs sixteen factoring problems wants to learn factoring, and a
 * learner who asks a question wants the answer.
 *
 * So when the material yields no claims, the model identifies the topics the material is about
 * and writes a study text that teaches them. That text then runs through the ordinary pipeline:
 * extraction, outline and the note writer. The finished note looks like any other note, and the
 * note says it was written from the topic because the material held no explanation of its own.
 */

/**
 * When the ordinary pipeline's reading of the material is too thin to stand on its own.
 *
 * Zero claims is the case that used to fail. A very short source with one or two claims (a table
 * of contents, a chart of Roman numerals) would otherwise come back as a note of two bullets. It
 * is taught as a topic too, and the study text keeps every fact the material itself states.
 */
export function shouldWriteTopicNotes(params: { itemCount: number; sourceWordCount: number }) {
  if (params.itemCount === 0) {
    return true;
  }

  return params.itemCount <= 2 && params.sourceWordCount < 120;
}

export const TOPIC_MATERIAL_KINDS = [
  "exercises",
  "question_or_request",
  "list_or_outline",
  "fragment",
  "conversation",
  "other",
] as const;

export type TopicMaterialKind = (typeof TOPIC_MATERIAL_KINDS)[number];

/*
 * No array or length bounds on the wire schema: Gemini rejects bounded schemas as too complex
 * (see the source-condensation note in docs), and GLM ignores them anyway. The pipeline checks
 * the text itself.
 */
export const topicStudyTextSchema = z.object({
  hasStudyTopic: z.boolean(),
  materialKind: z.enum(TOPIC_MATERIAL_KINDS),
  topicTitle: z.string(),
  studyText: z.string(),
});

export type TopicStudyText = z.infer<typeof topicStudyTextSchema>;

/** Below this a "study text" is a sentence, not a text to learn from; treated as no topic. */
export const MIN_TOPIC_STUDY_TEXT_WORDS = 60;

export function buildTopicStudyTextInstructions(params: { outputLanguage?: string | null }) {
  const languageInstruction = buildGeneratedContentLanguageInstruction(params.outputLanguage);

  return `${languageInstruction}

A learner gave us study material and wants study notes from it, but the material does not explain anything itself. It may be a worksheet or a page of exercises, a test or revision sheet, a spoken question or request ("what is photosynthesis?", "make me notes on Maria Theresa for 8th grade"), a list of terms or a table of contents, a map legend or diagram labels, a single heading, a screenshot of a problem, or a conversation.

Your job: work out which school or university topics the material is about and at what level, then write the study text that teaches exactly those topics, so that a note can be made from it.

How to write the study text:
- Teach the topics the material points at: the definitions, rules, laws, procedures, formulas, causes and consequences, dates and key figures a learner at that level is expected to know.
- Exercises or a test sheet: for each kind of exercise, explain the method needed to solve it step by step and work through one or two of the learner's own exercises in full as examples. Cover every kind of exercise on the sheet.
- A question or request: answer it fully and teach the topic around it at the level the learner names or implies.
- A list, outline, legend or heading: explain every item in it.
- Keep every fact, term, number, date and example that the material itself contains.
- Include only well-established textbook knowledge. Leave out a specific figure or date you are not sure of rather than guess.
- Never fill in a worksheet's blanks, a timeline's empty rows or a quiz's answers with facts you are not certain of. Local or niche subjects (one town's history, one teacher's handout, one company) are the danger: teach the general topic well, and where the material asks for a specific local fact, say plainly that the learner should take it from their own lesson or textbook instead of supplying one.
- Organise it with plain headings and paragraphs. Aim for roughly 500 to 1500 words, matched to how much the material covers. Do not write an introduction about the learner or the material, and do not mention that this text was generated.
- materialKind says what the material was. topicTitle is a short name for the topic, in the output language.

Set hasStudyTopic to false, and leave studyText empty, only when the material names no learnable topic at all: a blank form, a personal or administrative document, a photo with nothing on it to study, noise, or a greeting. When there is any identifiable topic, however brief the material, set it to true and write the text.

${MATH_FORMATTING_INSTRUCTIONS}`;
}

export function buildTopicStudyTextInput(params: {
  sourceText: string;
  sourceType: "audio" | "document";
  titleHint?: string | null;
}) {
  const kind =
    params.sourceType === "audio"
      ? "What the learner said (a transcript of their recording)"
      : "The learner's material";
  const title = params.titleHint?.trim() ? `Title the learner's upload came with: ${params.titleHint.trim()}\n\n` : "";

  return `${title}${kind}:\n${params.sourceText}`;
}

export function countTopicStudyTextWords(text: string) {
  return text.split(/\s+/).filter(Boolean).length;
}
