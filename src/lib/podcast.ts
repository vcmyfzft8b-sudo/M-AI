import "server-only";

import { createHash } from "node:crypto";

import { SonioxNodeClient } from "@soniox/node";

import { generateStructuredObject } from "@/lib/ai/json";
import {
  buildPodcastScriptInstructions,
  podcastScriptSchema,
  type PodcastScript,
} from "@/lib/ai/podcast-prompt";
import { STORAGE_BUCKET } from "@/lib/constants";
import type { Json, LecturePodcastRow, LecturePodcastSegmentRow } from "@/lib/database.types";
import { normalizeSpokenLanguageCode, resolveMaterialLanguage } from "@/lib/languages";
import {
  abandonTtsGeneration,
  claimTtsGeneration,
  isTtsProviderRateLimitError,
  safeStorageSegment,
  settleTtsGeneration,
  TTS_OUTPUT_BITRATE,
  TTS_OUTPUT_FORMAT,
  TTS_OUTPUT_MIME_TYPE,
  TtsGenerationPendingError,
  type TtsGenerationIdentity,
  type TtsQuotaContext,
} from "@/lib/note-tts";
import { synthesizeTtsChunkWithTimestamps } from "@/lib/note-tts-synthesis";
import type { NoteTtsVoice } from "@/lib/note-tts-settings";
import { stripLeadingRedundantHeading } from "@/lib/note-tts-text";
import { normalizePodcastTurns, parseStoredTurns } from "@/lib/podcast-script";
import {
  estimatedSpokenSeconds,
  getPodcastFormat,
  getPodcastLength,
  podcastCastKey,
  reservedSpokenSeconds,
  voiceGender,
  type PodcastFormat,
  type PodcastLength,
  type PodcastSpeaker,
} from "@/lib/podcast-settings";
import { isMissingLectureReferenceError } from "@/lib/postgres-errors";
import { getServerEnv, requireSonioxEnv } from "@/lib/server-env";
import { retryTransientStorageOperation } from "@/lib/storage-download-errors";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { selectUsableTutorPlan } from "@/lib/tutor/plan-cache";

/**
 * How much of the note the episode is written from.
 *
 * Far more generous than the tutor's cap, and for a plain reason: the tutor re-sends its
 * grounding once per topic, so a long note is paid for eight or nine times in a session, whereas
 * an episode is one call. Cutting the material here would show up as an episode that stops
 * covering the lecture two thirds of the way through, which is the one thing a listener cannot
 * work around — they cannot see what was left out.
 */
const PODCAST_SOURCE_CHAR_CAP = 60_000;

/** The turns' own words, plus room for the JSON and the title. Headroom is applied on top. */
const PODCAST_SCRIPT_TOKENS_PER_WORD = 3;

/**
 * How long a claimed-but-unwritten script stays believed.
 *
 * A generation runs inside one Vercel invocation and dies with it, and an invocation the platform
 * kills runs no catch block — so a row can be left saying "generating" by a process that no
 * longer exists. Until this much time has passed, a second request waits for the first rather
 * than paying for a duplicate; after it, the row is plainly dead and is taken over.
 */
const PODCAST_GENERATION_STALE_MS = 6 * 60 * 1000;

const PODCAST_STREAM_TIMEOUT_MS = 120_000;

export class PodcastGenerationPendingError extends Error {
  constructor() {
    super("The episode is already being written.");
    this.name = "PodcastGenerationPendingError";
  }
}

export class PodcastSourceNotReadyError extends Error {
  constructor() {
    super("The note has no finished content to make an episode from.");
    this.name = "PodcastSourceNotReadyError";
  }
}

export class LectureRemovedDuringPodcastError extends Error {
  constructor() {
    super("The lecture was deleted while its episode was being produced.");
    this.name = "LectureRemovedDuringPodcastError";
  }
}

let sonioxClient: SonioxNodeClient | undefined;

function getSonioxClient() {
  if (!sonioxClient) {
    sonioxClient = new SonioxNodeClient({ api_key: requireSonioxEnv().SONIOX_API_KEY });
  }

  return sonioxClient;
}

export function hashPodcastSource(content: string) {
  return createHash("sha256").update(`podcast-v1:${content}`).digest("hex");
}

export type PodcastSource = {
  title: string | null;
  summary: string | null;
  keyTopics: string[];
  notes: string;
  contentHash: string;
  language: string;
};

/**
 * The note an episode is made from, and the language it is made in.
 *
 * The language is worked out exactly the way the tutor works it out, from the same three signals
 * in the same order: the lesson plan first, because a model read the whole note to write it and
 * named the language it was reading; then detection; then the hint somebody typed at upload. It
 * has to be this and not the app's locale — a Slovenian lecture is a Slovenian podcast however
 * the interface is set.
 */
export async function loadPodcastSource(lectureId: string): Promise<PodcastSource | null> {
  const supabase = createSupabaseServiceRoleClient();
  const [{ data: artifact }, { data: lecture }] = await Promise.all([
    supabase
      .from("lecture_artifacts")
      .select("summary, key_topics, structured_notes_md, tutor_plan, tutor_plan_notes_hash")
      .eq("lecture_id", lectureId)
      .maybeSingle(),
    supabase.from("lectures").select("title, language_hint, status").eq("id", lectureId).maybeSingle(),
  ]);

  const artifactRow = (artifact ?? null) as {
    summary: string | null;
    key_topics: string[] | null;
    structured_notes_md: string | null;
    tutor_plan: unknown;
    tutor_plan_notes_hash: string | null;
  } | null;
  const lectureRow = (lecture ?? null) as {
    title: string | null;
    language_hint: string | null;
    status: string;
  } | null;

  if (!artifactRow || !lectureRow) {
    return null;
  }

  const full = stripLeadingRedundantHeading(
    artifactRow.structured_notes_md ?? "",
    lectureRow.title,
  );

  if (lectureRow.status !== "ready" || full.trim().length === 0) {
    return null;
  }

  const planned = normalizeSpokenLanguageCode(
    selectUsableTutorPlan({
      plan: artifactRow.tutor_plan,
      notesHash: artifactRow.tutor_plan_notes_hash,
      notes: artifactRow.structured_notes_md ?? "",
    })?.language,
  );

  return {
    title: lectureRow.title,
    summary: artifactRow.summary,
    keyTopics: artifactRow.key_topics ?? [],
    notes: full.slice(0, PODCAST_SOURCE_CHAR_CAP),
    /*
     * Hashed over the whole note rather than over the truncated copy: two notes that differ only
     * past the cap are different notes, and an episode cached against the first would be served
     * for the second.
     */
    contentHash: hashPodcastSource(full),
    language:
      planned ?? resolveMaterialLanguage(`${artifactRow.summary ?? ""}\n${full}`, lectureRow.language_hint),
  };
}

/**
 * Everything a stored script is an answer to.
 *
 * `contentHash` is the note's hash with the cast key appended, and that compound is deliberate.
 * The script's words agree with the hosts' genders, so a script written for a woman and a man is
 * not the script for two women — it has to be a different row. Folding the cast into the hash
 * rather than adding a column keeps this inside the unique index the table already has, and the
 * note's hash stays its prefix so the library can still find every episode of a note by matching
 * on that prefix alone.
 */
type PodcastVariant = {
  lectureId: string;
  contentHash: string;
  format: PodcastFormat;
  length: PodcastLength;
  language: string;
};

export async function getPodcastRow(variant: PodcastVariant) {
  const { data, error } = await createSupabaseServiceRoleClient()
    .from("lecture_podcasts")
    .select("*")
    .eq("lecture_id", variant.lectureId)
    .eq("content_hash", variant.contentHash)
    .eq("format", variant.format)
    .eq("length_id", variant.length)
    .eq("language", variant.language)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return (data ?? null) as LecturePodcastRow | null;
}

/**
 * Every finished episode this note already has.
 *
 * Only for the note as it stands now: the content hash is part of a variant's identity, so an
 * episode written from an earlier draft is not an episode of this note and listing it would offer
 * somebody a recording of text they have since changed.
 */
export async function listPodcastEpisodes(params: { lectureId: string; contentHash: string }) {
  const { data, error } = await createSupabaseServiceRoleClient()
    .from("lecture_podcasts")
    .select("id, format, length_id, language, title, turns, created_at")
    .eq("lecture_id", params.lectureId)
    /* Every cast of this note's text — see PodcastVariant for why the hash is compound. */
    .like("content_hash", `${params.contentHash}:%`)
    .eq("status", "ready")
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  return ((data ?? []) as Array<{
    id: string;
    format: string;
    length_id: string;
    language: string;
    title: string | null;
    turns: unknown;
    created_at: string;
  }>).map((row) => {
    const turns = parseStoredTurns(row.turns);

    return {
      id: row.id,
      format: row.format,
      length: row.length_id,
      language: row.language,
      title: row.title,
      turnCount: turns.length,
      /* What the row knows, rather than what the length was asked for: an episode is as long as
         it came out, and the listener is choosing between things that already exist. */
      estimatedSeconds: turns.reduce((sum, turn) => sum + estimatedSpokenSeconds(turn.text), 0),
      createdAt: row.created_at,
    };
  });
}

function isStalePodcastGeneration(row: LecturePodcastRow) {
  if (row.status !== "generating") {
    return false;
  }

  const startedAt = row.generation_started_at ?? row.updated_at;

  return Date.now() - new Date(startedAt).getTime() > PODCAST_GENERATION_STALE_MS;
}

/**
 * Takes the row for this variant if nobody else is writing it.
 *
 * The insert races on the variant's unique index, so exactly one of two simultaneous requests
 * creates the row; the loser reads what is there and decides from its status. A finished episode
 * is returned as it stands — the script is deterministic enough not to be worth paying for twice
 * — and a failed or plainly dead one is taken over.
 */
async function claimPodcastRow(variant: PodcastVariant) {
  const supabase = createSupabaseServiceRoleClient();
  const { data: inserted, error: insertError } = await supabase
    .from("lecture_podcasts")
    .insert(
      {
        lecture_id: variant.lectureId,
        content_hash: variant.contentHash,
        format: variant.format,
        length_id: variant.length,
        language: variant.language,
        status: "generating",
        generation_started_at: new Date().toISOString(),
      } as never,
    )
    .select("*")
    .maybeSingle();

  if (!insertError && inserted) {
    return { row: inserted as LecturePodcastRow, claimed: true };
  }

  if (insertError && isMissingLectureReferenceError(insertError)) {
    throw new LectureRemovedDuringPodcastError();
  }

  const existing = await getPodcastRow(variant);

  if (!existing) {
    /* The insert failed for something other than the race, and there is nothing to fall back to. */
    throw insertError ?? new Error("Could not claim a podcast row.");
  }

  if (existing.status === "ready") {
    return { row: existing, claimed: false };
  }

  if (existing.status === "generating" && !isStalePodcastGeneration(existing)) {
    return { row: existing, claimed: false };
  }

  const { data: taken, error: takeError } = await supabase
    .from("lecture_podcasts")
    .update(
      {
        status: "generating",
        error_message: null,
        generation_started_at: new Date().toISOString(),
      } as never,
    )
    .eq("id", existing.id)
    /* Only if it is still the row this decision was made about. */
    .eq("updated_at", existing.updated_at)
    .select("*")
    .maybeSingle();

  if (takeError) {
    throw takeError;
  }

  return taken
    ? { row: taken as LecturePodcastRow, claimed: true }
    : { row: existing, claimed: false };
}

async function writePodcastScript(params: {
  row: LecturePodcastRow;
  source: PodcastSource;
  format: PodcastFormat;
  length: PodcastLength;
  voices: Record<PodcastSpeaker, NoteTtsVoice>;
}) {
  const format = getPodcastFormat(params.format);
  const length = getPodcastLength(params.length);
  const supabase = createSupabaseServiceRoleClient();

  let script: PodcastScript;

  try {
    script = await generateStructuredObject({
      schema: podcastScriptSchema,
      stage: "podcast_script",
      instructions: buildPodcastScriptInstructions({
        format: params.format,
        speakerCount: format.speakerCount,
        targetWords: length.targetWords,
        genders: {
          a: voiceGender(params.voices.a),
          ...(format.speakerCount === 2 ? { b: voiceGender(params.voices.b) } : {}),
        },
      }),
      input: JSON.stringify({
        language: params.source.language,
        title: params.source.title,
        summary: params.source.summary,
        keyTopics: params.source.keyTopics,
        material: params.source.notes,
      }),
      maxOutputTokens: length.targetWords * PODCAST_SCRIPT_TOKENS_PER_WORD,
      usageContext: { lectureId: params.row.lecture_id },
    });
  } catch (error) {
    await supabase
      .from("lecture_podcasts")
      .update(
        {
          status: "failed",
          error_message: error instanceof Error ? error.message : "Unknown podcast script error.",
        } as never,
      )
      .eq("id", params.row.id);

    throw error;
  }

  const turns = normalizePodcastTurns({
    turns: script.turns,
    speakerCount: format.speakerCount,
  });

  if (turns.length === 0) {
    await supabase
      .from("lecture_podcasts")
      .update({ status: "failed", error_message: "The script came back empty." } as never)
      .eq("id", params.row.id);

    throw new Error("The generated podcast script had no speakable turns.");
  }

  const { data, error } = await supabase
    .from("lecture_podcasts")
    .update(
      {
        status: "ready",
        title: script.title,
        turns: turns as unknown as Json,
        error_message: null,
      } as never,
    )
    .eq("id", params.row.id)
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  return data as LecturePodcastRow;
}

/**
 * The episode's script, written once per note, format and length.
 *
 * Idempotent by construction: the variant's unique index decides who writes, so a listener who
 * taps twice, reloads mid-write or opens the note in a second tab waits for the call already
 * running instead of buying a second one.
 */
export async function getOrCreatePodcastScript(params: {
  lectureId: string;
  format: PodcastFormat;
  length: PodcastLength;
  voices: Record<PodcastSpeaker, NoteTtsVoice>;
}) {
  const source = await loadPodcastSource(params.lectureId);

  if (!source) {
    throw new PodcastSourceNotReadyError();
  }

  const format = getPodcastFormat(params.format);
  const variant: PodcastVariant = {
    lectureId: params.lectureId,
    contentHash: `${source.contentHash}:${podcastCastKey({
      voices: params.voices,
      speakerCount: format.speakerCount,
    })}`,
    format: params.format,
    length: params.length,
    language: source.language,
  };
  const existing = await getPodcastRow(variant);

  if (existing?.status === "ready") {
    return { row: existing, source };
  }

  const claim = await claimPodcastRow(variant);

  if (!claim.claimed) {
    if (claim.row.status === "ready") {
      return { row: claim.row, source };
    }

    throw new PodcastGenerationPendingError();
  }

  return {
    row: await writePodcastScript({
      row: claim.row,
      source,
      format: params.format,
      length: params.length,
      voices: params.voices,
    }),
    source,
  };
}

function buildPodcastStoragePath(params: {
  userId: string;
  lectureId: string;
  podcastId: string;
  segmentIndex: number;
  voice: string;
  model: string;
}) {
  return [
    "podcast",
    params.userId,
    params.lectureId,
    params.podcastId,
    `${String(params.segmentIndex).padStart(4, "0")}-${safeStorageSegment(params.model)}-${safeStorageSegment(params.voice)}.mp3`,
  ].join("/");
}

async function getCachedSegmentRow(params: {
  podcastId: string;
  segmentIndex: number;
  voice: string;
  model: string;
}) {
  const { data, error } = await createSupabaseServiceRoleClient()
    .from("lecture_podcast_segments")
    .select("*")
    .eq("podcast_id", params.podcastId)
    .eq("segment_index", params.segmentIndex)
    .eq("voice", params.voice)
    .eq("model", params.model)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return (data ?? null) as LecturePodcastSegmentRow | null;
}

/** Ten minutes: long enough to listen through the segments queued behind this one. */
const PODCAST_SIGNED_URL_SECONDS = 10 * 60;

async function signSegment(row: LecturePodcastSegmentRow) {
  /* Retried for the same reason read-aloud retries it: this is the last step after work that
     cannot be repeated cheaply, and Supabase has been seen answering a signed-URL read with a
     bare 520. */
  const { data, error } = await retryTransientStorageOperation(() =>
    createSupabaseServiceRoleClient()
      .storage.from(STORAGE_BUCKET)
      .createSignedUrl(row.audio_storage_path, PODCAST_SIGNED_URL_SECONDS),
  );

  if (error || !data?.signedUrl) {
    throw error ?? new Error("Could not create a signed podcast audio URL.");
  }

  return data.signedUrl;
}

export async function listReadyPodcastSegments(params: {
  podcastId: string;
  voices: Record<PodcastSpeaker, NoteTtsVoice>;
}) {
  const env = getServerEnv();
  const { data, error } = await createSupabaseServiceRoleClient()
    .from("lecture_podcast_segments")
    .select("segment_index, speaker, voice, duration_ms")
    .eq("podcast_id", params.podcastId)
    .eq("model", env.SONIOX_TTS_MODEL)
    .in("voice", [params.voices.a, params.voices.b]);

  if (error) {
    throw error;
  }

  const rows = (data ?? []) as Array<{
    segment_index: number;
    speaker: string;
    voice: string;
    duration_ms: number;
  }>;

  /* Only the rows whose voice is the one that speaker is currently set to. */
  return rows
    .filter((row) => params.voices[row.speaker === "b" ? "b" : "a"] === row.voice)
    .map((row) => ({ segmentIndex: row.segment_index, durationMs: row.duration_ms }));
}

/**
 * One turn of audio, synthesized on demand.
 *
 * The whole episode is deliberately not produced up front. Ten minutes of speech is more than a
 * single Vercel invocation can synthesize — the stream runs at roughly the length of the audio —
 * so producing it eagerly would mean a job that has to survive being split across invocations,
 * and a listener who waits for all of it before hearing any of it. Making a turn when the player
 * is about to reach it means the first words play within seconds of the script landing, and an
 * episode nobody finishes is never paid for past the point they stopped.
 */
export async function getOrCreatePodcastSegment(params: {
  userId: string;
  lectureId: string;
  podcast: LecturePodcastRow;
  segmentIndex: number;
  voices: Record<PodcastSpeaker, NoteTtsVoice>;
  quotaContext: TtsQuotaContext;
}) {
  const env = getServerEnv();
  const turns = parseStoredTurns(params.podcast.turns);
  const turn = turns[params.segmentIndex];

  if (!turn) {
    return null;
  }

  const voice = params.voices[turn.speaker];
  const model = env.SONIOX_TTS_MODEL;
  const cached = await getCachedSegmentRow({
    podcastId: params.podcast.id,
    segmentIndex: params.segmentIndex,
    voice,
    model,
  });

  if (cached) {
    return {
      row: cached,
      audioUrl: await signSegment(cached),
      quota: null,
    };
  }

  const identity: TtsGenerationIdentity = {
    userId: params.userId,
    lectureId: params.lectureId,
    /*
     * The ledger's `contentHash` only has to name a piece of audio uniquely, and for an episode
     * the episode's own id does that — the note's hash is already folded into the variant this
     * row belongs to.
     */
    contentHash: `podcast:${params.podcast.id}`,
    chunkIndex: params.segmentIndex,
    language: params.podcast.language,
    voice,
    model,
  };
  const claim = await claimTtsGeneration({
    identity,
    estimatedSeconds: reservedSpokenSeconds(turn.text),
    quotaContext: params.quotaContext,
  });

  if (!claim.claimed) {
    /* Somebody else is synthesizing this exact turn; the caller asks again in a moment. */
    throw new TtsGenerationPendingError();
  }

  let shouldRelease = Boolean(claim.reservation);

  try {
    const { audio, durationMs } = await synthesizePodcastTurn({
      text: turn.text,
      language: params.podcast.language,
      voice,
      model,
    });
    const audioStoragePath = buildPodcastStoragePath({
      userId: params.userId,
      lectureId: params.lectureId,
      podcastId: params.podcast.id,
      segmentIndex: params.segmentIndex,
      voice,
      model,
    });
    const supabase = createSupabaseServiceRoleClient();
    const { error: uploadError } = await retryTransientStorageOperation(() =>
      supabase.storage.from(STORAGE_BUCKET).upload(audioStoragePath, Buffer.from(audio), {
        contentType: TTS_OUTPUT_MIME_TYPE,
        upsert: true,
      }),
    );

    if (uploadError) {
      throw uploadError;
    }

    const { data, error } = await supabase
      .from("lecture_podcast_segments")
      .upsert(
        {
          podcast_id: params.podcast.id,
          segment_index: params.segmentIndex,
          speaker: turn.speaker,
          text: turn.text,
          language: params.podcast.language,
          voice,
          model,
          audio_storage_path: audioStoragePath,
          audio_mime_type: TTS_OUTPUT_MIME_TYPE,
          duration_ms: Math.ceil(durationMs),
        } as never,
        { onConflict: "podcast_id,segment_index,voice,model" },
      )
      .select("*")
      .single();

    if (error) {
      if (isMissingLectureReferenceError(error)) {
        /* The note was deleted mid-synthesis; its cascade could not have reached this object. */
        await supabase.storage.from(STORAGE_BUCKET).remove([audioStoragePath]);

        throw new LectureRemovedDuringPodcastError();
      }

      throw error;
    }

    shouldRelease = false;

    const row = data as LecturePodcastSegmentRow;
    const quota = await settleTtsGeneration({
      reservation: claim.reservation,
      fallbackQuota: claim.quota,
      actualSeconds: Math.max(1, Math.ceil(row.duration_ms / 1000)),
    });

    return { row, audioUrl: await signSegment(row), quota };
  } catch (error) {
    if (shouldRelease) {
      await abandonTtsGeneration(claim.reservation);
    }

    throw error;
  }
}

/**
 * One turn through the synthesizer.
 *
 * The WebSocket is the primary because it reports what it actually said, which is where the
 * duration comes from; the REST endpoint is the fallback for a stream that failed for a reason
 * repeating it will not fix. Unlike read-aloud there is no alignment pass on the fallback path —
 * a podcast highlights the turn being spoken, not the word, so the bytes are all the timing the
 * player needs.
 */
async function synthesizePodcastTurn(params: {
  text: string;
  language: string;
  voice: NoteTtsVoice;
  model: string;
}) {
  const client = getSonioxClient();

  try {
    const synthesized = await synthesizeTtsChunkWithTimestamps({
      client,
      text: params.text,
      model: params.model,
      voice: params.voice,
      language: params.language,
      audioFormat: TTS_OUTPUT_FORMAT,
      bitrate: TTS_OUTPUT_BITRATE,
      timeoutMs: PODCAST_STREAM_TIMEOUT_MS,
    });

    return { audio: synthesized.audio, durationMs: synthesized.durationMs };
  } catch (error) {
    /*
     * A truncation and the organization's concurrent-stream cap are both things REST would either
     * repeat or make worse, so they are reported rather than retried on another transport. The
     * caller backs off on the rate limit.
     */
    if (error instanceof Error && error.name === "TtsAudioTruncatedError") {
      throw error;
    }

    if (isTtsProviderRateLimitError(error)) {
      throw error;
    }

    console.warn("Podcast TTS stream failed; falling back to REST synthesis", { error });
  }

  const audio = await client.tts.generate({
    text: params.text,
    model: params.model,
    voice: params.voice,
    language: params.language,
    audio_format: TTS_OUTPUT_FORMAT,
    bitrate: TTS_OUTPUT_BITRATE,
  });

  return {
    audio,
    /* Constant-bitrate MP3: the byte count is the length, which is what the listener is charged. */
    durationMs: Math.round((audio.length * 8 * 1000) / TTS_OUTPUT_BITRATE),
  };
}
