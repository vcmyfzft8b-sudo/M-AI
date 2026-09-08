import "server-only";

import { getCurrentAbortSignal, getRemainingBudgetMs, runWithAbortSignal } from "@/lib/abort-context";
import { generateStructuredObject } from "@/lib/ai/json";
import { isLanguageCheckEnabled } from "@/lib/ai/model-config";
import {
  acceptCorrection,
  buildLanguageRepairInput,
  buildLanguageRepairInstructions,
  languageRepairSchema,
  reattachPadding,
  shouldCheckLanguage,
  splitForRepair,
} from "@/lib/ai/language-repair";
import { generationCacheKey, stageModelCacheKeyPart, withGenerationCheckpoint } from "@/lib/notes/generation-cache";
import type { GeminiUsageContext } from "@/lib/ai/usage-logging";

/**
 * The server side of the language repair: one model call per passage, on the `language_check`
 * stage.
 *
 * It goes through `generateStructuredObject` rather than straight to the gateway so it inherits
 * the chain every other call in the product has — OpenRouter first, and the same weights bought
 * directly from Google when the gateway is the thing that is down — plus the usage log, so this
 * pass shows up in the cost report like any other stage rather than as an unexplained rise.
 *
 * Every failure mode returns null and the caller keeps what it had. That is the whole contract:
 * a repair that cannot be made is not an error, it is a turn that goes out as written.
 */

/** A passage below this is a fragment with nothing to judge — a stray "Ja." or a table rule. */
const MIN_REPAIRABLE_CHARS = 12;

/**
 * Output budget for one repair.
 *
 * The answer is the input with a few characters changed, so the input's own size is the budget,
 * with room for the JSON envelope and for a language whose repaired form runs longer. A repair
 * that wants materially more than this is not a repair.
 */
function repairMaxOutputTokens(text: string) {
  return Math.min(8_000, Math.max(512, Math.ceil(text.length / 2) + 256));
}

export type RepairPassageParams = {
  text: string;
  /** What came immediately before, so a fragment is judged in the sentence it belongs to. */
  preceding?: string;
  /** The language the material is written in, as a code. */
  language: string;
  /** Spoken text is checked for what a synthesizer would mispronounce; written text keeps markdown. */
  spoken: boolean;
  /**
   * Cancels the call. The caller's deadline is authoritative — the tutor abandons a repair that
   * is late — and without this the abandoned call would keep a socket, and the retry ladder
   * underneath it, running behind every unit after it.
   */
  signal?: AbortSignal;
  usageContext?: GeminiUsageContext;
};

/**
 * Repairs one passage, or returns null to say "use what you had".
 *
 * Null covers every way this can go wrong and they are deliberately not distinguished: a refused
 * schema, a timeout, an aborted call, a gateway outage, and a repair that failed the acceptance
 * guard all mean the same thing to a caller, which is that the original text stands.
 */
export async function repairPassage(params: RepairPassageParams): Promise<string | null> {
  if (
    !isLanguageCheckEnabled() ||
    !shouldCheckLanguage(params.language) ||
    params.text.trim().length < MIN_REPAIRABLE_CHARS
  ) {
    return null;
  }

  const outerSignal = getCurrentAbortSignal();
  const signal =
    params.signal && outerSignal
      ? AbortSignal.any([params.signal, outerSignal])
      : (params.signal ?? outerSignal);

  const call = async () => {
    const result = await generateStructuredObject({
      schema: languageRepairSchema,
      stage: "language_check",
      instructions: buildLanguageRepairInstructions(params.language, { spoken: params.spoken }),
      input: buildLanguageRepairInput({ text: params.text, preceding: params.preceding ?? "" }),
      maxOutputTokens: repairMaxOutputTokens(params.text),
      // A repair is optional by construction, so persisting with a failing one buys nothing the
      // caller needs — it already has text it can use.
      maxAttempts: 1,
      usageContext: { ...(params.usageContext ?? {}), stage: "language_check" },
    });

    /*
     * A model returns its answer trimmed, and in markdown the whitespace around a passage is
     * structure: the blank line that ends a paragraph and the newline that ends a table row are
     * the difference between a document and one long line. Spoken units need it for a smaller
     * reason and the same fix — without the spaces that held a unit apart from its neighbours,
     * the synthesizer pronounces the last word of one and the first of the next as one word.
     */
    return acceptCorrection(params.text, result.corrected, { markdown: !params.spoken })
      ? reattachPadding(params.text, result.corrected)
      : null;
  };

  try {
    /*
     * The surrounding invocation's deadline is carried across with the signal. Without it the
     * repair would run under a fresh context that believes it has all the time in the world, and
     * a call started with twenty seconds of invocation left would happily buy a thirty-second
     * attempt whose answer nothing will ever read.
     */
    const remainingMs = getRemainingBudgetMs();
    const deadlineAt = remainingMs === undefined ? undefined : Date.now() + remainingMs;

    return signal
      ? await runWithAbortSignal(signal, call, deadlineAt ? { deadlineAt } : undefined)
      : await call();
  } catch (error) {
    // Not console.error: this is a pass that is allowed to fail, and a learner whose repair did
    // not happen still gets their turn. Logging it as an error would page somebody for a no-op.
    console.warn("[language-check] repair skipped", error);

    return null;
  }
}

/**
 * The BCS/Estonian audit found foreign connective words and inflection errors in written notes.
 * Check new note passages once, preserving markdown and keeping the original on a missed deadline.
 * This runs during note creation, never on the tutor's response path.
 */
export async function repairWrittenNote(params: {
  text: string;
  language: string | null;
  usageContext?: GeminiUsageContext;
}): Promise<string> {
  const language = params.language;
  if (!language || !isLanguageCheckEnabled() || !shouldCheckLanguage(language)) return params.text;
  const passages = splitForRepair(params.text);
  const repaired: string[] = [];
  for (let start = 0; start < passages.length; start += 2) {
    repaired.push(...await Promise.all(passages.slice(start, start + 2).map(async (text, offset) => {
      const preceding = passages[start + offset - 1]?.slice(-600) ?? "";
      const result = await withGenerationCheckpoint({
        lectureId: params.usageContext?.lectureId,
        stage: "note_language_check",
        cacheKey: generationCacheKey([
          "written-language-v1", stageModelCacheKeyPart("language_check"),
          language, text, preceding,
        ]),
        schema: languageRepairSchema,
        generate: async () => ({ corrected: await repairPassage({
          text, preceding, language, spoken: false,
          signal: AbortSignal.timeout(12_000), usageContext: params.usageContext,
        }) ?? text }),
      });
      return result.corrected;
    })));
  }
  return repaired.join("");
}
