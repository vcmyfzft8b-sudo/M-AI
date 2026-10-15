import "server-only";

/**
 * Speech from Gemini's TTS model, streamed as it is made.
 *
 * Plain REST rather than the SDK: the route this serves passes the audio straight through to the
 * browser, and the SSE stream is the shortest way from Google's first sample to ours. Every chunk
 * is raw signed 16-bit little-endian PCM, mono, 24 kHz — measured, the streamed parts are
 * `audio/l16; rate=24000` while a non-streamed answer with a language set comes back as a WAV
 * file — so both shapes are reduced to bare samples here.
 *
 * Two findings from the evaluation that chose this model (2026-10-14) decide what is sent:
 *
 * - **Only the text.** A style line in front of it ("read this like a warm tutor") was read out
 *   loud in 5 of 12 clips, sometimes in an American accent, and slowed the voice by a quarter.
 *   Plain text was word-perfect in every take and paced like Soniox. The model also refuses a
 *   system instruction outright.
 * - **The tutor's audio tags are performed.** `[laughs]`, `[sighs]`, `[clears throat]` and
 *   `[whispers]` come out as sounds, never as words, exactly as they did on Soniox.
 */

export const GEMINI_TTS_SAMPLE_RATE = 24_000;

export type GeminiSpeechUsage = {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
};

export class GeminiSpeechError extends Error {
  constructor(
    message: string,
    /** Google's HTTP status, or null for a stream that ended without audio. */
    readonly status: number | null,
  ) {
    super(message);
    this.name = "GeminiSpeechError";
  }
}

/** The samples inside a WAV file, or the bytes unchanged when they are already bare PCM. */
function pcmOf(bytes: Buffer) {
  if (bytes.length < 12 || bytes.toString("ascii", 0, 4) !== "RIFF") {
    return bytes;
  }

  let offset = 12;

  while (offset + 8 <= bytes.length) {
    const id = bytes.toString("ascii", offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);

    if (id === "data") {
      return bytes.subarray(offset + 8, Math.min(bytes.length, offset + 8 + size));
    }

    offset += 8 + size + (size % 2);
  }

  return Buffer.alloc(0);
}

async function openStream(params: {
  apiKey: string;
  model: string;
  text: string;
  voice: string;
  languageCode: string | null;
  signal?: AbortSignal;
}) {
  return fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(params.model)}:streamGenerateContent?alt=sse`,
    {
      method: "POST",
      signal: params.signal,
      headers: { "Content-Type": "application/json", "x-goog-api-key": params.apiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: params.text }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            ...(params.languageCode ? { languageCode: params.languageCode } : {}),
            voiceConfig: { prebuiltVoiceConfig: { voiceName: params.voice } },
          },
        },
      }),
    },
  );
}

/**
 * Opens the stream and waits for Google to accept it, so a refusal can still become an HTTP status
 * of ours rather than a broken body halfway through a response.
 *
 * The language is a hint, not a requirement: Gemini detects the language from the text by itself,
 * and naming it only steadies short sentences. A code it does not know is answered with a 400, so
 * that one case is retried without it rather than costing the learner the sentence.
 */
export async function startGeminiSpeech(params: {
  apiKey: string;
  model: string;
  text: string;
  voice: string;
  language: string | null;
  signal?: AbortSignal;
}) {
  let response = await openStream({ ...params, languageCode: params.language });

  if (response.status === 400 && params.language) {
    const detail = await response.text().catch(() => "");

    /* Only a refusal of the language itself is worth the second request. */
    if (!/language/i.test(detail)) {
      throw new GeminiSpeechError(`Gemini speech refused (400): ${detail.slice(0, 300)}`, 400);
    }

    response = await openStream({ ...params, languageCode: null });
  }

  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => "");

    throw new GeminiSpeechError(
      `Gemini speech refused (${response.status}): ${detail.slice(0, 300)}`,
      response.status,
    );
  }

  return readSpeech(response.body);
}

/**
 * The audio of an accepted stream, chunk by chunk, with the usage it reported at the end.
 *
 * Chunks always hold whole samples: an odd byte left at the end of one is carried into the next,
 * because the browser turns every chunk into its own AudioBuffer and half a sample is noise.
 */
async function* readSpeech(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<Uint8Array, GeminiSpeechUsage | null, undefined> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let carry: Buffer = Buffer.alloc(0);
  let usage: GeminiSpeechUsage | null = null;
  let audioBytes = 0;
  let blocked: string | null = null;

  const handleEvent = function* (data: string): Generator<Uint8Array> {
    let event: {
      candidates?: Array<{
        finishReason?: string;
        content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> };
      }>;
      promptFeedback?: { blockReason?: string };
      usageMetadata?: GeminiSpeechUsage;
    };

    try {
      event = JSON.parse(data);
    } catch {
      return;
    }

    if (event.usageMetadata) {
      usage = event.usageMetadata;
    }

    if (event.promptFeedback?.blockReason) {
      blocked = event.promptFeedback.blockReason;
    }

    for (const candidate of event.candidates ?? []) {
      for (const part of candidate.content?.parts ?? []) {
        const encoded = part.inlineData?.data;

        if (!encoded) {
          continue;
        }

        const samples = Buffer.concat([carry, pcmOf(Buffer.from(encoded, "base64"))]);
        const whole = samples.length - (samples.length % 2);

        carry = samples.subarray(whole);

        if (whole > 0) {
          audioBytes += whole;
          yield new Uint8Array(samples.subarray(0, whole));
        }
      }

      if (candidate.finishReason && candidate.finishReason !== "STOP" && audioBytes === 0) {
        blocked = candidate.finishReason;
      }
    }
  };

  try {
    while (true) {
      const { value, done } = await reader.read();

      if (value) {
        text += decoder.decode(value, { stream: true });
      }

      if (done) {
        text += decoder.decode();
      }

      let boundary = text.search(/\r?\n\r?\n/);

      while (boundary !== -1) {
        const block = text.slice(0, boundary);
        text = text.slice(boundary).replace(/^\r?\n\r?\n/, "");

        const data = block
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");

        if (data) {
          yield* handleEvent(data);
        }

        boundary = text.search(/\r?\n\r?\n/);
      }

      if (done) {
        break;
      }
    }

    if (text.trim().startsWith("data:")) {
      yield* handleEvent(text.trim().slice(5).trimStart());
    }
  } finally {
    reader.releaseLock();
  }

  if (audioBytes === 0) {
    throw new GeminiSpeechError(`Gemini returned no audio${blocked ? ` (${blocked})` : ""}.`, null);
  }

  return usage;
}
