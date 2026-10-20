// Imported by its real filename so the Node test runner can load this module directly.
import { isAiProviderSpendCapError } from "./ai/errors.ts";

/**
 * When the Gemini voice is refused, and whether Soniox should speak instead.
 *
 * Every voice in the app has been Gemini since 2026-10-14 (docs/voice-tutor.md), and on 2026-10-20
 * Google's spend cap refused all of them for 35 minutes: tutors went silent mid-sentence and
 * read-aloud and podcasts stopped. Soniox spoke every one of those voices until a week before and
 * still holds the keys, so a refusal that will not clear by itself is now spoken by Soniox rather
 * than lost.
 *
 * Pure and clock-injected so it can be tested without either provider.
 */

/** What a failed Gemini speech request was, as far as the fallback is concerned. */
export type GeminiSpeechFailure =
  /** The project's monthly spend cap. Nothing Gemini says will change until it is raised. */
  | "billing"
  /** Google's side broke (5xx) or the request never reached it. */
  | "server"
  /** An ordinary 429: busy, and the callers already back off on it. Stays Gemini's. */
  | "busy"
  /** Gemini answered without a sample for this text. Soniox is not asked to cover a single line. */
  | "no_audio"
  /** Our deadline ran out. Starting a second voice now would only overrun the caller's budget. */
  | "timeout"
  /** Anything else, a 400 included: a request Soniox would not make right either. */
  | "other";

function readStatus(error: unknown) {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }

  const record = error as { status?: unknown; statusCode?: unknown };
  // `status: null` is GeminiSpeechError's "no audio", so it must not fall through to `statusCode`.
  const status = "status" in record ? record.status : record.statusCode;

  return typeof status === "number" || status === null ? status : undefined;
}

function readName(error: unknown) {
  if (typeof error !== "object" || error === null) {
    return "";
  }

  const name = (error as { name?: unknown }).name;

  return typeof name === "string" ? name : "";
}

export function classifyGeminiSpeechFailure(error: unknown): GeminiSpeechFailure {
  // Before the status: the cap answers 429, which on its own reads as busy.
  if (isAiProviderSpendCapError(error)) {
    return "billing";
  }

  const name = readName(error);

  if (name === "TimeoutError" || name === "AbortError") {
    return "timeout";
  }

  const status = readStatus(error);

  if (status === 429) {
    return "busy";
  }

  if (status === null) {
    return "no_audio";
  }

  if (typeof status === "number") {
    return status >= 500 ? "server" : "other";
  }

  // No status at all: fetch itself failed ("fetch failed", a reset socket) before Google answered.
  return name === "TypeError" ? "server" : "other";
}

/** Whether this request should be spoken by Soniox instead of failing. */
export function shouldSpeakWithSoniox(failure: GeminiSpeechFailure) {
  return failure === "billing" || failure === "server";
}

/** How long one spend-cap refusal sends every voice on this instance to Soniox. */
export const BILLING_FALLBACK_MS = 15 * 60 * 1000;
/** Server failures this close together mean Gemini is down rather than unlucky. */
export const SERVER_FAILURE_WINDOW_MS = 2 * 60 * 1000;
export const SERVER_FAILURES_TO_FALL_BACK = 3;
/** How long a run of server failures sends every voice on this instance to Soniox. */
export const SERVER_FALLBACK_MS = 5 * 60 * 1000;

/**
 * Remembers, per server instance, that Gemini is refusing, so the requests after the first one go
 * straight to Soniox instead of each paying for a refusal first — and so a tutor session that
 * starts now is handed Soniox from the start.
 *
 * Per instance on purpose: it costs nothing to share, and an instance that has not heard yet finds
 * out from its own first refusal, which still falls back. The breaker only ever closes on time:
 * after it, the next request asks Gemini again, and either is answered or re-opens it.
 */
export class GeminiSpeechHealth {
  private fallbackUntil = 0;
  private serverFailures: number[] = [];
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  /** True while voices on this instance should be spoken by Soniox without asking Gemini first. */
  isFallingBack() {
    return this.now() < this.fallbackUntil;
  }

  record(failure: GeminiSpeechFailure) {
    const now = this.now();

    if (failure === "billing") {
      this.fallbackUntil = Math.max(this.fallbackUntil, now + BILLING_FALLBACK_MS);
      return;
    }

    if (failure !== "server") {
      return;
    }

    this.serverFailures = [...this.serverFailures.filter((at) => now - at < SERVER_FAILURE_WINDOW_MS), now];

    if (this.serverFailures.length >= SERVER_FAILURES_TO_FALL_BACK) {
      this.fallbackUntil = Math.max(this.fallbackUntil, now + SERVER_FALLBACK_MS);
      this.serverFailures = [];
    }
  }

  /** Gemini spoke: a run of server failures is over. A billing fallback still runs its course. */
  recordSuccess() {
    this.serverFailures = [];
  }
}
