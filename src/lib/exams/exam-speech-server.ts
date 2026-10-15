import "server-only";

import { createHash } from "node:crypto";

import { SonioxNodeClient } from "@soniox/node";

import { STORAGE_BUCKET } from "@/lib/constants";
import type { ExamTopicRow } from "@/lib/database.types";
import { TTS_OUTPUT_BITRATE, TTS_OUTPUT_FORMAT, TTS_OUTPUT_MIME_TYPE } from "@/lib/note-tts";
import type { NoteTtsVoice } from "@/lib/note-tts-settings";
import { getServerEnv, requireSonioxEnv } from "@/lib/server-env";
import { resolveSpeechLanguage } from "@/lib/speech-language";
import { speechModel, speechProvider, synthesizeGeminiMp3 } from "@/lib/speech-synthesis";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

/*
 * Astra's summary has an audio player. A topic summary is short (a paragraph and a few key
 * points), so it is spoken in one request and kept: the file is written once per topic, voice and
 * text, and every later play is a signed link to it. The text is always the topic's stored summary,
 * never anything the browser sends. It is spoken by the app's voice engine, the one the tutor and
 * read-aloud use (Gemini, or Soniox when TTS_PROVIDER says so); the engine's model is in the file's
 * key, so switching engines makes the new voice rather than replaying the old one.
 */

/* Well under the provider's 180 s per request: a summary and its points read in about a minute. */
const MAX_CHARS = 1600;

let client: SonioxNodeClient | undefined;

function soniox() {
  if (!client) {
    client = new SonioxNodeClient({ api_key: requireSonioxEnv().SONIOX_API_KEY });
  }

  return client;
}

export function topicSpeechText(topic: Pick<ExamTopicRow, "title" | "summary" | "key_points">) {
  const points = Array.isArray(topic.key_points) ? (topic.key_points as unknown[]).map(String) : [];
  return [topic.title, topic.summary, ...points].filter(Boolean).join("\n\n").slice(0, MAX_CHARS);
}

export async function topicSummaryAudio(params: {
  userId: string;
  lectureId: string;
  topic: ExamTopicRow;
  languageHint: string | null;
  voice: NoteTtsVoice;
}) {
  const text = topicSpeechText(params.topic);

  if (!text.trim()) {
    return null;
  }

  const env = getServerEnv();
  const hash = createHash("sha256").update(`${speechModel()}:${params.voice}:${text}`).digest("hex").slice(0, 24);
  const path = ["tts", params.userId, "exam", params.topic.id, `${hash}.${TTS_OUTPUT_FORMAT}`].join("/");
  const storage = createSupabaseServiceRoleClient().storage.from(STORAGE_BUCKET);
  const existing = await storage.createSignedUrl(path, 10 * 60);

  if (existing.data?.signedUrl) {
    return existing.data.signedUrl;
  }

  const language = resolveSpeechLanguage(params.languageHint);
  const audio =
    speechProvider() === "gemini"
      ? (
          await synthesizeGeminiMp3({
            text,
            voice: params.voice,
            language,
            bitrate: TTS_OUTPUT_BITRATE,
            timeoutMs: 90_000,
            usage: { stage: "read_aloud_speech", userId: params.userId, lectureId: params.lectureId },
          })
        ).audio
      : await soniox().tts.generate({
          text,
          model: env.SONIOX_TTS_MODEL,
          voice: params.voice,
          language,
          audio_format: TTS_OUTPUT_FORMAT,
          bitrate: TTS_OUTPUT_BITRATE,
        });
  const { error } = await storage.upload(path, Buffer.from(audio), { contentType: TTS_OUTPUT_MIME_TYPE, upsert: true });

  if (error) {
    throw error;
  }

  const signed = await storage.createSignedUrl(path, 10 * 60);
  return signed.data?.signedUrl ?? null;
}
