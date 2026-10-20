import "server-only";

import { createGeminiEmbeddings } from "@/lib/ai/gemini";
import { logGeminiUsageEvent } from "@/lib/ai/usage-logging";
import { getServerEnv } from "@/lib/server-env";

/**
 * Characters per input token for the embedding model. The Gemini API's embedContent answers with
 * vectors only, no token count, so the cost is estimated from the text: countTokens on Slovenian
 * study text gave 3.15 characters a token for gemini-embedding-001 (2026-10-20), rounded down here
 * so the estimate errs high rather than low.
 */
const EMBEDDING_CHARS_PER_TOKEN = 3;

/**
 * Embeds texts and logs the call to `ai_usage_events` as one row under stage "embedding".
 *
 * Until 2026-10-20 embeddings were never logged. They are cheap (about 0.7M tokens, $0.10, a day
 * in October 2026), but they count against the Gemini project's spending cap, and when that cap
 * was reached they were what failed every new note, so the morning cost report has to see both
 * their spend and their failures.
 */
export async function createEmbeddings(texts: string[]) {
  if (texts.length === 0) {
    return [];
  }

  const model = getServerEnv().GEMINI_EMBEDDING_MODEL;
  const chars = texts.reduce((sum, text) => sum + text.length, 0);
  const log = (success: boolean, error?: unknown) =>
    logGeminiUsageEvent({
      model,
      stage: "embedding",
      attemptIndex: 0,
      success,
      usageMetadata: success
        ? { promptTokenCount: Math.ceil(chars / EMBEDDING_CHARS_PER_TOKEN) }
        : null,
      metadata: { texts: texts.length, chars, tokenCount: "estimated_from_chars" },
      error,
    });

  try {
    const embeddings = await createGeminiEmbeddings(texts);

    await log(true);

    return embeddings;
  } catch (error) {
    await log(false, error);

    throw error;
  }
}
