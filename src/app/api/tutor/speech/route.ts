import { after, NextResponse } from "next/server";
import { z } from "zod";

import { logGeminiUsageEvent } from "@/lib/ai/usage-logging";
import { GeminiSpeechError, GEMINI_TTS_SAMPLE_RATE, startGeminiSpeech } from "@/lib/gemini-tts";
import { noteTtsVoiceSchema } from "@/lib/note-tts-voice-schema";
import { getServerEnv } from "@/lib/server-env";
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
 */

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

  if (!env.GEMINI_API_KEY) {
    return NextResponse.json({ error: "speech_unavailable" }, { status: 503 });
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

  let audio: Awaited<ReturnType<typeof startGeminiSpeech>>;
  let first: IteratorResult<Uint8Array, unknown>;

  try {
    audio = await startGeminiSpeech({
      apiKey: env.GEMINI_API_KEY,
      model,
      text,
      voice: geminiVoiceFor(voice),
      language: language ?? null,
      signal: upstream.signal,
    });
    first = await audio.next();
  } catch (error) {
    request.signal.removeEventListener("abort", abortUpstream);

    if (request.signal.aborted) {
      return new NextResponse(null, { status: 499 });
    }

    const status = error instanceof GeminiSpeechError ? error.status : null;

    console.error("[tutor] speech failed", { status, model, voice, chars: text.length, error });

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

    return NextResponse.json(
      { error: status === null ? "no_audio" : "speech_failed" },
      /*
       * Busy is busy and says so; a stream that ended without a sample is something this sentence
       * could not be said as, and the client moves past it rather than ending the lesson. Anything
       * else is a fault on the way to Google.
       */
      { status: status === 429 ? 429 : status === null ? 422 : 502 },
    );
  }

  let finishUsage: (usage: unknown) => void = () => {};
  const finished = new Promise<unknown>((resolve) => {
    finishUsage = resolve;
  });

  after(async () => {
    const usage = await finished;

    await logGeminiUsageEvent({
      model,
      stage: "tutor_speech",
      attemptIndex: 0,
      success: usage !== undefined,
      usageMetadata: (usage ?? null) as Parameters<typeof logGeminiUsageEvent>[0]["usageMetadata"],
      context: { userId: claims.userId, lectureId: claims.lectureId },
      metadata: { voice, chars: text.length },
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
          console.error("[tutor] speech stream broke", { model, voice, error });
        }

        controller.error(error);
      } finally {
        request.signal.removeEventListener("abort", abortUpstream);
      }
    },
    cancel() {
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
