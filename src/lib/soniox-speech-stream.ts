import "server-only";

import { SonioxNodeClient, type RealtimeError } from "@soniox/node";

import { requireSonioxEnv } from "@/lib/server-env";

/**
 * The tutor's speech in Soniox's voice, made on our server and streamed as bare PCM: the shape
 * `/api/tutor/speech` already sends for Gemini (signed 16-bit little-endian, mono), at whatever
 * sample rate the route asks for — Soniox makes 8, 16, 24, 44.1 and 48 kHz only.
 *
 * This is the route's fallback for a Gemini refusal that will not clear by itself (its spend cap,
 * or Google's side failing), so the browser keeps the player it already has and hears the sentence
 * in Soniox's voice instead of silence. One stream per piece, like a read-aloud chunk: the pieces
 * are a few sentences, far under Soniox's 180-second ceiling per request, and each holds one of
 * the organization's concurrent TTS streams (25) only while it speaks.
 */

let client: SonioxNodeClient | undefined;

/**
 * How long a stream may go without a byte before it is given up. Soniox's first audio arrives in
 * under a second; a stream silent this long is stuck, and it holds one of the organization's
 * concurrent streams for as long as it is left open.
 */
const SONIOX_SPEECH_IDLE_TIMEOUT_MS = 15_000;

function getClient() {
  client ??= new SonioxNodeClient({ api_key: requireSonioxEnv().SONIOX_API_KEY });

  return client;
}

export class SonioxSpeechError extends Error {
  /** Soniox's status: 429 when the organization's concurrent streams are all taken. */
  readonly statusCode: number | null;

  constructor(message: string, statusCode: number | null) {
    super(message);
    this.name = "SonioxSpeechError";
    this.statusCode = statusCode;
  }
}

/**
 * Opens the stream and waits for its first audio, so a refusal can still become an HTTP status of
 * the route's rather than a broken body. Resolves to the audio still to come, first chunk included;
 * rejects with a `SonioxSpeechError` when nothing could be said.
 */
export async function startSonioxSpeech(params: {
  text: string;
  voice: string;
  language: string;
  sampleRate: number;
  signal?: AbortSignal;
}): Promise<AsyncGenerator<Uint8Array, void, undefined>> {
  const stream = await getClient()
    .realtime.tts({
      model: requireSonioxEnv().SONIOX_TTS_MODEL,
      voice: params.voice,
      language: params.language,
      audio_format: "pcm_s16le",
      sample_rate: params.sampleRate,
    })
    .catch((error: unknown) => {
      // A refusal at connect time (the concurrent-stream cap among them) keeps its status, so the
      // route can still answer "busy" rather than "broken".
      const statusCode = (error as { statusCode?: unknown } | null)?.statusCode;

      throw new SonioxSpeechError(
        `Soniox speech could not start: ${error instanceof Error ? error.message : String(error)}`,
        typeof statusCode === "number" ? statusCode : null,
      );
    });
  const queue: Uint8Array[] = [];
  let finished = false;
  let failure: SonioxSpeechError | null = null;
  let wake: (() => void) | null = null;
  const notify = () => {
    wake?.();
    wake = null;
  };
  const close = () => {
    finished = true;
    notify();
  };

  stream.on("audio", (chunk: Uint8Array) => {
    queue.push(chunk);
    notify();
  });
  stream.on("error", (error: RealtimeError) => {
    failure = new SonioxSpeechError(`Soniox speech failed: ${error.message}`, error.statusCode ?? null);
    close();
  });
  stream.on("terminated", close);
  const abort = () => {
    stream.close();
    close();
  };
  params.signal?.addEventListener("abort", abort, { once: true });
  stream.sendText(params.text, { end: true });

  const next = async () => {
    while (queue.length === 0 && !finished) {
      const idle = setTimeout(() => {
        failure = new SonioxSpeechError(
          `Soniox speech sent nothing for ${SONIOX_SPEECH_IDLE_TIMEOUT_MS}ms.`,
          null,
        );
        stream.close();
        close();
      }, SONIOX_SPEECH_IDLE_TIMEOUT_MS);

      await new Promise<void>((resolve) => {
        wake = resolve;
      });
      clearTimeout(idle);
    }

    return queue.shift() ?? null;
  };
  const release = () => {
    params.signal?.removeEventListener("abort", abort);
    stream.close();
  };

  const first = await next();

  if (!first) {
    release();
    throw failure ?? new SonioxSpeechError("Soniox returned no audio.", null);
  }

  return (async function* () {
    // Whole samples only: an odd byte is carried into the next chunk, as the Gemini reader does,
    // because the browser turns every chunk into its own AudioBuffer and half a sample is noise.
    let carry: Uint8Array = new Uint8Array(0);
    let chunk: Uint8Array | null = first;

    try {
      while (chunk) {
        const joined = new Uint8Array(carry.length + chunk.length);
        joined.set(carry);
        joined.set(chunk, carry.length);
        const whole = joined.length - (joined.length % 2);

        carry = joined.subarray(whole);

        if (whole > 0) {
          yield joined.subarray(0, whole);
        }

        chunk = await next();
      }

      if (failure) {
        throw failure;
      }
    } finally {
      release();
    }
  })();
}
