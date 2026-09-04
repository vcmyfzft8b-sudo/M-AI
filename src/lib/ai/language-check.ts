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
} from "@/lib/ai/language-repair";
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

/*
 * There is deliberately no note-side equivalent of this, and the reason is a measurement rather
 * than an oversight.
 *
 * The written notes were audited on 2026-09-04 with scripts/language-audit.mjs over two Slovenian
 * fixtures — 1,387 words of generated markdown — and they came back at 0.12 and 0.18 errors per
 * 100 words, four to six times cleaner than the same model's spoken turns. Running the repair
 * over them changed nothing: one borderline agreement call before, the same one after, no drift,
 * and three of five passages returned untouched.
 *
 * That is not luck. A note is written in the register that suits a page — headings, tables, terse
 * noun phrases, defined terms — and that register barely inflects. A spoken turn is flowing
 * conversational prose full of analogies and second-person verbs, which is exactly where a model
 * that is shaky on a language shows it. Adding a pass that repairs nothing would buy a call per
 * passage, a rewrite risk on text that is already correct, and no measured gain.
 *
 * `splitForRepair` and the markdown branch of `acceptCorrection` in language-repair.ts exist for
 * the tool that established this, so the decision can be re-taken against a new language or a new
 * writer model rather than argued about:
 *
 *   node --experimental-strip-types scripts/language-audit.mjs --repair evals/output/<note>.md
 */
