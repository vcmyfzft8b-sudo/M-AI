import "server-only";
import { generateStructuredObject } from "@/lib/ai/json";
import { detectSourceLanguage, normalizeContentLanguageCode, resolveMaterialLanguage } from "@/lib/languages";
import { generationCacheKey, stageModelCacheKeyPart, withGenerationCheckpoint } from "@/lib/notes/generation-cache";
import {
  carriesNoLanguage,
  isContradictedBySpelling,
  sampleSourceLanguage,
  sourceLanguageSchema,
  SOURCE_LANGUAGE_INSTRUCTIONS,
} from "@/lib/source-language-policy";

/** Resolve once per exact material version, across all consumers. Never cache a guessed fallback. */
export async function resolveSourceLanguage(params: {
  text: string;
  hint?: string | null;
  lectureId?: string | null;
  userId?: string | null;
  metadata?: unknown;
  /**
   * The language the learner reads the app in. Only decides material that has no language of its
   * own (formulas alone); anything written in a language is that language, whoever reads it.
   */
  learnerLanguage?: string | null;
}): Promise<string> {
  const metadata = params.metadata as { sourceLanguage?: { version?: number; code?: string; notesHash?: string } } | null;
  const known = metadata?.sourceLanguage;
  if (known?.version === 1 && known.notesHash === generationCacheKey([params.text])) {
    const code = normalizeContentLanguageCode(known.code);
    // A note stored as Estonian before the 2026-09-29 fix is re-detected rather than trusted.
    if (code && !isContradictedBySpelling(code, params.text)) return code;
  }
  const hint = normalizeContentLanguageCode(params.hint);
  const learnerLanguage = normalizeContentLanguageCode(params.learnerLanguage);
  // Nothing to detect, so nothing to ask: the same rule the prompt states, without the model call.
  if (learnerLanguage && carriesNoLanguage(params.text)) return hint ?? learnerLanguage;
  const input = JSON.stringify({
    hint,
    // Left out when unknown, so a source's cached answer does not change for callers without it.
    ...(learnerLanguage ? { learnerLanguage } : {}),
    material: sampleSourceLanguage(params.text),
  });
  const detect = (instructions: string, version: string) =>
    withGenerationCheckpoint({
      lectureId: params.lectureId,
      stage: "source_language",
      cacheKey: generationCacheKey([version, params.text, input, stageModelCacheKeyPart("source_language")]),
      schema: sourceLanguageSchema,
      generate: () => generateStructuredObject({
        schema: sourceLanguageSchema,
        stage: "source_language",
        instructions,
        input,
        maxOutputTokens: 128,
        usageContext: { lectureId: params.lectureId, userId: params.userId },
      }),
    });
  try {
    const first = normalizeContentLanguageCode((await detect(SOURCE_LANGUAGE_INSTRUCTIONS, "source-language-v2")).language)!;
    if (!isContradictedBySpelling(first, params.text)) return first;

    // The material cannot be written in the language named; ask once more with that stated.
    const second = normalizeContentLanguageCode((await detect(
      `${SOURCE_LANGUAGE_INSTRUCTIONS} The material lacks the letters ${first} is always written with, so it is not ${first}.`,
      `source-language-v2-not-${first}`,
    )).language)!;
    if (!isContradictedBySpelling(second, params.text)) return second;
    console.warn("[source-language] model twice named a language the spelling rules out; using local evidence");
    return resolveMaterialLanguage(params.text, isContradictedBySpelling(params.hint, params.text) ? null : params.hint);
  } catch (error) {
    if (detectSourceLanguage(params.text)) {
      console.warn("[source-language] detection unavailable; using existing language evidence");
      return resolveMaterialLanguage(params.text, params.hint);
    }
    // A provider outage is not evidence that an unknown source is English.
    throw error;
  }
}
