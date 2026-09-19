// Kept free of "server-only" so the stage/model/thinking contract stays unit-testable
// (tests/ai-model-config.test.mjs) and reusable by scripts/note-eval.mjs outside Next.js.

import { STRUCTURED_FALLBACK_RESERVE_MS } from "./attempt-budget.ts";

export type ThinkingLevel = "minimal" | "low" | "medium" | "high";

export const AI_STAGES = [
  "source_language",
  "speech_translation",
  "source_condense",
  "note_extract",
  "note_outline",
  "note_write",
  "coverage_plan",
  "study_items",
  "chat",
  "mindmap",
  "tutor_plan",
  "tutor_turn",
  "podcast_script",
  "language_check",
] as const;

export type AiStage = (typeof AI_STAGES)[number];

/**
 * How OpenRouter should pick among the hosts serving a model.
 *
 * "throughput" is right for the note pipeline, where a call runs unwatched inside an Inngest
 * step and finishing sooner is all that matters. "latency" is right for the tutor, where the
 * learner is sitting in silence waiting for the first word and the tail of the distribution
 * is what they feel. Measured on GLM 5.3 Flash, six trials each: throughput-sorted teach
 * turns started at a p50 of 6900ms and a p90 of 11649ms; latency-sorted, 938ms and 2855ms.
 */
export type ProviderSort = "throughput" | "latency";

type StageDefaults = {
  thinkingLevel: ThinkingLevel;
  /** Omitted means "throughput", which is what every stage but the tutor wants. */
  providerSort?: ProviderSort;
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

/**
 * The model that checks GLM's language, routed through the same gateway as everything else.
 *
 * It is never asked to decide anything — the material is already chosen and the topic already
 * taught — so this is not a question of how capable a model is. It is a question of which one
 * knows the language, and the answer was not the obvious one.
 *
 * Measured 2026-09-04 over 72 repair calls on real Slovenian tutor units, with every change the
 * checker made put to a native-speaker judge (scripts/language-check-bench.mjs):
 *
 *   model                   first unit p50/p90   later p50/p90   repairs   damage
 *   gemini-3.5-flash-lite        736 / 825ms      850 /  917ms        22        0
 *   gemini-2.5-flash             729 / 781ms     1009 / 1155ms        24        0
 *   gemini-2.5-flash-lite        710 / 1229ms    1107 / 1453ms        19        6
 *
 * The cheapest of them is the one that cannot be used. 2.5-flash-lite finds nearly as much as
 * the others and breaks correct Slovenian while doing it: it "repaired" the reflexive "seboj"
 * into "njo", turned the session layer "sejna" into "seja", replaced a mangled word with "papež"
 * — the Pope — and, on a checker whose output is spoken aloud, wrote "postrg(n)alo", brackets and
 * all. A checker that damages one edit in five is worse than no checker, because the writer's
 * misspelling is still recognisably the right word and a confident wrong correction is not.
 *
 * 3.5-flash-lite makes the most repairs per millisecond of the three, damaged nothing, and has by
 * far the tightest tail — which is what the spoken path actually buys, since a repair that misses
 * its deadline is a repair that does not happen. Its 3.x thinking is off for the same reason it
 * is off on the tutor stage: reasoning tokens here are pure latency.
 *
 * When OpenRouter cannot serve it, json.ts's chain buys the same weights directly from Google.
 */
export const LANGUAGE_CHECK_MODEL = "or/google/gemini-3.5-flash-lite";

/**
 * The model that writes what the tutor says out loud.
 *
 * Not GLM, which writes the running order — see the `tutor_plan` stage. The two halves of the
 * tutor want opposite things and were measured separately on 2026-09-04
 * (scripts/tutor-language-sweep.mjs, omrezja-sl, 10 pooled trials on the seven-layer OSI topic):
 *
 *   writer                  1st word p50/p90   names all 7 layers   words   err/100w   $/session
 *   gemini-3.5-flash-lite       771 /  808ms          10/10          154    0.26-0.39     $0.030
 *   glm-5.3-flash + check      2817 / 4225ms            5/5          182    0.11-0.19     $0.047
 *   gemini-2.5-flash-lite       578 /  636ms           6/10          102    0.00-0.58     $0.008
 *   gemini-2.5-flash            697 / 1159ms            3/10          105    0.20-0.38     $0.028
 *
 * The top two teach the same material — every layer, every run — and one of them does it three
 * times faster for a third less money. Measured end to end through the synthesizer, that is 1.15s
 * to the first sound against 3.5s, which is the difference between the two things the spoken
 * prompt is written around: under about a second and a half reads as a conversation, past three
 * as a machine thinking.
 *
 * What it costs is the cleanest Slovenian: GLM's output run through the language checker is about
 * twice as correct as this. That trade was made deliberately and it is the smaller number — both
 * sit far below GLM's own unchecked 0.55-1.06, and neither is what a learner notices next to a
 * two-second silence.
 *
 * The two cheap Geminis are not options however tempting the price. Both write good Slovenian and
 * both are fast, and both drop the material: they come in around 100 words against the prompt's
 * explicit 120-word floor, and 2.5-flash named all seven layers three times in ten — once it
 * named two. A turn that does not teach the topic is not cheaper, it is wasted.
 */
export const TUTOR_VOICE_MODEL = "or/google/gemini-3.5-flash-lite";

const STAGE_DEFAULTS: Record<AiStage, StageDefaults> = {
  source_language: { thinkingLevel: "minimal", outputHeadroom: 1, defaultModel: LANGUAGE_CHECK_MODEL, providerSort: "latency" },
  speech_translation: { thinkingLevel: "minimal", outputHeadroom: 1, defaultModel: LANGUAGE_CHECK_MODEL, providerSort: "latency" },
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
  /*
   * The one stage a learner sits and watches, so it is routed the way the tutor is: by
   * latency, not throughput. The two sorts were measured against each other on this same
   * model on 2026-09-04 (see `ProviderSort`) — 938ms to the first word against 6900ms at the
   * median, and 2855ms against 11649ms at p90. Nothing about the answer changes; the wait
   * before it starts appearing does, and on a chat panel that wait is the whole impression.
   */
  chat: {
    thinkingLevel: "minimal",
    outputHeadroom: 1,
    defaultModel: GLM_TEXT_MODEL,
    providerSort: "latency",
  },
  /*
   * The mind map: one call that reads the finished note and re-shapes it as a tree.
   *
   * It thinks for the same reason the outline does. Both are the one place in their pipeline
   * where *global* judgment happens — what the whole material is about, which topics are peers
   * and which are details of another — and neither can be done a chunk at a time. Unlike the
   * outline it writes a few thousand tokens rather than tens of thousands, so `medium` buys the
   * judgment without the outline's cost.
   */
  mindmap: { thinkingLevel: "medium", outputHeadroom: 2.5, defaultModel: GLM_TEXT_MODEL },
  /*
   * The running order for a session: which topics exist, in which order, and what each has to
   * land. It is never spoken and nobody reads it, so none of the prose considerations that
   * decide the `tutor_turn` model apply here. It is judged on one thing, and it is the thing
   * that decides what the session teaches at all — a fact the plan leaves out is a fact the
   * walkthrough never reaches, however well the turns are written.
   *
   * Marked against the omrezja-sl fixture's own 23-fact answer key on 2026-09-04, GLM covered
   * 23 of 23 on every run. gemini-3.5-flash-lite, which writes the spoken turns better than GLM
   * does, covered 9. That is the whole reason the tutor runs on two models instead of one.
   *
   * It is slow, and it is allowed to be. Six runs at production's own budget took 19, 25, 45,
   * 49, 50 and 51 seconds — GLM writes about 1,100 tokens here at 20-60 tokens a second, and no
   * setting changes that. What it must not do is share the spoken turn's twenty-second leash,
   * which it did until 2026-09-04: five runs in six blew it, and each one aborted a paid call
   * and handed the session a fallback plan covering half the material. The plan is fetched
   * beside the opening turn and covered by roughly a minute of greeting, so the seconds here are
   * ones nobody is sitting through.
   */
  tutor_plan: {
    thinkingLevel: "minimal",
    outputHeadroom: 1,
    defaultModel: GLM_TEXT_MODEL,
    providerSort: "latency",
  },
  /*
   * One spoken turn of the voice tutor. Two things pull against each other here, and the
   * choice between them was the product owner's, made on the numbers below.
   *
   * Latency is felt more sharply here than anywhere else in the product. Everywhere else a
   * model answers into a page somebody is reading; here it answers a person who has just
   * interrupted out loud and is waiting in silence. Under about a second and a half to the
   * first sound reads as a conversation; past three it reads as a machine thinking.
   *
   * Measured 2026-09-02 on the omrezja-sl fixture. Time to first token, and the Slovenian
   * graded by having gemini-3.7-flash proofread every sample for grammar and word-form
   * errors ("covered" is how many of the seven OSI layers the turn actually taught, since
   * the topic's points name all of them):
   *
   *   model                   teach ttft   answer ttft   words     covered   errors/100w
   *   glm-5.3-flash             see below    see below   150-231   7/7 all       1.33
   *   gemini-2.5-flash              536ms        470ms    84-129   7/7 all       0.00
   *   gemini-3.5-flash-lite         793ms        711ms   100-155   7,1,7         0.00
   *   gemini-3.7-flash             3114ms       3047ms       140   —             —
   *   gpt-5.6-luna                 3406ms       3899ms       137   —             —
   *
   * GLM teaches the best turns of anything measured and costs a quarter of the Gemini pair,
   * and it is what the rest of the product already runs on. What it costs is spoken
   * correctness: roughly one error every 75 words, and they are not case slips a listener
   * forgives but invented words — "faxenco", "komban", "pošiljateljnico", "koca" four times
   * in one answer where "kocka" was meant. A reader repairs those silently; the synthesizer
   * pronounces them. Both fixes were tried and neither moved the rate: an explicit "write it
   * correctly" instruction (1.31 vs 1.33), and pinning to Z.AI's own first-party endpoint
   * (1.60) or Novita (1.28). So it is the model, not the prompt and not a bad host.
   *
   * That trade was accepted deliberately. Keep the two facts together if it is ever revisited:
   * the notes pipeline shows no such problem because nobody hears a note, and the moment the
   * same text is spoken the same error rate becomes audible.
   *
   * The lesson plan runs on this model too. It was briefly split onto gemini-2.5-flash for
   * speed, which was a mistake: marked against the omrezja-sl fixture's own 23-fact answer
   * key, GLM's plans covered 94% (22, 22, 21) to Gemini's 74% (19, 17, 19, 13), and the bad
   * Gemini run dropped LAN, WAN and MAN entirely. Planning quality is not prose quality —
   * the plan decides which topics exist, and one it omits is one the walkthrough never
   * teaches. The speed that split bought had also stopped mattering, since the plan is
   * fetched alongside the opening turn rather than ahead of it.
   *
   * Latency is handled rather than accepted. GLM's spread through the gateway is its real
   * weakness — an order of magnitude between sessions — so this is the one stage that asks
   * OpenRouter to sort hosts by latency instead of throughput. Six trials each, measured
   * together:
   *
   *   sort: throughput (the default)   teach p50 6900ms p90 11649ms | answer p50 9576ms
   *   sort: latency                    teach p50  938ms p90  2855ms | answer p50 4078ms
   *
   * A max_price cap on top of that was tried and made the tail worse (answer p90 17095ms),
   * so it is not used. If interruption latency ever needs to come down further without
   * giving up GLM's teaching, the split to reach for is per-turn-kind: teach turns on GLM,
   * where a second between topics is invisible, and answer turns on gemini-2.5-flash, where
   * the learner is waiting. Thinking stays off — reasoning tokens are pure latency here.
   */
  tutor_turn: {
    thinkingLevel: "minimal",
    outputHeadroom: 1,
    defaultModel: TUTOR_VOICE_MODEL,
    providerSort: "latency",
  },
  /*
   * One podcast episode, written in full before a word of it is heard.
   *
   * Nothing about this call is latency-sensitive: the listener is watching a progress bar and
   * expects to wait, the way they wait for every other product that does this. What it is
   * sensitive to is the failure the note pipeline already measured models on — dropping the
   * material. An episode that comes back charming and empty is a worse outcome here than in a
   * note, because there is no page to fall back to and the emptiness only becomes obvious ten
   * minutes in. So this stage takes the shared writer, which is the one that held its recall.
   *
   * Thinking is on at medium and its headroom with it. A script is a single call that has to
   * decide the running order of the whole episode and then write it — the same kind of work as
   * the outline, where thinking is the one place in this pipeline it measurably paid.
   */
  /*
   * Why this stage did NOT follow the tutor onto a Gemini.
   *
   * The tutor's answer to GLM's Slovenian was to change the writer, not to check it — see
   * writerNeedsLanguageCheck. Tried here on 2026-09-04 with gemini-3.5-flash-lite writing the
   * script, twice, against GLM's four runs on the same fixture:
   *
   *   writer                  recall        words (asked 920)
   *   glm-5.3-flash           23/23 x4      670-790
   *   gemini-3.5-flash-lite   20/23, 18/23  441, 504
   *
   * It is not close, and the reason is structural rather than a matter of quality. The tutor's
   * writer is handed a plan, a topic and its points, so the hard part — carrying the lecture —
   * has already been done by GLM upstream. This one is handed sixty thousand characters and has
   * to hold the whole thing in a single call, which is the exact job GLM was picked for. Half an
   * episode in better Slovenian is a worse episode.
   *
   * So the writer stays, and the defect it comes with is caught by the proofreading pass in
   * podcast.ts instead — which the tutor cannot afford, because there the check sits between a
   * learner and the first sound, and here it runs once behind a progress bar.
   */
  podcast_script: { thinkingLevel: "medium", outputHeadroom: 2.5, defaultModel: GLM_TEXT_MODEL },
  /*
   * Repairing the language of text another model has already written — one passage of a note,
   * or one unit of a spoken turn while the rest of it is still being written.
   *
   * Not on GLM, and it is the one stage that must not be: this is the pass that exists because
   * GLM's Slovenian is wrong about once every hundred and thirty words, and a checker with the
   * same weakness would be an expensive no-op. Which model it is instead was measured rather
   * than assumed — see LANGUAGE_CHECK_MODEL, where the cheapest candidate turned out to be the
   * one that breaks the language it is meant to be fixing.
   *
   * Latency-sorted for the same reason the tutor stage is: on the spoken path this call sits
   * between the learner and the first sound. Thinking is off — reasoning tokens here are pure
   * latency, and the task is recognition, not deliberation.
   */
  language_check: {
    thinkingLevel: "minimal",
    outputHeadroom: 1,
    defaultModel: LANGUAGE_CHECK_MODEL,
    providerSort: "latency",
  },
};

const STAGE_MODEL_ENV_KEYS: Record<AiStage, string> = {
  source_language: "GEMINI_SOURCE_LANGUAGE_MODEL",
  speech_translation: "GEMINI_SPEECH_TRANSLATION_MODEL",
  source_condense: "GEMINI_SOURCE_CONDENSE_MODEL",
  note_extract: "GEMINI_NOTE_EXTRACT_MODEL",
  note_outline: "GEMINI_NOTE_OUTLINE_MODEL",
  note_write: "GEMINI_NOTE_WRITE_MODEL",
  coverage_plan: "GEMINI_COVERAGE_MODEL",
  study_items: "GEMINI_STUDY_ITEMS_MODEL",
  chat: "GEMINI_CHAT_MODEL",
  mindmap: "GEMINI_MINDMAP_MODEL",
  tutor_plan: "GEMINI_TUTOR_PLAN_MODEL",
  tutor_turn: "GEMINI_TUTOR_TURN_MODEL",
  podcast_script: "GEMINI_PODCAST_SCRIPT_MODEL",
  language_check: "GEMINI_LANGUAGE_CHECK_MODEL",
};

const STAGE_THINKING_ENV_KEYS: Record<AiStage, string> = {
  source_language: "GEMINI_SOURCE_LANGUAGE_THINKING",
  speech_translation: "GEMINI_SPEECH_TRANSLATION_THINKING",
  source_condense: "GEMINI_SOURCE_CONDENSE_THINKING",
  note_extract: "GEMINI_NOTE_EXTRACT_THINKING",
  note_outline: "GEMINI_NOTE_OUTLINE_THINKING",
  note_write: "GEMINI_NOTE_WRITE_THINKING",
  coverage_plan: "GEMINI_COVERAGE_THINKING",
  study_items: "GEMINI_STUDY_ITEMS_THINKING",
  chat: "GEMINI_CHAT_THINKING",
  mindmap: "GEMINI_MINDMAP_THINKING",
  tutor_plan: "GEMINI_TUTOR_PLAN_THINKING",
  tutor_turn: "GEMINI_TUTOR_TURN_THINKING",
  podcast_script: "GEMINI_PODCAST_SCRIPT_THINKING",
  language_check: "GEMINI_LANGUAGE_CHECK_THINKING",
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
  return STAGE_FALLBACK_MODELS[stage] ?? null;
}

/*
 * The two stages that may not inherit GEMINI_TEXT_MODEL as their fallback.
 *
 * `note_write` is the older of the two: the 2026-08-23 measurement showed models separate
 * hardest there.
 *
 * `chat` was added on 2026-09-19, after watching the fallback tier answer for itself on a
 * preview deployment (which has no OPENROUTER_API_KEY, so every chat answer there IS the
 * fallback). Asked "Hvala, super razlaga!" at the end of a Slovenian conversation,
 * gemini-2.5-flash-lite repeated its previous answer — in English. Measured against the same
 * prompt and fixture, twelve answers each (scripts/chat-eval.mjs --model=...):
 *
 *   model                   right language   opens with the answer   did what was asked   warm
 *   gemini-2.5-flash-lite            83%              83%                    75%           25%
 *   gemini-3.5-flash-lite           100%             100%                   100%           83%
 *
 * That is the same model that already writes what the spoken tutor says out loud and checks
 * GLM's Slovenian (TUTOR_VOICE_MODEL, LANGUAGE_CHECK_MODEL) — it is trusted with
 * learner-facing prose in this product precisely because it gets these things right. It costs
 * $0.3/$2.5 per million against $0.1/$0.4, on a tier that only runs when the primary has
 * already failed, for an answer of a couple of hundred tokens.
 *
 * This matters more now than it did: the chat stage's own 60s leash (STAGE_TIMEOUT_MS) means a
 * struggling primary reaches this tier sooner and more often than it used to.
 */
const STAGE_FALLBACK_MODELS: Partial<Record<AiStage, string>> = {
  note_write: "or/google/gemini-3.7-flash",
  chat: "or/google/gemini-3.5-flash-lite",
};

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
  providerSort: ProviderSort;
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
    providerSort: defaults.providerSort ?? "throughput",
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
  /*
   * A spoken turn that has not started arriving in twenty seconds is not going to be a
   * conversation whatever it eventually says. Failing fast lets the client apologise and
   * hand the floor back, which is far better than a learner sitting in silence for a minute.
   */
  tutor_turn: 20_000,
  /*
   * The plan's own leash, and the reason it has one. Sharing the spoken turn's twenty seconds
   * meant aborting GLM on five runs in six and teaching from a fallback plan that covered half
   * the material; ninety seconds clears the measured distribution (19-51s) with room for a bad
   * day, and it is time the opening turn is already speaking through.
   */
  tutor_plan: 90_000,
  /*
   * A whole episode in one call, and nobody is listening yet — the screen is showing a progress
   * bar and the wait is the wait every product that does this has. So this is sized by what the
   * work costs rather than by what a listener will sit through: the writer produces a couple of
   * thousand words at 20-60 tokens a second, which the shared 90s default cannot hold.
   */
  podcast_script: 240_000,
  /*
   * One thinking call over the whole note, with a reader watching a spinner for it. The default
   * ninety seconds is the wrong shape for both halves of that: too tight for a long note on a
   * thinking model, and long enough that a stalled call leaves nothing but a spinner. Three
   * minutes clears the work and still leaves the 300s route budget room for the direct-provider
   * fallback underneath it.
   */
  mindmap: 180_000,
  /*
   * The repair is optional by construction: on the spoken path a unit whose repair is late is
   * spoken as it was written, and in a note a passage that fails to come back is kept as it was.
   * So this leash is only here to stop a stalled call holding an invocation open — the caller's
   * own deadline is what the learner actually feels.
   */
  language_check: 30_000,
  /*
   * A chat answer is a couple of hundred tokens with somebody watching the panel, and it had
   * no leash at all: it took OpenRouter's 180s default, which is not a timeout for this stage
   * so much as the absence of one. Two things went wrong with that. A learner waited three
   * minutes to be told it had failed, and — because the streamed attempt and the plain call it
   * falls back to were each sized at 180s inside a 300s invocation — the platform could kill
   * the function mid-fallback and send no error frame at all (the 504 of 2026-09-16, locked
   * down in tests/chat-stream-route-budget.test.mjs).
   *
   * Sixty seconds is far past anything a healthy call needs and still leaves most of the
   * invocation for the recovery underneath it: a stalled primary now fails at 60s and the
   * fallback answers inside the same minute or two, which is the difference between a late
   * answer and no answer.
   */
  chat: 60_000,
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
  podcast_script: 200_000,
  // Chat wants the same short leash whichever model runs it: the learner is waiting either
  // way. Named here so the mandatory-reasoning branch cannot quietly restore the 180s default.
  chat: 60_000,
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

/**
 * The switch that turns the language repair off without a deploy.
 *
 * Every other knob in this file changes which model runs a stage; this one decides whether a
 * stage runs at all, and it exists because the language check is the only pass in the product
 * that edits text another model has already approved. Everything about it is built to fail
 * safe — a repair that is late, refused or impossible leaves the original standing — but "fail
 * safe" is a claim about the failures that were anticipated. If it ever misbehaves in a way
 * nobody predicted, an operator needs to be able to stop it in the time it takes to change an
 * environment variable, not in the time it takes to ship.
 *
 * Off is spelled the obvious ways because whoever reaches for this will be in a hurry.
 */
/**
 * Whether text from this writer is worth checking.
 *
 * The language check exists for one measured defect: GLM writes 0.55-1.06 errors per 100 words
 * of spoken Slovenian, including words that do not exist, which the synthesizer then pronounces.
 * The Gemini that replaced it as the tutor's writer on 2026-09-04 sits at 0.26-0.39 without any
 * help, and buying the rest of that gap costs about 950ms in front of every turn — which is most
 * of what the switch was for.
 *
 * So the check follows the writer rather than a flag. It is off while a Gemini writes the turns,
 * and setting GEMINI_TUTOR_TURN_MODEL back to GLM turns it on again in the same breath, with no
 * second setting to remember and no way to roll back to the fast model and the slow safety net
 * at once.
 */
export function writerNeedsLanguageCheck(model: string) {
  return !isGeminiModel(model);
}

export function isLanguageCheckEnabled(env: NodeJS.ProcessEnv = process.env) {
  const value = env.LANGUAGE_CHECK?.trim().toLowerCase();

  return !(value === "off" || value === "0" || value === "false" || value === "disabled");
}

export const AI_STAGE_MODEL_ENV_KEYS = STAGE_MODEL_ENV_KEYS;
export const AI_STAGE_THINKING_ENV_KEYS = STAGE_THINKING_ENV_KEYS;
