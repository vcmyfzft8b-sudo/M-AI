// Kept free of "server-only" so the wire contract and the answer parsing stay unit-testable
// (tests/ai-jev.test.mjs) and callable from scripts/jev-eval.mjs outside Next.js. The usage log
// and the app-level decisions live in decisions.ts, which is server-only.

/**
 * TypeSafe's Jev — a System One model, and the only non-LLM this product calls.
 *
 * It does not generate text. It takes one `state` and a bag of typed `questions`, evaluates every
 * question against that state in a single parallel forward pass, and returns a typed answer per
 * question with a calibrated probability. There is no token stream, no JSON to repair and no
 * schema to validate against: the answer space is enumerated in the request, so an out-of-schema
 * reply is not a thing that can happen.
 *
 * Why it earns a second vendor when every text stage already runs through one gateway:
 *
 * - Output tokens are free and the state is billed once however many questions ride on it. Our
 *   decision calls are all of the shape "here is a list, judge every element", which is exactly
 *   the shape that pricing rewards. Measured on the synapse-en fixture, 1 question cost 1,530
 *   input tokens and 50 questions cost 4,800 — the extra 49 judgments cost $0.00014 between them.
 * - A batch is answered in roughly the time one question takes: 991ms for one, 657ms for fifty.
 *   `item_dedupe` currently pays GLM 30-80 seconds a batch to write out what amounts to 300
 *   integers, at 20-60 tokens/s, in front of a learner waiting for a practice test.
 * - It separates scoring from writing. The extractor rates the importance of the facts it has
 *   just written, and note-prompts.ts:519 says in our own words that it inflates them.
 *
 * What it costs us is a vendor with no second source. Every other model here can be bought from
 * a second host when the first is down (see json.ts); Jev cannot. So nothing in this file throws
 * into a caller: every entry point returns null when Jev is unconfigured, unreachable, rate
 * limited, slow or unreadable, and every call site keeps the path it had before. Jev is an
 * accelerator over working code, never a dependency of it.
 */

/**
 * Vercel's AI Gateway rather than TypeSafe direct.
 *
 * TypeSafe's own API (POST /v1/systemone) is still waitlisted and answers 403 without an
 * approved key. The gateway serves the same model today, and normalises the request a little:
 * what TypeSafe's docs call a "noul" is `boolean` here, and both Choice and Score take their
 * answer space in a field called `criteria`. Verified against the live endpoint on 2026-09-19 —
 * everything in this file is measured, not read off a docs page.
 */
const JEV_ENDPOINT = "https://ai-gateway.vercel.sh/v1/evaluate";

const JEV_MODEL = "typesafe-ai/jev";

/**
 * Jev answers in about a second or something is wrong with it.
 *
 * Deliberately far below any model timeout in this product. A decision that has to be waited on
 * for six seconds has already lost the argument for making it — the fallback path would be most
 * of the way through by then — so this fails fast and hands the caller back to what it had.
 */
export const JEV_TIMEOUT_MS = 6_000;

/**
 * Below this the call is not worth starting. These run inside Inngest steps and Vercel
 * invocations that carry their own deadline, and a decision whose answer lands after the step is
 * abandoned is money spent on nothing.
 */
const JEV_MIN_BUDGET_MS = 1_500;

/**
 * How many questions ride on one request.
 *
 * Not a documented limit — a measured one. On the free tier, 50 questions answer reliably in
 * ~650ms, 150 returns 503 and 300 returns 429. The state is re-sent with each batch, which is
 * the only cost of splitting: on a typical item list that is ~1,400 tokens, or $0.00006 per
 * extra batch. Raise this once the account is on paid credits and the ceiling is known.
 */
export const JEV_QUESTIONS_PER_REQUEST = 50;

/** Jev's documented ceiling on one Choice question's answer space. */
export const JEV_MAX_CHOICE_OPTIONS = 255;

/** Input price per million tokens. Output is not billed at all, which is why there is no rate. */
export const JEV_INPUT_USD_PER_MTOK = 0.042;

/** A yes/no judgment. The answer is the probability itself. */
export type JevBooleanQuestion = {
  type: "boolean";
  instructions: string;
};

/** Pick one. `criteria` maps each option name to what that option means. */
export type JevChoiceQuestion = {
  type: "choice";
  instructions: string;
  criteria: Record<string, string>;
};

/** Rate on a rubric. `criteria` is the rubric, ordered worst to best, 2-10 levels. */
export type JevScoreQuestion = {
  type: "score";
  instructions: string;
  criteria: string[];
};

export type JevQuestion = JevBooleanQuestion | JevChoiceQuestion | JevScoreQuestion;

/**
 * One answer, as the wire returns it.
 *
 * A boolean carries a probability and nothing else — the probability *is* the answer, so there is
 * no separate confidence to read. Choice and Score carry both the answer and a confidence, plus
 * the full distribution they were drawn from.
 *
 * Score's `score` is continuous across the rubric (0 to levels-1), not a level index: a fact that
 * lands at 1.7 on a three-level rubric is genuinely between "worth knowing" and "must know". That
 * is strictly more information than the integer 1-5 our extractor writes today, and it is what
 * makes ranking a list of facts against each other possible at all.
 *
 * Calibration is a population property — across many answers held near 0.9, about nine in ten are
 * right — never a promise about the one in front of you. Enough to gate on, not enough to trust
 * blindly, which is why every consumer here treats a low-confidence answer as no answer.
 */
export type JevAnswer =
  | { type: "boolean"; probability: number }
  | { type: "choice"; choice: string; confidence: number; probabilities: Record<string, number> }
  | {
      type: "score";
      /** 0 to levels-1, continuous. */
      score: number;
      /** `score` rescaled to 0-1, so callers can rank without knowing the rubric's length. */
      normalized: number;
      confidence: number;
      probabilities: Record<string, number>;
    };

export type JevAnswers = Record<string, JevAnswer>;

export type JevUsage = { inputTokens: number; outputTokens: number };

export type JevResponse = {
  answers: JevAnswers;
  usage: JevUsage;
  /** Wall-clock across every request this call made, for the latency numbers in the ledger. */
  durationMs: number;
  /** How many HTTP requests the batch actually took. */
  requestCount: number;
};

export function getJevApiKey() {
  return process.env.AI_GATEWAY_API_KEY?.trim() || process.env.TYPESAFE_API_KEY?.trim() || null;
}

/**
 * Jev decides things only where it is explicitly switched on.
 *
 * Two gates, not one: the key says whether we *can* call it, JEV_DECISIONS says whether we
 * *should*. Keeping them apart is what lets the benchmark hold the key and call Jev directly
 * while production carries the same key and still runs entirely on the old path — which is how
 * this gets measured on real material before it decides anything for a learner.
 */
export function isJevEnabled() {
  return Boolean(getJevApiKey()) && process.env.JEV_DECISIONS === "on";
}

function toFiniteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toProbabilities(value: unknown): Record<string, number> {
  if (typeof value !== "object" || value === null) {
    return {};
  }

  const probabilities: Record<string, number> = {};

  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const probability = toFiniteNumber(raw);

    if (probability !== null) {
      probabilities[key] = probability;
    }
  }

  return probabilities;
}

/**
 * Reads one answer off the wire, or returns null.
 *
 * Null for anything that does not parse cleanly, rather than a default: a Score silently read as
 * 0 would mark a fact disposable, and a boolean read as false would drop it. A missing answer
 * costs the caller its fallback; a wrongly-defaulted one costs a learner the material.
 */
export function parseJevAnswer(raw: unknown): JevAnswer | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }

  const record = raw as Record<string, unknown>;
  const probabilities = toProbabilities(record.probabilities);
  const confidence = toFiniteNumber(record.confidence);

  if (record.type === "boolean") {
    const probability = toFiniteNumber(record.probability);

    return probability === null ? null : { type: "boolean", probability };
  }

  if (record.type === "choice") {
    return typeof record.choice === "string"
      ? { type: "choice", choice: record.choice, confidence: confidence ?? 0, probabilities }
      : null;
  }

  if (record.type === "score") {
    const score = toFiniteNumber(record.score);

    if (score === null) {
      return null;
    }

    // The rubric's length comes back only as the width of the distribution, so normalising uses
    // that. A single-level distribution cannot be rescaled and is reported at the bottom.
    const levels = Object.keys(probabilities).length;
    const span = levels > 1 ? levels - 1 : 1;

    return {
      type: "score",
      score,
      normalized: Math.min(1, Math.max(0, score / span)),
      confidence: confidence ?? 0,
      probabilities,
    };
  }

  return null;
}

export function parseJevAnswers(body: unknown): { answers: JevAnswers; usage: JevUsage } | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }

  const record = body as Record<string, unknown>;

  if (typeof record.answers !== "object" || record.answers === null) {
    return null;
  }

  const answers: JevAnswers = {};

  for (const [key, value] of Object.entries(record.answers as Record<string, unknown>)) {
    const answer = parseJevAnswer(value);

    if (answer) {
      answers[key] = answer;
    }
  }

  const usage = record.usage as { inputTokens?: unknown; outputTokens?: unknown } | undefined;

  return {
    answers,
    usage: {
      inputTokens: toFiniteNumber(usage?.inputTokens) ?? 0,
      outputTokens: toFiniteNumber(usage?.outputTokens) ?? 0,
    },
  };
}

/** Splits a question bag into request-sized groups, preserving keys. */
export function batchJevQuestions(
  questions: Record<string, JevQuestion>,
  perRequest = JEV_QUESTIONS_PER_REQUEST,
) {
  const entries = Object.entries(questions);
  const batches: Array<Record<string, JevQuestion>> = [];

  for (let start = 0; start < entries.length; start += perRequest) {
    batches.push(Object.fromEntries(entries.slice(start, start + perRequest)));
  }

  return batches;
}

export type AskJevParams = {
  /** Everything the questions need to know. Jev cannot look anything up. */
  state: string;
  questions: Record<string, JevQuestion>;
  signal?: AbortSignal;
  /** Milliseconds of invocation left, when the caller is running under a deadline. */
  remainingBudgetMs?: number;
  apiKey?: string | null;
  questionsPerRequest?: number;
  /** Retries on the free tier's 429/503. Zero in production; the benchmark turns it up. */
  retries?: number;
  /**
   * Pause between batched requests.
   *
   * Zero by default, which is what a paid account wants: the batches are independent and firing
   * them back to back is the whole point. The free tier is burst-limited rather than
   * volume-limited, so a list long enough to need three requests fails on the second — the
   * benchmark sets this rather than scoring a rate limit as a wrong answer.
   */
  batchDelayMs?: number;
};

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

/**
 * Asks Jev every question, in as few requests as the batch ceiling allows, or returns null.
 *
 * Null is the whole contract. There is no error to handle, no retry ladder and no fallback chain
 * here, because the fallback is the caller's existing code — which already works, already has its
 * own retries, and was doing this job yesterday. A partial batch is not a partial answer either:
 * if any request in the batch fails, the whole call returns null, because a caller that receives
 * scores for 200 of 300 facts and silently treats the other 100 as unrated has been handed a
 * worse outcome than no scores at all.
 */
export async function askJev(params: AskJevParams): Promise<JevResponse | null> {
  const apiKey = params.apiKey ?? getJevApiKey();

  if (!apiKey || Object.keys(params.questions).length === 0) {
    return null;
  }

  if (params.remainingBudgetMs !== undefined && params.remainingBudgetMs < JEV_MIN_BUDGET_MS) {
    return null;
  }

  const batches = batchJevQuestions(params.questions, params.questionsPerRequest);
  const startedAt = Date.now();
  const answers: JevAnswers = {};
  const usage: JevUsage = { inputTokens: 0, outputTokens: 0 };
  let requestCount = 0;

  for (const [index, batch] of batches.entries()) {
    if (index > 0 && params.batchDelayMs) {
      await new Promise((resolve) => setTimeout(resolve, params.batchDelayMs));
    }

    /*
     * The budget is what is *left*, not what there was.
     *
     * Each batch derives its timeout from this, so passing the original figure to all six would
     * let a stalling gateway hold a 5-second budget open for thirty — the exact overrun that
     * JEV_MIN_BUDGET_MS exists to prevent, arrived at one batch at a time. Once it is spent the
     * loop stops and the caller falls back, which is cheaper than a step that misses its deadline.
     */
    const remainingBudgetMs =
      params.remainingBudgetMs === undefined
        ? undefined
        : params.remainingBudgetMs - (Date.now() - startedAt);

    if (remainingBudgetMs !== undefined && remainingBudgetMs < JEV_MIN_BUDGET_MS) {
      return null;
    }

    const result = await askJevOnce({ ...params, apiKey, remainingBudgetMs, questions: batch });

    requestCount += result.requestCount;

    if (!result.parsed) {
      return null;
    }

    Object.assign(answers, result.parsed.answers);
    usage.inputTokens += result.parsed.usage.inputTokens;
    usage.outputTokens += result.parsed.usage.outputTokens;
  }

  // Every question must have come back. A silently short answer set is the one failure mode that
  // would corrupt a deck rather than merely fail to improve it.
  if (Object.keys(answers).length !== Object.keys(params.questions).length) {
    console.warn(
      `[jev] short answer set: asked ${Object.keys(params.questions).length}, got ${Object.keys(answers).length}`,
    );

    return null;
  }

  return { answers, usage, durationMs: Date.now() - startedAt, requestCount };
}

async function askJevOnce(
  params: AskJevParams & { apiKey: string },
): Promise<{ parsed: { answers: JevAnswers; usage: JevUsage } | null; requestCount: number }> {
  const retries = params.retries ?? 0;
  let requestCount = 0;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const timeoutSignal = AbortSignal.timeout(
      params.remainingBudgetMs === undefined
        ? JEV_TIMEOUT_MS
        : Math.min(JEV_TIMEOUT_MS, params.remainingBudgetMs),
    );
    const signal = params.signal
      ? AbortSignal.any([timeoutSignal, params.signal])
      : timeoutSignal;

    requestCount += 1;

    try {
      const response = await fetch(JEV_ENDPOINT, {
        signal,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${params.apiKey}`,
        },
        body: JSON.stringify({
          model: JEV_MODEL,
          state: params.state,
          questions: params.questions,
        }),
      });

      if (!response.ok) {
        if (RETRYABLE_STATUS.has(response.status) && attempt < retries) {
          await new Promise((resolve) => setTimeout(resolve, 1_500 * (attempt + 1)));
          continue;
        }

        // Warn, never error: a decision that did not happen is a slower note, not a broken one,
        // and logging it at error level would page somebody over a degraded accelerator.
        console.warn(`[jev] refused: HTTP ${response.status}`);

        return { parsed: null, requestCount };
      }

      const parsed = parseJevAnswers((await response.json()) as unknown);

      if (!parsed) {
        console.warn("[jev] unreadable response body");

        return { parsed: null, requestCount };
      }

      return { parsed, requestCount };
    } catch (error) {
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, 1_500 * (attempt + 1)));
        continue;
      }

      console.warn("[jev] unavailable", error);

      return { parsed: null, requestCount };
    }
  }

  return { parsed: null, requestCount };
}

export function jevCostUsd(usage: JevUsage) {
  return (usage.inputTokens * JEV_INPUT_USD_PER_MTOK) / 1_000_000;
}
