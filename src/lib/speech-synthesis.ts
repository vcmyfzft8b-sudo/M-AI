import "server-only";

import { isAiProviderSpendCapError, toProviderBillingError } from "@/lib/ai/errors";
import { logGeminiUsageEvent } from "@/lib/ai/usage-logging";
import { captureBackgroundError } from "@/lib/monitoring";
import { GEMINI_TTS_SAMPLE_RATE, GeminiSpeechError, startGeminiSpeech } from "@/lib/gemini-tts";
import type { NoteTtsVoice } from "@/lib/note-tts-settings";
import { encodeMp3 } from "@/lib/mp3-encode";
import { getServerEnv } from "@/lib/server-env";
import {
  GeminiSpeechHealth,
  classifyGeminiSpeechFailure,
  shouldSpeakWithSoniox,
} from "@/lib/speech-provider-health";
import { geminiVoiceFor } from "@/lib/tutor/gemini-voices";

export type SpeechProvider = "gemini" | "soniox";

/** This instance's memory of Gemini refusing to speak. See src/lib/speech-provider-health.ts. */
const geminiSpeechHealth = new GeminiSpeechHealth();

/**
 * The engine the deployment is set to: Gemini since 2026-10-14, chosen over Soniox tts-rt-v2 by a
 * blind listening test on Slovenian and Croatian (docs/voice-tutor.md). `TTS_PROVIDER=soniox` puts
 * the old voice back everywhere at once, and so does a deployment without a Gemini key.
 * Transcription stays on Soniox either way.
 */
function configuredSpeechProvider(): SpeechProvider {
  const env = getServerEnv();

  return env.TTS_PROVIDER === "gemini" && env.GEMINI_API_KEY ? "gemini" : "soniox";
}

/**
 * Which engine speaks now, for every voice in the app: the tutor, read-aloud and the podcast.
 *
 * The configured one, except while Gemini is refusing (its spend cap, or a run of server errors):
 * then Soniox, which spoke every one of these voices until the switch and still can.
 */
export function speechProvider(): SpeechProvider {
  const configured = configuredSpeechProvider();

  return configured === "gemini" && geminiSpeechHealth.isFallingBack() ? "soniox" : configured;
}

/**
 * The model a provider's audio is made with. It is part of every read-aloud and podcast cache key,
 * so switching engines retires the old audio on its own: the first play after a switch makes the
 * new voice, and the old rows are left where they are. The same holds for a fallback: audio Soniox
 * made while Gemini was refusing is stored under Soniox's model, and is remade in Gemini's voice
 * the first time it is played after Gemini is back.
 */
export function speechModelFor(provider: SpeechProvider) {
  const env = getServerEnv();

  return provider === "gemini" ? env.GEMINI_TTS_MODEL : env.SONIOX_TTS_MODEL;
}

export function speechModel() {
  return speechModelFor(speechProvider());
}

/**
 * Records how a Gemini speech request ended, and says whether this request should now be spoken
 * by Soniox instead: yes for the spend cap and for a fault on Google's side or on the way there; no
 * for an ordinary 429 (busy, which the callers back off on), a line Gemini had no audio for, our
 * own deadline, or a request Soniox would refuse just the same.
 *
 * The spend cap is reported once per instance per fallback window, not per sentence: nothing fails
 * any more when it hits a voice, so this is how anyone learns that it did.
 */
export function noteGeminiSpeechResult(error: unknown | null) {
  if (error === null) {
    geminiSpeechHealth.recordSuccess();
    return false;
  }

  const failure = classifyGeminiSpeechFailure(error);
  const alreadyFallingBack = geminiSpeechHealth.isFallingBack();

  geminiSpeechHealth.record(failure);

  if (failure === "billing" && !alreadyFallingBack) {
    captureBackgroundError(toProviderBillingError(error), {
      operation: "gemini_speech",
      tags: { fallback: "soniox" },
    });
  }

  // Configured, not current: TTS_PROVIDER=soniox never asked Gemini in the first place.
  return configuredSpeechProvider() === "gemini" && shouldSpeakWithSoniox(failure);
}

/**
 * Gemini could not speak this and Soniox should: thrown by `synthesizeGeminiMp3` so read-aloud and
 * the podcast can make the same audio in Soniox's voice, under Soniox's model in their cache key.
 */
export class GeminiSpeechUnavailableError extends Error {
  constructor(cause: unknown) {
    super(`Gemini could not speak; Soniox speaks instead: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "GeminiSpeechUnavailableError";
    this.cause = cause;
  }
}

/**
 * One piece of text spoken by Gemini in one of the app's voices, as MP3, with its exact length.
 *
 * The length comes from the samples, not from a transcription or the byte count, so it is what the
 * listener is charged and what the player seeks against. A stream that ends without a sample is
 * asked for once more — Gemini occasionally returns nothing for a short line — and then reported.
 *
 * Every call is logged to `ai_usage_events` under `usage.stage`, which is what the daily cost alert
 * and /admin/costs read: Soniox was never in that table, so without this the new voice's spend on
 * read-aloud and the podcast would be invisible there.
 */
export async function synthesizeGeminiMp3(params: {
  text: string;
  voice: NoteTtsVoice;
  language: string;
  bitrate: number;
  timeoutMs: number;
  usage: { stage: "read_aloud_speech" | "podcast_speech"; userId: string; lectureId: string };
}) {
  const env = getServerEnv();
  const log = (success: boolean, extra: { usageMetadata?: unknown; error?: unknown }) =>
    logGeminiUsageEvent({
      model: env.GEMINI_TTS_MODEL,
      stage: params.usage.stage,
      attemptIndex: 0,
      success,
      usageMetadata: (extra.usageMetadata ?? null) as Parameters<typeof logGeminiUsageEvent>[0]["usageMetadata"],
      error: extra.error,
      context: { userId: params.usage.userId, lectureId: params.usage.lectureId },
      metadata: { voice: params.voice, chars: params.text.length },
    });

  if (!env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }

  const deadline = AbortSignal.timeout(params.timeoutMs);
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const audio = await startGeminiSpeech({
        apiKey: env.GEMINI_API_KEY,
        model: env.GEMINI_TTS_MODEL,
        text: params.text,
        voice: geminiVoiceFor(params.voice),
        language: params.language,
        signal: deadline,
      });
      const chunks: Uint8Array[] = [];
      let next = await audio.next();

      while (!next.done) {
        chunks.push(next.value);
        next = await audio.next();
      }

      const pcm = new Uint8Array(Buffer.concat(chunks));

      noteGeminiSpeechResult(null);
      await log(true, { usageMetadata: next.value });

      return {
        audio: encodeMp3(pcm, GEMINI_TTS_SAMPLE_RATE, params.bitrate),
        durationMs: Math.round((pcm.byteLength / 2 / GEMINI_TTS_SAMPLE_RATE) * 1000),
        usage: next.value,
      };
    } catch (error) {
      lastError = error;

      /* Only an empty answer is worth asking again; a refusal or a 429 is the caller's to handle. */
      if (!(error instanceof GeminiSpeechError) || error.status !== null || deadline.aborted) {
        break;
      }
    }
  }

  await log(false, { error: lastError });

  if (noteGeminiSpeechResult(lastError)) {
    throw new GeminiSpeechUnavailableError(lastError);
  }

  /* Before the rate-limit shape below: the cap answers 429 too, and backing off cannot outlast it. */
  if (isAiProviderSpendCapError(lastError)) {
    throw toProviderBillingError(lastError);
  }

  if (lastError instanceof GeminiSpeechError && lastError.status === 429) {
    /* The shape isTtsProviderRateLimitError recognises, so callers back off exactly as for Soniox. */
    throw Object.assign(new Error(`Gemini speech rate limit: ${lastError.message}`), { statusCode: 429 });
  }

  throw lastError;
}
