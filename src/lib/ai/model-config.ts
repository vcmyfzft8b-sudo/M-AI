// Kept free of "server-only" so the stage/model/thinking contract stays unit-testable
// (tests/ai-model-config.test.mjs) and reusable by scripts/note-eval.mjs outside Next.js.

export type ThinkingLevel = "minimal" | "low" | "medium" | "high";

export const AI_STAGES = [
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

const STAGE_DEFAULTS: Record<AiStage, StageDefaults> = {
  // High volume, one chunk at a time, no cross-chunk judgment to make.
  note_extract: { thinkingLevel: "minimal", outputHeadroom: 1 },
  // Decides what the finished note covers and drops. One call per source, so thinking is cheap
  // here and this is the only place global importance is judged.
  note_outline: { thinkingLevel: "medium", outputHeadroom: 2.5 },
  // The single hardest call in the product, and one per source.
  note_write: {
    thinkingLevel: "high",
    outputHeadroom: 2.5,
    defaultModel: "or/google/gemini-3.7-flash",
  },
  coverage_plan: { thinkingLevel: "low", outputHeadroom: 1.6 },
  study_items: { thinkingLevel: "low", outputHeadroom: 1.6 },
  chat: { thinkingLevel: "minimal", outputHeadroom: 1 },
};

const STAGE_MODEL_ENV_KEYS: Record<AiStage, string> = {
  note_extract: "GEMINI_NOTE_EXTRACT_MODEL",
  note_outline: "GEMINI_NOTE_OUTLINE_MODEL",
  note_write: "GEMINI_NOTE_WRITE_MODEL",
  coverage_plan: "GEMINI_COVERAGE_MODEL",
  study_items: "GEMINI_STUDY_ITEMS_MODEL",
  chat: "GEMINI_CHAT_MODEL",
};

const STAGE_THINKING_ENV_KEYS: Record<AiStage, string> = {
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
 * A model only honours a thinking level if it reasons at all. Sending thinkingConfig to a 2.5
 * Gemini is accepted but meaningless, and 2.5-flash-lite does not think, so the headroom
 * multiplier has to collapse back to 1 or every budget is inflated for no reason.
 */
export function supportsThinkingLevel(model: string) {
  if (isOpenAiReasoningModel(model)) {
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

  const minimalHeadroom = isOpenAiReasoningModel(model) ? OPENAI_MINIMAL_EFFORT_HEADROOM : 1;

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

export const AI_STAGE_MODEL_ENV_KEYS = STAGE_MODEL_ENV_KEYS;
export const AI_STAGE_THINKING_ENV_KEYS = STAGE_THINKING_ENV_KEYS;
