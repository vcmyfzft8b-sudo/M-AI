// Kept free of "server-only" so the stage/model/thinking contract stays unit-testable
// (tests/ai-model-config.test.mjs) and reusable by scripts/note-eval.mjs outside Next.js.

import { STRUCTURED_FALLBACK_RESERVE_MS } from "./attempt-budget.ts";

export type ThinkingLevel = "minimal" | "low" | "medium" | "high";

export const AI_STAGES = [
  "source_condense",
  "note_extract",
  "note_outline",
  "note_write",
  "coverage_plan",
  "study_items",
  "chat",
] as const;

export type AiStage = (typeof AI_STAGES)[number];

type StageDefaults = {
  thinkingLevel: ThinkingLevel;
  /**
   * Thinking tokens are drawn from maxOutputTokens, not billed beside it: a 300-token cap with
   * thinking on returns 9 answer tokens and finishReason MAX_TOKENS. Every stage budget is
   * multiplied by its stage's headroom so a thinking model does not read as truncation and
   * trigger the retry ladder in structured-output.ts.
   */
  outputHeadroom: number;
  /**
   * A stage names its own model only when the measurement said the shared default is not good
   * enough for it. Note writing is still the only such stage, and re-measured 2026-08-23 against
   * the learning-science prompt it is the stage where models separate hardest: asked to teach,
   * question and explain at once, 3.5-flash-lite drops facts to fit (92-94% recall) and
   * 2.5-flash-lite collapses on a bad run (43%), while 3.7-flash holds 100% on every fixture with
   * zero loss in the writing step. Everything else stays on the cheap model, where four candidates
   * scored the same and only the price differed.
   */
  defaultModel?: string;
};

/**
 * The shared default for every text stage since 2026-08-28: GLM 5.3 Flash routed through
 * OpenRouter. The 2026-08-28 bake-off measured it beating the previous per-stage mix on recall
 * (87.6-95.5% against production's 85.8%) at $0.075/$0.25 per million — a quarter of
 * 2.5-flash-lite's card and an eighth of routed 3.7-flash's.
 *
 * What it cannot do decides what stays on Gemini: GLM takes text, image and video only, so every
 * call that sends a PDF page, an office document, a scan or audio to the model (the OCR stages,
 * pptx_vision, gemini_text_file, doc_image_relevance and the *WithGeminiFile entrypoints) keeps
 * its proven Gemini model, and embeddings keep gemini-embedding-001. It is also 3-5x slower than
 * Gemini (~50-80 tokens/s), which is why the write stage is windowed (note-prompts.ts) and the
 * outline is gated by size (note-generation.ts) — each call must fit a 300s Vercel invocation.
 */
export const GLM_TEXT_MODEL = "or/z-ai/glm-5.3-flash";

const STAGE_DEFAULTS: Record<AiStage, StageDefaults> = {
  // Selection over one chunk at a time: reads a lot, writes unit numbers. Same profile as
  // extraction — high volume, local judgment, and thinking measurably hurts this kind of call.
  source_condense: { thinkingLevel: "minimal", outputHeadroom: 1, defaultModel: GLM_TEXT_MODEL },
  // High volume, one chunk at a time, no cross-chunk judgment to make.
  note_extract: { thinkingLevel: "minimal", outputHeadroom: 1, defaultModel: GLM_TEXT_MODEL },
  // Decides what the finished note covers and drops. One call per source, so thinking is cheap
  // here and this is the only place global importance is judged.
  note_outline: { thinkingLevel: "medium", outputHeadroom: 2.5, defaultModel: GLM_TEXT_MODEL },
  // The single hardest call in the product, and one per source (or one per part on a large
  // source — see planSourceWriteWindows). The bake-off's write-only GLM row scored +7.1 recall
  // points over routed 3.7-flash at -62% cost.
  note_write: {
    thinkingLevel: "high",
    outputHeadroom: 2.5,
    defaultModel: GLM_TEXT_MODEL,
  },
  coverage_plan: { thinkingLevel: "low", outputHeadroom: 1.6, defaultModel: GLM_TEXT_MODEL },
  study_items: { thinkingLevel: "low", outputHeadroom: 1.6, defaultModel: GLM_TEXT_MODEL },
  chat: { thinkingLevel: "minimal", outputHeadroom: 1, defaultModel: GLM_TEXT_MODEL },
};

const STAGE_MODEL_ENV_KEYS: Record<AiStage, string> = {
  source_condense: "GEMINI_SOURCE_CONDENSE_MODEL",
  note_extract: "GEMINI_NOTE_EXTRACT_MODEL",
  note_outline: "GEMINI_NOTE_OUTLINE_MODEL",
  note_write: "GEMINI_NOTE_WRITE_MODEL",
  coverage_plan: "GEMINI_COVERAGE_MODEL",
  study_items: "GEMINI_STUDY_ITEMS_MODEL",
  chat: "GEMINI_CHAT_MODEL",
};

const STAGE_THINKING_ENV_KEYS: Record<AiStage, string> = {
  source_condense: "GEMINI_SOURCE_CONDENSE_THINKING",
  note_extract: "GEMINI_NOTE_EXTRACT_THINKING",
  note_outline: "GEMINI_NOTE_OUTLINE_THINKING",
  note_write: "GEMINI_NOTE_WRITE_THINKING",
  coverage_plan: "GEMINI_COVERAGE_THINKING",
  study_items: "GEMINI_STUDY_ITEMS_THINKING",
  chat: "GEMINI_CHAT_THINKING",
};

const THINKING_LEVELS = new Set<string>(["minimal", "low", "medium", "high"]);

function parseThinkingLevel(value: string | undefined): ThinkingLevel | null {
  const normalized = value?.trim().toLowerCase();

  return normalized && THINKING_LEVELS.has(normalized) ? (normalized as ThinkingLevel) : null;
}

/** Strips a gateway prefix ("or/google/…") so a routed model is recognised as what it is. */
function bareModelName(model: string) {
  return model.replace(/^or\//i, "").replace(/^[a-z0-9-]+\//i, "");
}

/** Every GPT-5 model reasons, and its reasoning tokens are billed and budgeted as output. */
function isOpenAiReasoningModel(model: string) {
  return /^gpt-5/i.test(bareModelName(model));
}

/**
 * Z.ai's GLM 5 family reasons on every call and cannot be told not to: OpenRouter rejects
 * `reasoning: { enabled: false }` outright with "Reasoning is mandatory for this endpoint". Its
 * reasoning tokens are reported inside completion_tokens, so they are billed as output and drawn
 * from max_tokens — the same trap gpt-5-nano fell into, and the reason these models need the
 * minimal-effort headroom below rather than the flat 1 a non-thinking Gemini gets.
 */
function isMandatoryReasoningModel(model: string) {
  return /^glm-5/i.test(bareModelName(model));
}

/**
 * GLM publishes only max/high/low, and an unmapped name silently buys its default — "max", the
 * most expensive setting there is. Every level maps to "low": measured 2026-08-29 on the note
 * fixtures, low-effort GLM matched or beat high-effort on recall (98-100% vs 92-100%) while
 * writing up to 28% shorter and measurably denser notes — for this pipeline's structured work,
 * extra reasoning bought verbosity, not quality. Raising a stage back is a one-line change here,
 * but bring a measurement.
 */
const GLM_REASONING_EFFORT: Record<ThinkingLevel, string> = {
  minimal: "low",
  low: "low",
  medium: "low",
  high: "low",
};

/** The effort name to send on the wire for a model that does not use our four level names. */
export function resolveWireReasoningEffort(model: string, thinkingLevel: ThinkingLevel | null) {
  if (!thinkingLevel) {
    return null;
  }

  return isMandatoryReasoningModel(model) ? GLM_REASONING_EFFORT[thinkingLevel] : thinkingLevel;
}

export { isMandatoryReasoningModel };

/** Whether the direct Gemini API would recognise this model name at all. */
export function isGeminiModel(model: string) {
  return /^gemini-/i.test(bareModelName(model));
}

/**
 * The Gemini a stage falls back to when its GLM call fails — ROUTED through OpenRouter, so that
 * in normal operation every model call in the product rides one gateway and one bill
 * (2026-08-29, at the user's request). The fallback model is still the Gemini that ran the stage
 * before the 2026-08-28 switch: 3.7-flash for the write (the stage where the 2026-08-23
 * measurement showed models separate hardest) and GEMINI_TEXT_MODEL for the rest (signalled
 * here as null, because this module cannot read server env; json.ts routes it).
 *
 * Buying direct from Google remains as the LAST tier only — json.ts strips this id to its bare
 * form when the gateway itself is the thing that is down, because a fallback that shares the
 * primary's gateway shares its outages.
 */
export function resolveStageFallbackModel(stage: AiStage): string | null {
  return stage === "note_write" ? "or/google/gemini-3.7-flash" : null;
}

/**
 * Whether a failed gateway call should be retried against the direct provider.
 *
 * Everything a gateway can do wrong is a reason to fall back — a 5xx, a refused schema, a
 * timeout, and above all a truncation, which is GLM's characteristic failure (measured 2.1% of
 * calls over the first day, mostly on the small high-volume study batches: it occasionally runs
 * past a budget three times its expected output without closing the JSON). A learner's lecture is
 * never worth failing to save a fraction of a cent.
 *
 * The single exception is an abort. The invocation budget aborts work that has already run out of
 * wall clock, so falling back there would start a fresh full-price call on a request that is
 * being killed anyway — spending money to produce nothing.
 */
export function shouldFallBackToDirectProvider(error: unknown, isAborted: (error: unknown) => boolean) {
  return !isAborted(error);
}

/**
 * A model only honours a thinking level if it reasons at all. Sending thinkingConfig to a 2.5
 * Gemini is accepted but meaningless, and 2.5-flash-lite does not think, so the headroom
 * multiplier has to collapse back to 1 or every budget is inflated for no reason.
 */
export function supportsThinkingLevel(model: string) {
  if (isOpenAiReasoningModel(model) || isMandatoryReasoningModel(model)) {
    return true;
  }

  const majorVersion = Number.parseInt(bareModelName(model).match(/gemini-(\d+)/i)?.[1] ?? "", 10);

  return !Number.isNaN(majorVersion) && majorVersion >= 3;
}

/**
 * Gemini at "minimal" genuinely does not think — the production meter records zero thinking tokens
 * for every extraction call — so its budget needs no headroom. A GPT-5 model at minimal effort
 * still reasons, and reasoning comes out of the same budget as the answer: measured 2026-08-23,
 * gpt-5-nano spent 94,656 reasoning tokens across 27 extraction calls and every one of them
 * truncated at a budget sized for a model that does not think.
 */
const OPENAI_MINIMAL_EFFORT_HEADROOM = 2;

export type StageModelConfig = {
  stage: AiStage;
  model: string;
  thinkingLevel: ThinkingLevel | null;
  outputHeadroom: number;
};

export function resolveStageModelConfig(params: {
  stage: AiStage;
  env: Record<string, string | undefined>;
  fallbackModel: string;
}): StageModelConfig {
  const defaults = STAGE_DEFAULTS[params.stage];
  const model =
    params.env[STAGE_MODEL_ENV_KEYS[params.stage]]?.trim() ||
    defaults.defaultModel ||
    params.fallbackModel;
  const thinkingCapable = supportsThinkingLevel(model);
  const thinkingLevel = thinkingCapable
    ? (parseThinkingLevel(params.env[STAGE_THINKING_ENV_KEYS[params.stage]]) ?? defaults.thinkingLevel)
    : null;

  const minimalHeadroom =
    isOpenAiReasoningModel(model) || isMandatoryReasoningModel(model)
      ? OPENAI_MINIMAL_EFFORT_HEADROOM
      : 1;

  return {
    stage: params.stage,
    model,
    thinkingLevel,
    outputHeadroom:
      thinkingLevel && thinkingLevel !== "minimal"
        ? Math.max(defaults.outputHeadroom, minimalHeadroom)
        : minimalHeadroom,
  };
}

export function applyOutputHeadroom(maxOutputTokens: number | undefined, config: StageModelConfig) {
  if (!maxOutputTokens) {
    return undefined;
  }

  return Math.min(65_536, Math.round(maxOutputTokens * config.outputHeadroom));
}

/**
 * Per-stage request timeouts where the shared 90s default is simply wrong for the work. The
 * outline call reads every extracted item (~150k tokens on a large source) and writes a 30-45k
 * token outline — on 2026-08-25 that meant 136 of 236 production outline calls hit the 90s
 * timeout, each abort re-billed by the provider and each retry resending the full input. The
 * write call carries the outline plus the whole source into a thinking model and was hitting the
 * gateway's timeout the same way, falling back to the direct provider at double the price.
 */
const STAGE_TIMEOUT_MS: Partial<Record<AiStage, number>> = {
  note_outline: 240_000,
  note_write: 240_000,
  // The selector reads ~48k chars and writes only unit numbers; measured runs finish in seconds.
  // A short leash matters because condensation runs inline in intake routes: one stalled call
  // must not eat the invocation that six concurrent chunks share.
  source_condense: 60_000,
};

/**
 * GLM gets a shorter leash than the Gemini it replaced, on purpose. Every route runs under
 * Vercel's maxDuration of 300s, and a routed call that fails falls back to a direct Gemini call
 * in the same invocation — so the leash must leave room for the fallback to actually finish:
 * 200s of GLM plus ~60-90s of Gemini fits; 240s of GLM plus a fallback does not, and the step
 * dies having cached nothing. The stage-level 240s remains for direct Gemini calls, where it was
 * measured in (2026-08-25: 136 of 236 outline calls truncating at the old 90s).
 */
const MANDATORY_REASONING_TIMEOUT_MS: Partial<Record<AiStage, number>> = {
  note_outline: 200_000,
  note_write: 200_000,
};

/**
 * Time a slow mandatory-reasoning primary must leave for the next, proven tier. Coverage and
 * study-item generation run pools of calls inside one invocation; unlike a single note call,
 * their first request can start after substantial preparation or an earlier pool wave. A fixed
 * 180s primary timeout therefore cannot know whether its fallback still fits. The attempt is
 * clamped against this reserve at call time instead (openrouter.ts).
 */
const MANDATORY_REASONING_FALLBACK_RESERVE_MS: Partial<Record<AiStage, number>> = {
  coverage_plan: STRUCTURED_FALLBACK_RESERVE_MS,
  study_items: STRUCTURED_FALLBACK_RESERVE_MS,
};

export function resolveStageTimeoutMs(stage: AiStage, model?: string) {
  if (model && isMandatoryReasoningModel(model)) {
    return MANDATORY_REASONING_TIMEOUT_MS[stage] ?? STAGE_TIMEOUT_MS[stage];
  }

  return STAGE_TIMEOUT_MS[stage];
}

export function resolveStageFallbackReserveMs(stage: AiStage, model?: string) {
  return model && isMandatoryReasoningModel(model)
    ? (MANDATORY_REASONING_FALLBACK_RESERVE_MS[stage] ?? 0)
    : 0;
}

export const AI_STAGE_MODEL_ENV_KEYS = STAGE_MODEL_ENV_KEYS;
export const AI_STAGE_THINKING_ENV_KEYS = STAGE_THINKING_ENV_KEYS;
