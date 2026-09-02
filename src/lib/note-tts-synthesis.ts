import type { RealtimeError, SonioxNodeClient, TtsTimestamps } from "@soniox/node";

import {
  buildTtsPiecesFromCharacterTimestamps,
  getCharacterTimestampsEndMs,
  type TtsAlignmentPiece,
  type TtsCharacterTimestamps,
} from "./note-tts-alignment.ts";

// Soniox stops every request at this much audio and truncates the rest — the REST endpoint does
// it silently with a 200, the WebSocket says so with a 413. A chunk is sized well under it in
// note-tts-text.ts; this is the last line of defence, not the plan.
export const SONIOX_TTS_MAX_AUDIO_MS = 180_000;

export class TtsAudioTruncatedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TtsAudioTruncatedError";
  }
}

export type TtsSynthesisResult = {
  audio: Uint8Array;
  pieces: TtsAlignmentPiece[];
  durationMs: number;
};

function concatAudio(chunks: Uint8Array[]) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const audio = new Uint8Array(total);
  let offset = 0;

  for (const chunk of chunks) {
    audio.set(chunk, offset);
    offset += chunk.length;
  }

  return audio;
}

// Synthesizes one chunk over the TTS WebSocket with character timestamps, so the word highlight
// is aligned to what the model actually said rather than to a second transcription of the audio.
// Resolves once the server terminates the stream; rejects with the server's error (a 429 for the
// organization's concurrent-stream cap, a 413 once the audio hit the per-request maximum).
export async function synthesizeTtsChunkWithTimestamps(params: {
  client: SonioxNodeClient;
  text: string;
  model: string;
  voice: string;
  language: string;
  audioFormat: "mp3";
  bitrate: number;
  timeoutMs: number;
}): Promise<TtsSynthesisResult> {
  const stream = await params.client.realtime.tts({
    model: params.model,
    voice: params.voice,
    language: params.language,
    audio_format: params.audioFormat,
    bitrate: params.bitrate,
    return_timestamps: true,
  });
  const audioChunks: Uint8Array[] = [];
  const frames: TtsCharacterTimestamps[] = [];

  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        finish(new Error(`Soniox TTS stream did not finish within ${params.timeoutMs}ms.`));
      }, params.timeoutMs);
      const finish = (error?: unknown) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timer);

        if (error) {
          reject(error);
        } else {
          resolve();
        }
      };

      stream.on("audio", (chunk: Uint8Array, timestamps?: TtsTimestamps) => {
        audioChunks.push(chunk);

        if (timestamps) {
          frames.push(timestamps);
        }
      });
      stream.on("error", (error: RealtimeError) => {
        if (error.statusCode === 413) {
          finish(
            new TtsAudioTruncatedError(
              `Soniox truncated the audio at the per-request maximum (${SONIOX_TTS_MAX_AUDIO_MS}ms): ${error.message}`,
            ),
          );
          return;
        }

        finish(error);
      });
      stream.on("terminated", () => finish());
      stream.sendText(params.text, { end: true });
    });
  } finally {
    stream.close();
  }

  const audio = concatAudio(audioChunks);

  if (audio.length === 0) {
    throw new Error("Soniox TTS stream ended without audio.");
  }

  const timestampsEndMs = getCharacterTimestampsEndMs(frames);
  // MP3 at a fixed bitrate: bytes tell the length directly, which is the duration the reader is
  // charged for even when timestamps end a beat before the trailing silence.
  const encodedMs = Math.round((audio.length * 8 * 1000) / params.bitrate);

  return {
    audio,
    pieces: buildTtsPiecesFromCharacterTimestamps(frames),
    durationMs: Math.max(timestampsEndMs, encodedMs),
  };
}
