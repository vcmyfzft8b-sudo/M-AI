import "server-only";
import { generateStructuredObject } from "@/lib/ai/json";
import { detectSourceLanguage, normalizeContentLanguageCode, resolveMaterialLanguage } from "@/lib/languages";
import { generationCacheKey, stageModelCacheKeyPart, withGenerationCheckpoint } from "@/lib/notes/generation-cache";
import { sampleSourceLanguage, sourceLanguageSchema, SOURCE_LANGUAGE_INSTRUCTIONS } from "@/lib/source-language-policy";

/** Resolve once per exact material version, across all consumers. Never cache a guessed fallback. */
export async function resolveSourceLanguage(params: {
  text: string;
  hint?: string | null;
  lectureId?: string | null;
  userId?: string | null;
  metadata?: unknown;
}): Promise<string> {
  const metadata = params.metadata as { sourceLanguage?: { version?: number; code?: string; notesHash?: string } } | null;
  const known = metadata?.sourceLanguage;
  if (known?.version === 1 && known.notesHash === generationCacheKey([params.text])) {
    const code = normalizeContentLanguageCode(known.code);
    if (code) return code;
  }
  const input = JSON.stringify({ hint: normalizeContentLanguageCode(params.hint), material: sampleSourceLanguage(params.text) });
  try {
    const result = await withGenerationCheckpoint({
      lectureId: params.lectureId,
      stage: "source_language",
      cacheKey: generationCacheKey(["source-language-v1", params.text, input, stageModelCacheKeyPart("source_language")]),
      schema: sourceLanguageSchema,
      generate: () => generateStructuredObject({
        schema: sourceLanguageSchema,
        stage: "source_language",
        instructions: SOURCE_LANGUAGE_INSTRUCTIONS,
        input,
        maxOutputTokens: 128,
        usageContext: { lectureId: params.lectureId, userId: params.userId },
      }),
    });
    return normalizeContentLanguageCode(result.language)!;
  } catch (error) {
    if (detectSourceLanguage(params.text)) {
      console.warn("[source-language] detection unavailable; using existing language evidence");
      return resolveMaterialLanguage(params.text, params.hint);
    }
    // A provider outage is not evidence that an unknown source is English.
    throw error;
  }
}
