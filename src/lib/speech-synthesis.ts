import "server-only";

import { logGeminiUsageEvent } from "@/lib/ai/usage-logging";
import { GEMINI_TTS_SAMPLE_RATE, GeminiSpeechError, startGeminiSpeech } from "@/lib/gemini-tts";
import type { NoteTtsVoice } from "@/lib/note-tts-settings";
import { encodeMp3 } from "@/lib/mp3-encode";
import { getServerEnv } from "@/lib/server-env";
import { geminiVoiceFor } from "@/lib/tutor/gemini-voices";

/**
 * Which engine speaks, for every voice in the app: the tutor, read-aloud and the podcast.
 *
 * Gemini since 2026-10-14, chosen over Soniox tts-rt-v2 by a blind listening test on Slovenian and
 * Croatian (docs/voice-tutor.md). `TTS_PROVIDER=soniox` puts the old voice back everywhere at once,
 * and so does a deployment without a Gemini key. Transcription stays on Soniox either way.
 */
export function speechProvider(): "gemini" | "soniox" {
  const env = getServerEnv();

  return env.TTS_PROVIDER === "gemini" && env.GEMINI_API_KEY ? "gemini" : "soniox";
}

/**
 * The model the stored audio was made with. It is part of every read-aloud and podcast cache key,
 * so switching engines retires the old audio on its own: the first play after a switch makes the
 * new voice, and the old rows are left where they are.
 */
export function speechModel() {
  const env = getServerEnv();

  return speechProvider() === "gemini" ? env.GEMINI_TTS_MODEL : env.SONIOX_TTS_MODEL;
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

  if (lastError instanceof GeminiSpeechError && lastError.status === 429) {
    /* The shape isTtsProviderRateLimitError recognises, so callers back off exactly as for Soniox. */
    throw Object.assign(new Error(`Gemini speech rate limit: ${lastError.message}`), { statusCode: 429 });
  }

  throw lastError;
}
