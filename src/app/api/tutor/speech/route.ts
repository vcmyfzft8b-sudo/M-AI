import { after, NextResponse } from "next/server";
import { z } from "zod";

import { logGeminiUsageEvent } from "@/lib/ai/usage-logging";
import { GeminiSpeechError, GEMINI_TTS_SAMPLE_RATE, startGeminiSpeech } from "@/lib/gemini-tts";
import { noteTtsVoiceSchema } from "@/lib/note-tts-voice-schema";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { getServerEnv } from "@/lib/server-env";
import { SonioxSpeechError, startSonioxSpeech } from "@/lib/soniox-speech-stream";
import { noteGeminiSpeechResult, speechProvider } from "@/lib/speech-synthesis";
import { geminiVoiceFor } from "@/lib/tutor/gemini-voices";
import { tutorSpeechTokenSecret, verifyTutorSpeechToken } from "@/lib/tutor/speech-token";

export const maxDuration = 60;

/**
 * One piece of the tutor's speech: a sentence or a few, in, and its audio streamed out as it is
 * made.
 *
 * This is the only place the tutor's voice touches our servers. With Soniox the browser held a
 * temporary key and opened the speech socket itself; Gemini has no key that can do only that, so
 * the browser comes here with the token the session route minted for its slice of time, and this
 * spends our key on its behalf. The token is checked by hash, not by a database read — it arrives
 * once per sentence, and a lookup would be a pause before every one of them.
 *
 * The body is bare PCM (signed 16-bit little-endian, mono, `X-Speech-Sample-Rate`), which is what
 * the tutor's audio graph has always eaten: it starts playing on the first chunk and can stop on a
 * syllable. Google is waited on for the first chunk before answering, so a refusal is a status the
 * client can act on (429 busy, 422 nothing to say) rather than a 200 with a broken body.
 *
 * When Gemini refuses for a reason that will not clear by itself — the project's spend cap, as on
 * 2026-10-20, or Google's side failing — the same piece is spoken by Soniox here, in the same PCM at
 * the same rate, so the learner hears the old voice instead of a tutor gone silent. While this
 * instance knows Gemini is refusing, it goes to Soniox straight away (src/lib/speech-synthesis.ts).
 */

/** Soniox needs a language where Gemini only takes a hint; the tutor's own default. */
const FALLBACK_SPEECH_LANGUAGE = "sl";

const requestSchema = z.object({
  /* A piece is at most a few sentences; anything longer is not the tutor's client. */
  text: z.string().trim().min(1).max(1_200),
  voice: noteTtsVoiceSchema,
  language: z.string().trim().min(2).max(12).nullable().optional(),
});

/**
 * A no-op the player calls as the session opens, so the function is warm before the first
 * sentence needs it rather than paying its cold start inside the tutor's first pause.
 */
export function GET() {
  return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}

function bearer(request: Request) {
  const header = request.headers.get("authorization") ?? "";

  return header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : null;
}

export async function POST(request: Request) {
  const env = getServerEnv();
  const claims = verifyTutorSpeechToken(
    bearer(request),
    tutorSpeechTokenSecret(env.SUPABASE_SERVICE_ROLE_KEY),
  );

  if (!claims) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const limited = await enforceRateLimit({
    request,
    route: "api:tutor:speech",
    rules: rateLimitPresets.tutorSpeech,
    userId: claims.userId,
  });

  if (limited) {
    return limited;
  }

  const body = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const { text, voice, language } = parsed.data;
  const model = env.GEMINI_TTS_MODEL;
  const upstream = new AbortController();
  const abortUpstream = () => upstream.abort();

  request.signal.addEventListener("abort", abortUpstream, { once: true });

  let audio: AsyncGenerator<Uint8Array, unknown, undefined>;
  let first: IteratorResult<Uint8Array, unknown>;
  /* Soniox when TTS_PROVIDER says so, when there is no Gemini key, or while Gemini is refusing. */
  let spokenBy = speechProvider();
  const logGeminiFailure = (error: unknown) =>
    after(() =>
      logGeminiUsageEvent({
        model,
        stage: "tutor_speech",
        attemptIndex: 0,
        success: false,
        error,
        context: { userId: claims.userId, lectureId: claims.lectureId },
        metadata: { voice, chars: text.length },
      }),
    );

  try {
    let started: { audio: typeof audio; first: typeof first } | null = null;

    if (spokenBy === "gemini" && env.GEMINI_API_KEY) {
      try {
        const geminiAudio = await startGeminiSpeech({
          apiKey: env.GEMINI_API_KEY,
          model,
          text,
          voice: geminiVoiceFor(voice),
          language: language ?? null,
          signal: upstream.signal,
        });

        started = { audio: geminiAudio, first: await geminiAudio.next() };
        noteGeminiSpeechResult(null);
      } catch (error) {
        if (request.signal.aborted || !noteGeminiSpeechResult(error)) {
          throw error;
        }

        console.warn("[tutor] Gemini could not speak; Soniox speaks this piece", {
          status: error instanceof GeminiSpeechError ? error.status : null,
          voice,
          chars: text.length,
        });
        logGeminiFailure(error);
        spokenBy = "soniox";
      }
    }

    if (!started) {
      const sonioxAudio = await startSonioxSpeech({
        text,
        voice,
        language: language ?? FALLBACK_SPEECH_LANGUAGE,
        sampleRate: GEMINI_TTS_SAMPLE_RATE,
        signal: upstream.signal,
      });

      started = { audio: sonioxAudio, first: await sonioxAudio.next() };
    }

    audio = started.audio;
    first = started.first;
  } catch (error) {
    request.signal.removeEventListener("abort", abortUpstream);

    if (request.signal.aborted) {
      return new NextResponse(null, { status: 499 });
    }

    const status =
      error instanceof GeminiSpeechError
        ? error.status
        : error instanceof SonioxSpeechError
          ? (error.statusCode ?? 502)
          : 502;

    console.error("[tutor] speech failed", { status, spokenBy, model, voice, chars: text.length, error });

    if (spokenBy === "gemini") {
      logGeminiFailure(error);
    }

    return NextResponse.json(
      { error: status === null ? "no_audio" : "speech_failed" },
      /*
       * Busy is busy and says so; a stream that ended without a sample is something this sentence
       * could not be said as, and the client moves past it rather than ending the lesson. Anything
       * else is a fault on the way to Google or Soniox.
       */
      { status: status === 429 ? 429 : status === null ? 422 : 502 },
    );
  }

  /* Cancelled means the learner cut the tutor off mid-sentence: expected, and not a failure. */
  let cancelled = false;
  let finishUsage: (usage: unknown) => void = () => {};
  const finished = new Promise<unknown>((resolve) => {
    finishUsage = resolve;
  });

  after(async () => {
    const usage = await finished;

    /* Soniox's spend is read from Soniox; ai_usage_events holds what Google bills. */
    if (spokenBy !== "gemini") {
      return;
    }

    await logGeminiUsageEvent({
      model,
      stage: "tutor_speech",
      attemptIndex: 0,
      success: usage !== undefined,
      usageMetadata: (usage ?? null) as Parameters<typeof logGeminiUsageEvent>[0]["usageMetadata"],
      context: { userId: claims.userId, lectureId: claims.lectureId },
      metadata: { voice, chars: text.length, ...(cancelled ? { cancelled: true } : {}) },
    });
  });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        if (!first.done) {
          controller.enqueue(first.value);
        }

        let next = first;

        while (!next.done) {
          next = await audio.next();

          if (!next.done) {
            controller.enqueue(next.value);
          }
        }

        finishUsage(next.value ?? null);
        controller.close();
      } catch (error) {
        finishUsage(undefined);

        if (!request.signal.aborted) {
          console.error("[tutor] speech stream broke", { spokenBy, model, voice, error });
        }

        controller.error(error);
      } finally {
        request.signal.removeEventListener("abort", abortUpstream);
      }
    },
    cancel() {
      cancelled = true;
      upstream.abort();
      finishUsage(undefined);
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Cache-Control": "no-store",
      "X-Speech-Sample-Rate": String(GEMINI_TTS_SAMPLE_RATE),
    },
  });
}
