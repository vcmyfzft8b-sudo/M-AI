import { NextResponse } from "next/server";
import { z } from "zod";

import { SonioxNodeClient } from "@soniox/node";

import { generateStructuredObject } from "@/lib/ai/json";
import { tr } from "@/lib/i18n/server";
import { normalizeSpokenLanguageCode } from "@/lib/languages";
import { synthesizeTtsChunkWithTimestamps } from "@/lib/note-tts-synthesis";
import { NOTE_TTS_VOICES } from "@/lib/note-tts-settings";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { getServerEnv } from "@/lib/server-env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { hasStaticVoiceSamples } from "@/lib/tutor/voice-clips";

export const maxDuration = 60;

/**
 * A voice saying its sample line in a language nothing was pre-rendered for.
 *
 * Eleven voices in seven languages ship as files under public/tutor-demo, and they cover every
 * language this app has note furniture for. They do not cover the languages a learner's material
 * can actually be in: Soniox speaks far more than seven, the tutor now teaches in whatever the
 * material is written in, and somebody studying a Polish lecture was auditioning voices in
 * English — which tells them nothing about the voice they are choosing, because the accent and
 * the cadence are what differ.
 *
 * So the rest are made on demand. It is two paid calls the first time a language is ever asked
 * for — one to say the line in it, one to speak it — and free every time after, because the
 * answer is identical for a given voice and language and is cached as such at the edge, in the
 * browser, and on the device. There is no work here that a build step could have done instead:
 * the set of languages a learner might upload is not a set anybody can enumerate.
 */

const requestSchema = z.object({
  voice: z.enum(NOTE_TTS_VOICES),
  language: z.string().trim().min(2).max(8),
  /*
   * What the voice is being auditioned FOR. A tutor introduces itself to one learner; a podcast
   * host opens an episode. Hearing "I'm your tutor" while choosing between two podcast hosts is
   * a small thing that tells you the screen was assembled rather than designed, and the pitch
   * and pacing of the two lines differ enough that the audition is misleading as well as odd.
   */
  context: z.enum(["tutor", "podcast"]).default("tutor"),
});

/*
 * The line, and the only copy of it outside the generator script that renders the pre-made ones.
 * Kept identical in meaning so that a voice auditioned in Polish is auditioned on the same words
 * as one auditioned in Slovenian.
 */
const SAMPLE_LINES_EN = {
  tutor: "Hi, I'm your tutor. This is how I sound when I explain things to you.",
  podcast: "Hi — this is how I sound when I'm talking through a topic with someone.",
} as const;

const sampleLineSchema = z.object({
  line: z
    .string()
    .min(4)
    .max(240)
    .describe("The sentence, in the requested language, as a person would say it out loud."),
});

/** A year, because the answer for a given voice and language never changes. */
const CACHE_HEADER = "public, max-age=31536000, s-maxage=31536000, immutable";

async function sampleLineFor(language: string, context: "tutor" | "podcast") {
  const { line } = await generateStructuredObject({
    schema: sampleLineSchema,
    stage: "language_check",
    instructions: [
      `Say the given sentence in the language with the code "${language}".`,
      "It is spoken aloud by a voice a learner is auditioning, so write what a person would say, not a literal translation: natural word order, the spoken form of the language, no formality it does not need.",
      "Keep it to one or two short sentences and keep the meaning exactly. Write nothing else — no quotes, no notes, no romanisation.",
    ].join("\n"),
    input: SAMPLE_LINES_EN[context],
    maxOutputTokens: 300,
    maxAttempts: 1,
  });

  return line;
}

export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  /*
   * Signed in, because this spends money on a provider. The pre-rendered clips are static files
   * and need nobody; this one synthesizes, and an open endpoint that synthesizes is an invoice
   * waiting to happen.
   */
  if (!user) {
    return NextResponse.json({ error: await tr("api.unauthorized") }, { status: 401 });
  }

  const limited = await enforceRateLimit({
    request,
    route: "api:tutor:voice-sample",
    rules: rateLimitPresets.expensiveMutate,
    userId: user.id,
  });

  if (limited) {
    return limited;
  }

  const url = new URL(request.url);
  const parsed = requestSchema.safeParse({
    voice: url.searchParams.get("voice"),
    language: url.searchParams.get("language"),
    context: url.searchParams.get("context") ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json({ error: await tr("api.invalidVoiceRequest") }, { status: 400 });
  }

  const language = normalizeSpokenLanguageCode(parsed.data.language);

  if (!language) {
    return NextResponse.json({ error: await tr("api.invalidVoiceRequest") }, { status: 400 });
  }

  /*
   * A language that has files should never reach here — voiceSampleClip sends it to them — so a
   * request for one is a client that has drifted, and paying to synthesize what is already on
   * disk would be the wrong way to be forgiving about it.
   *
   * Both auditions have files now — a tutor line and a host line, which are different jobs and
   * different sentences. A language without them is a learner's material in something the app has
   * no note furniture for, and that is synthesized once per voice and language and free for ever
   * after: the answer never changes and is cached as such.
   */
  if (hasStaticVoiceSamples(language)) {
    const kind = parsed.data.context === "podcast" ? "podcast" : "sample";

    return NextResponse.redirect(
      new URL(`/tutor-demo/${language}/${parsed.data.voice.toLowerCase()}-${kind}.mp3`, url),
      308,
    );
  }

  const env = getServerEnv();

  if (!env.SONIOX_API_KEY) {
    return NextResponse.json({ error: await tr("api.tutorStartFailed") }, { status: 503 });
  }

  try {
    const line = await sampleLineFor(language, parsed.data.context);
    const { audio } = await synthesizeTtsChunkWithTimestamps({
      client: new SonioxNodeClient({ api_key: env.SONIOX_API_KEY }),
      text: line,
      model: env.SONIOX_TTS_MODEL,
      voice: parsed.data.voice,
      language,
      audioFormat: "mp3",
      bitrate: 64_000,
      timeoutMs: 30_000,
    });

    return new NextResponse(audio as unknown as BodyInit, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": CACHE_HEADER,
        "Content-Length": String(audio.byteLength),
      },
    });
  } catch (error) {
    console.error("[tutor] voice sample failed", { language, voice: parsed.data.voice, error });

    return NextResponse.json({ error: await tr("api.tutorStartFailed") }, { status: 502 });
  }
}
