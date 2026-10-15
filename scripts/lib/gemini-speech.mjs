/*
 * The app's voice, for the scripts that pre-render clips: Gemini TTS, encoded to MP3 with ffmpeg.
 *
 * The same request the app's speech routes make (src/lib/gemini-tts.ts): the text alone — a style
 * line in front of it gets read out loud — with the language as a hint, in the Gemini voice the
 * app's voice name maps to. Gemini answers in raw 24 kHz PCM, so ffmpeg has to be on the PATH.
 */

import { spawnSync } from "node:child_process";

import { GEMINI_TUTOR_VOICES } from "../../src/lib/tutor/gemini-voices.ts";

export const GEMINI_SAMPLE_RATE = 24_000;

/** Bare samples from a Gemini answer, which is a WAV file when a language is named. */
function samplesOf(part) {
  const bytes = Buffer.from(part.inlineData.data, "base64");

  if (bytes.toString("ascii", 0, 4) !== "RIFF") {
    return bytes;
  }

  const data = bytes.indexOf("data", 12, "ascii");

  return data < 0 ? Buffer.alloc(0) : bytes.subarray(data + 8, data + 8 + bytes.readUInt32LE(data + 4));
}

export async function geminiPcm({ text, voice, language, timeoutMs = 120_000 }) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set — put it in .env.local.");
  }

  const model = process.env.GEMINI_TTS_MODEL || "gemini-3.8-flash-tts";
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            languageCode: language,
            voiceConfig: { prebuiltVoiceConfig: { voiceName: GEMINI_TUTOR_VOICES[voice] ?? voice } },
          },
        },
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Gemini ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }

  const payload = await response.json();
  const pcm = Buffer.concat(
    (payload.candidates?.[0]?.content?.parts ?? []).filter((part) => part.inlineData?.data).map(samplesOf),
  );

  if (pcm.length === 0) {
    throw new Error("no audio returned");
  }

  return pcm;
}

export function pcmToMp3(pcm, bitrate) {
  const encoded = spawnSync(
    "ffmpeg",
    ["-loglevel", "error", "-f", "s16le", "-ar", String(GEMINI_SAMPLE_RATE), "-ac", "1", "-i", "pipe:0",
      "-codec:a", "libmp3lame", "-b:a", `${Math.round(bitrate / 1000)}k`, "-f", "mp3", "pipe:1"],
    { input: pcm, maxBuffer: 64 * 1024 * 1024 },
  );

  if (encoded.status !== 0) {
    throw new Error(`ffmpeg failed: ${encoded.stderr?.toString().slice(0, 200)}`);
  }

  return encoded.stdout;
}

export async function geminiMp3({ text, voice, language, bitrate, timeoutMs }) {
  const pcm = await geminiPcm({ text, voice, language, timeoutMs });

  return {
    audio: pcmToMp3(pcm, bitrate),
    durationMs: (pcm.length / 2 / GEMINI_SAMPLE_RATE) * 1000,
  };
}
