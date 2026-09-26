/** The note pipeline as note-generation.ts runs it, topic notes included, for the offline replays. */

import {
  buildKnowledgeExtractionInstructions,
  buildSourceNoteInstructions,
  assembleSourceNoteParts,
  dedupeKnowledgeItems,
  KNOWLEDGE_EXTRACTION_PASS_WINDOWS,
  knowledgeExtractionSchema,
  normalizeGeneratedNoteMarkdown,
  noteWriteSchema,
  planSourceWriteWindows,
  resolveExtractionMaxOutputTokens,
} from "../../src/lib/notes/note-prompts.ts";
import {
  buildTopicStudyTextInput,
  buildTopicStudyTextInstructions,
  countTopicStudyTextWords,
  MIN_TOPIC_STUDY_TEXT_WORDS,
  shouldWriteTopicNotes,
  topicStudyTextSchema,
} from "../../src/lib/notes/topic-notes.ts";
import { resolveStageModelConfig } from "../../src/lib/ai/model-config.ts";
import { buildWindows, countWords, generate, mapWithConcurrency } from "./eval-runtime.mjs";

export const stage = (name) =>
  resolveStageModelConfig({ stage: name, env: process.env, fallbackModel: "gemini-3.5-flash-lite" });

export async function extract(source, sourceType, language) {
  const config = stage("note_extract");
  const windows = KNOWLEDGE_EXTRACTION_PASS_WINDOWS.flatMap((words) =>
    buildWindows(source, words).map((text, index, all) => ({ text, label: `Chunk ${index + 1} of ${all.length}` })),
  );
  const extractions = await mapWithConcurrency(windows, 4, ({ text, label }) =>
    generate({
      schema: knowledgeExtractionSchema,
      model: config.model,
      thinkingLevel: config.thinkingLevel,
      maxOutputTokens: Math.round(resolveExtractionMaxOutputTokens(countWords(text)) * config.outputHeadroom),
      instructions: buildKnowledgeExtractionInstructions({ outputLanguage: language, sourceType }),
      input: `${label}.\n\n${text}`,
    }),
  );
  const items = extractions.flatMap((extraction) =>
    extraction.items.map((item) => ({ ...item, sectionTitle: extraction.sectionTitle })),
  );

  return dedupeKnowledgeItems(items.map((item, id) => ({ ...item, id })));
}

export async function writeNote(source, language) {
  const config = stage("note_write");
  const parts = [];
  const windows = planSourceWriteWindows(source);

  for (const [index, window] of windows.entries()) {
    const value = await generate({
      schema: noteWriteSchema,
      model: config.model,
      thinkingLevel: config.thinkingLevel,
      maxOutputTokens: Math.round(Math.max(4000, countWords(window) * 1.6) * config.outputHeadroom),
      instructions: buildSourceNoteInstructions({
        outputLanguage: language,
        ...(windows.length > 1 ? { window: { index, count: windows.length } } : {}),
      }),
      input: window,
    });
    parts.push(value.structuredNotesMd.trim());
  }

  return normalizeGeneratedNoteMarkdown(assembleSourceNoteParts(parts));
}

export async function runCase(testCase) {
  const sourceWordCount = countWords(testCase.source);
  let items = await extract(testCase.source, testCase.sourceType, testCase.language);
  const firstItemCount = items.length;
  let noteSource = testCase.source;
  let topic = null;

  if (shouldWriteTopicNotes({ itemCount: items.length, sourceWordCount })) {
    const config = stage("note_topic");
    const value = await generate({
      schema: topicStudyTextSchema,
      model: config.model,
      thinkingLevel: config.thinkingLevel,
      maxOutputTokens: Math.round(6000 * config.outputHeadroom),
      instructions: buildTopicStudyTextInstructions({ outputLanguage: testCase.language }),
      input: buildTopicStudyTextInput({
        sourceText: testCase.source,
        sourceType: testCase.sourceType,
        titleHint: testCase.title ?? null,
      }),
    });
    topic = value;

    if (value.hasStudyTopic && countTopicStudyTextWords(value.studyText) >= MIN_TOPIC_STUDY_TEXT_WORDS) {
      noteSource = value.studyText.trim();
      items = await extract(noteSource, "document", testCase.language);
    }
  }

  if (items.length === 0) {
    return { outcome: "fail", firstItemCount, topic };
  }

  const note = await writeNote(noteSource, testCase.language);

  return { outcome: "note", firstItemCount, itemCount: items.length, topic, note };
}
