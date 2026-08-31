import { NextResponse } from "next/server";

import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { inferAudioMimeTypeFromFile, isSupportedAudioMimeType } from "@/lib/storage";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getTranscriptionProvider } from "@/lib/transcription/provider";
import {
  InvalidAudioFileError,
  NoClearSpeechDetectedError,
} from "@/lib/transcription/types";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * A dictated chat question is seconds long, so anything larger than this is not
 * a question — it is a recording that belongs in the upload flow. The cap also
 * keeps the request under Vercel's ~4.5 MB body limit with room to spare.
 */
const MAX_DICTATION_BYTES = 4 * 1024 * 1024;

/**
 * Speech to text for a chat composer.
 *
 * This deliberately runs through the same transcription provider as the lecture
 * pipeline rather than the browser's own `SpeechRecognition`. That API does not
 * exist in Firefox or in the iOS WKWebView the app ships in, it needs Google's
 * servers in Chrome — where it fails with a bare `network` error whenever they
 * cannot be reached — and Safari's implementation ends the session after every
 * utterance. Recording locally and transcribing here works in every browser
 * that can open a microphone at all, and it recognises Slovenian far better.
 */
export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Nedovoljen dostop." }, { status: 401 });
  }

  const limited = await enforceRateLimit({
    request,
    route: "api:dictation:post",
    rules: rateLimitPresets.dictation,
    userId: user.id,
  });

  if (limited) {
    return limited;
  }

  let file: File | null = null;

  try {
    const formData = await request.formData();
    const candidate = formData.get("audio");
    file = candidate instanceof File ? candidate : null;
  } catch {
    return NextResponse.json({ error: "Posnetka ni bilo mogoče prebrati." }, { status: 400 });
  }

  if (!file || file.size === 0) {
    return NextResponse.json({ error: "Posnetka ni bilo mogoče prebrati." }, { status: 400 });
  }

  if (file.size > MAX_DICTATION_BYTES) {
    return NextResponse.json(
      { error: "Posnetek je predolg. Povej vprašanje na kratko." },
      { status: 413 },
    );
  }

  if (!isSupportedAudioMimeType(file.type || "", file.name)) {
    return NextResponse.json(
      { error: "Tega zvočnega formata ne znam prebrati." },
      { status: 415 },
    );
  }

  /*
   * MediaRecorder hands back `audio/webm;codecs=opus` and Safari `audio/mp4`;
   * the provider only wants the base type, and a matching file name because
   * some formats are only identifiable by extension.
   */
  const mimeType = inferAudioMimeTypeFromFile({
    mimeType: file.type || "",
    fileName: file.name,
  });
  const named = new File([file], file.name || "dictation", { type: mimeType });

  try {
    // No language hint: the composer never asks for one, and asserting
    // Slovenian would transcribe an English question as nonsense.
    const result = await getTranscriptionProvider().transcribe({
      file: named,
      languageHint: null,
    });

    return NextResponse.json({ text: result.text.trim() });
  } catch (error) {
    // Silence is an ordinary outcome of tapping the microphone twice, not a
    // failure: answer with nothing said and let the composer stay as it was.
    if (error instanceof NoClearSpeechDetectedError) {
      return NextResponse.json({ text: "" });
    }

    if (error instanceof InvalidAudioFileError) {
      return NextResponse.json(
        { error: "Posnetka ni bilo mogoče prebrati. Poskusi znova." },
        { status: 422 },
      );
    }

    console.error("Dictation transcription failed", error);

    return NextResponse.json(
      { error: "Narekovanje trenutno ne deluje. Poskusi znova." },
      { status: 502 },
    );
  }
}
