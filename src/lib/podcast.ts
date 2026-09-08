import "server-only";
import { resolveSourceLanguage } from "@/lib/source-language";
import { buildSpeechLanguageInstruction, resolveSpeechLanguage, toSpeechScript } from "@/lib/speech-language";

import { createHash } from "node:crypto";

import { SonioxNodeClient } from "@soniox/node";

import { generateStructuredObject } from "@/lib/ai/json";
import { repairPassage } from "@/lib/ai/language-check";
import { shouldCheckLanguage } from "@/lib/ai/language-repair";
import {
  isLanguageCheckEnabled,
  resolveStageModelConfig,
  writerNeedsLanguageCheck,
} from "@/lib/ai/model-config";
import {
  buildPodcastScriptInstructions,
  podcastScriptSchema,
  type PodcastScript,
} from "@/lib/ai/podcast-prompt";
import { STORAGE_BUCKET } from "@/lib/constants";
import type { Json, LecturePodcastRow, LecturePodcastSegmentRow } from "@/lib/database.types";
import {
  isTtsProviderRateLimitError,
  safeStorageSegment,
  TTS_OUTPUT_BITRATE,
  TTS_OUTPUT_FORMAT,
  TTS_OUTPUT_MIME_TYPE,
} from "@/lib/note-tts";
import {
  getTutorAllowance,
  openTutorGrant,
  settleTutorGrant,
  type TutorAllowance,
} from "@/lib/tutor-usage";
import { synthesizeTtsChunkWithTimestamps } from "@/lib/note-tts-synthesis";
import type { NoteTtsVoice } from "@/lib/note-tts-settings";
import { stripLeadingRedundantHeading } from "@/lib/note-tts-text";
import { keepsSourceTerms, normalizePodcastTurns, parseStoredTurns } from "@/lib/podcast-script";
import {
  estimatedSpokenSeconds,
  getPodcastFormat,
  getPodcastLength,
  podcastCastKey,
  voiceGender,
  type PodcastFormat,
  type PodcastLength,
  type PodcastSpeaker,
  type PodcastTurn,
} from "@/lib/podcast-settings";
import { getRemainingBudgetMs } from "@/lib/abort-context";
import { isMissingLectureReferenceError } from "@/lib/postgres-errors";
import { getServerEnv, requireSonioxEnv } from "@/lib/server-env";
import { retryTransientStorageOperation } from "@/lib/storage-download-errors";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

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

/**
 * There is no listening time left.
 *
 * Carries the allowance because the answer depends on it: a free account is being shown what a
 * subscription is for, and a paid one has spent today and can buy an hour. The tutor answers the
 * same two sentences from the same two states — this feature spends the same minutes, so it
 * refuses in the same words.
 */
export class PodcastAllowanceError extends Error {
  constructor(public readonly allowance: TutorAllowance) {
    super("No spoken-audio allowance left.");
    this.name = "PodcastAllowanceError";
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
  return createHash("sha256").update(`podcast-v2-source-language:${content}`).digest("hex");
}

export type PodcastSource = {
  title: string | null;
  summary: string | null;
  keyTopics: string[];
  notes: string;
  contentHash: string;
  language: string;
};

/** Resolve the source language independently of the interface and old tutor plans. */
export async function loadPodcastSource(lectureId: string): Promise<PodcastSource | null> {
  const supabase = createSupabaseServiceRoleClient();
  const [{ data: artifact }, { data: lecture }] = await Promise.all([
    supabase
      .from("lecture_artifacts")
      .select("summary, key_topics, structured_notes_md, model_metadata")
      .eq("lecture_id", lectureId)
      .maybeSingle(),
    supabase.from("lectures").select("title, language_hint, status").eq("id", lectureId).maybeSingle(),
  ]);

  const artifactRow = (artifact ?? null) as {
    summary: string | null;
    key_topics: string[] | null;
    structured_notes_md: string | null;
    model_metadata: unknown;
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

  const materialLanguage = await resolveSourceLanguage({
    text: artifactRow.structured_notes_md ?? "", hint: lectureRow.language_hint,
    lectureId, metadata: artifactRow.model_metadata,
  });

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
    language: resolveSpeechLanguage(materialLanguage),
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
  /**
   * The same variant as it was keyed before the cast joined the hash: the note's hash alone.
   *
   * Kept so an episode written then is still found, and still opens. Its script was written
   * without knowing the hosts' genders, which is exactly the defect the cast key exists to stop —
   * but an episode somebody already has is better listened to than orphaned, and the next one
   * they make is keyed properly.
   */
  legacyContentHash?: string;
  format: PodcastFormat;
  length: PodcastLength;
  language: string;
};

export async function getPodcastRow(variant: PodcastVariant) {
  const hashes = variant.legacyContentHash
    ? [variant.contentHash, variant.legacyContentHash]
    : [variant.contentHash];
  const { data, error } = await createSupabaseServiceRoleClient()
    .from("lecture_podcasts")
    .select("*")
    .eq("lecture_id", variant.lectureId)
    .in("content_hash", hashes)
    .eq("format", variant.format)
    .eq("length_id", variant.length)
    .eq("language", variant.language);

  if (error) {
    throw error;
  }

  const rows = (data ?? []) as LecturePodcastRow[];

  /* Both shapes can exist side by side; the one keyed on the cast is the current answer. */
  return rows.find((row) => row.content_hash === variant.contentHash) ?? rows[0] ?? null;
}

/**
 * One episode, by its own id.
 *
 * The variant lookup above answers "which episode belongs to these settings", which is the right
 * question while somebody is choosing and the wrong one once they have tapped a row: the library
 * lists every episode of this note, and the settings on screen may describe a different cast
 * entirely. Asked by id, the answer cannot come back empty because a voice was changed.
 *
 * Scoped to the lecture rather than trusted from the client — the id travels through the browser
 * and ownership of the note is the only thing the route has actually verified. Scoped to the
 * note's current text as well, because the library hides episodes written from an earlier draft
 * and an id must not be a way back to one: a listener with a stale list open would otherwise be
 * played a script about text that no longer exists, labelled as an episode of this note.
 */
export async function getPodcastRowById(params: {
  lectureId: string;
  podcastId: string;
  /** The note as it stands now. An episode of an older draft is not an episode of this note. */
  contentHash: string;
}) {
  const { data, error } = await createSupabaseServiceRoleClient()
    .from("lecture_podcasts")
    .select("*")
    .eq("id", params.podcastId)
    .eq("lecture_id", params.lectureId)
    /* The same predicate the library lists by — see listPodcastEpisodes for the two shapes. */
    .or(`content_hash.eq.${params.contentHash},content_hash.like.${params.contentHash}:*`)
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
    .select(
      "id, format, length_id, language, title, turns, created_at, position_ms, duration_ms, finished_at",
    )
    .eq("lecture_id", params.lectureId)
    /*
     * Every cast of this note's text — see PodcastVariant for why the hash is compound — and the
     * episodes written before the cast was part of it, whose hash is the note's alone. Matching
     * only the compound shape made those disappear from the library, which is how a note with an
     * episode came to open on the screen for making one.
     */
    .or(`content_hash.eq.${params.contentHash},content_hash.like.${params.contentHash}:*`)
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
    position_ms: number | null;
    duration_ms: number | null;
    finished_at: string | null;
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
      /*
       * Where this listener got to, so the library can offer to resume rather than to restart.
       *
       * The measured length is preferred over the estimate wherever it exists: until every turn
       * has been synthesized the estimate is all there is, and "2:34 left" computed against a
       * total that is out by a fifth reads as a bug rather than as an estimate.
       */
      positionMs: row.position_ms ?? 0,
      durationMs: row.duration_ms,
      finished: Boolean(row.finished_at),
    };
  });
}

/**
 * Records where a listener got to.
 *
 * Last write wins, deliberately. Two devices playing the same episode at once is not a thing
 * worth merging — the honest answer to it is wherever the listener most recently was — and a
 * position is cheap enough to be wrong for one round trip.
 *
 * `finished` only ever goes on. An episode played to the end and then scrubbed back to the
 * middle is still one this listener has heard, and the library says `replay` about it; clearing
 * the flag on the next progress write would make that state flicker as they re-listened.
 */
export async function savePodcastProgress(params: {
  lectureId: string;
  podcastId: string;
  positionMs: number;
  durationMs: number | null;
  finished: boolean;
}) {
  const { error } = await createSupabaseServiceRoleClient()
    .from("lecture_podcasts")
    .update({
      position_ms: Math.max(0, Math.round(params.positionMs)),
      ...(params.durationMs !== null && params.durationMs > 0
        ? { duration_ms: Math.round(params.durationMs) }
        : {}),
      ...(params.finished ? { finished_at: new Date().toISOString() } : {}),
    } as never)
    .eq("id", params.podcastId)
    /* The row has to belong to the note whose page this is; ownership of the note is checked by
       the route. Both together are what stops an id from another account being writable. */
    .eq("lecture_id", params.lectureId);

  if (error) {
    throw error;
  }
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

/*
 * How many turns are proofread at once.
 *
 * The tutor repairs unit by unit as it speaks, because it has no choice — the learner is
 * waiting and the next sentence has not been written yet. An episode is written in full before
 * a word of it is played, so the whole script can go through at once, and the only reason not
 * to send all twenty turns together is the gateway: a burst that size gets rate-limited, and a
 * repair that fails is a repair that silently does not happen.
 */
const PODCAST_REPAIR_CONCURRENCY = 5;

/**
 * The most wall clock the whole pass may spend, and the least it needs to be worth starting.
 *
 * The route runs under Vercel's 300s and the script has already taken most of it: GLM is leashed
 * at 200s with room for a Gemini fallback behind it, which is a worst case of about 290 before
 * this pass begins. Every repair is optional by construction — a turn whose check is late is
 * spoken as it was written — but a pass that runs past the invocation kills it AFTER the
 * expensive call and stores nothing at all, which is the one outcome worse than unproofread
 * Slovenian.
 *
 * So it is bounded twice. It does not start unless the remaining budget could hold it, and once
 * started it stops opening new batches when its own budget is gone. Measured over six runs on
 * the omrezja-sl fixture the whole pass takes 2.8-12.3s for twenty to thirty turns, so the cap
 * is roughly four times the worst case seen rather than a number the normal path can feel.
 */
const PODCAST_REPAIR_BUDGET_MS = 45_000;
const PODCAST_REPAIR_MIN_BUDGET_MS = 20_000;

/**
 * The proofreading pass, armed by the writer rather than by a flag — the tutor's own rule.
 *
 * The check exists for one measured defect: GLM writes 0.55-1.06 errors per 100 words of spoken
 * Slovenian, including words that do not exist, which the synthesizer then pronounces. The tutor
 * does NOT run this in production, and that is not an oversight — its writer was switched to a
 * Gemini on 2026-09-04 precisely because it sits at 0.26-0.39 unaided, and the checker's ~950ms
 * in front of every turn was most of what the switch was for. `writerNeedsLanguageCheck` is what
 * turns the net back on if GLM ever writes turns again.
 *
 * The podcast is the one place GLM still writes spoken words, so here the same gate resolves the
 * other way and the check runs. Unlike the tutor it costs nothing a listener can feel: that call
 * sits between a learner and the first sound, whereas this one runs once while the progress bar
 * is already up, and the corrected text is what gets stored. Every later listen, and every
 * re-voicing, reads the repaired script.
 *
 * `repairPassage` decides for itself whether a passage is worth checking (English is skipped,
 * and so is anything too short to judge) and returns null for every way it can fail, which means
 * "keep what you had". The sound-effect tags survive by construction: a correction whose bracket
 * set differs from the original's is refused outright, so the laugh the writer put in cannot be
 * proofread away.
 */
async function proofreadTurns(params: {
  turns: PodcastTurn[];
  language: string;
  lectureId: string;
  /** The lecture's own words, which outrank the checker's opinion of them. */
  material: string;
  /** Who wrote the script. A Gemini needs no checking; GLM does. */
  writer: string;
}): Promise<PodcastTurn[]> {
  if (
    !isLanguageCheckEnabled() ||
    !writerNeedsLanguageCheck(params.writer) ||
    !shouldCheckLanguage(params.language)
  ) {
    return params.turns;
  }

  const invocationBudget = getRemainingBudgetMs();

  if (invocationBudget !== undefined && invocationBudget < PODCAST_REPAIR_MIN_BUDGET_MS) {
    return params.turns;
  }

  const budgetMs = Math.min(
    PODCAST_REPAIR_BUDGET_MS,
    invocationBudget === undefined
      ? PODCAST_REPAIR_BUDGET_MS
      : Math.max(0, invocationBudget - PODCAST_REPAIR_MIN_BUDGET_MS / 2),
  );
  const deadline = Date.now() + budgetMs;
  const timeout = AbortSignal.timeout(budgetMs);
  const repaired = [...params.turns];

  for (let start = 0; start < repaired.length; start += PODCAST_REPAIR_CONCURRENCY) {
    /* Whatever has been repaired so far stands; the rest is spoken as it was written. */
    if (Date.now() >= deadline) {
      break;
    }

    const slice = repaired.slice(start, start + PODCAST_REPAIR_CONCURRENCY);

    await Promise.all(
      slice.map(async (turn, offset) => {
        const index = start + offset;

        /*
         * What came before, as context only. The original rather than the repaired text: the
         * batch above may still be running, and a checker is given the least it can do the job
         * with — see buildLanguageRepairInput, where handing it more made three edits worse.
         */
        const preceding = index > 0 ? params.turns[index - 1].text : "";
        const corrected = await repairPassage({
          text: turn.text,
          preceding,
          language: params.language,
          spoken: true,
          signal: timeout,
          usageContext: { lectureId: params.lectureId },
        });

        if (corrected && keepsSourceTerms(turn.text, corrected, params.material)) {
          repaired[index] = { ...turn, text: corrected };
        }
      }),
    );
  }

  return repaired;
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
      }) + "\n" + buildSpeechLanguageInstruction(params.source.language),
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

  const turns = await proofreadTurns({
    turns: normalizePodcastTurns({ turns: script.turns, speakerCount: format.speakerCount }),
    language: params.source.language,
    lectureId: params.row.lecture_id,
    material: `${params.source.title}\n${params.source.summary ?? ""}\n${params.source.notes}`,
    writer: resolveStageModelConfig({
      stage: "podcast_script",
      env: process.env,
      fallbackModel: getServerEnv().GEMINI_TEXT_MODEL,
    }).model,
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
    legacyContentHash: source.contentHash,
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
    /*
     * Already made, so nothing is spent — but the meter is still reported, because a listener
     * playing a cached episode wants to see what they have left just as much as one who is
     * spending it.
     */
    return {
      row: cached,
      audioUrl: await signSegment(cached),
      allowance: await getTutorAllowance(params.userId, "podcast"),
    };
  }

  /*
   * The same minutes the spoken tutor spends, out of the same pot.
   *
   * Both features are a voice reading this app's material aloud, they cost the same per second,
   * and the hour a listener can buy is the same hour — so one meter, one refusal, one top-up,
   * rather than two allowances that have to be explained to each other. A null grant means there
   * is nothing left, which is a paywall and not a fault.
   */
  const grant = await openTutorGrant({ userId: params.userId, lectureId: params.lectureId, feature: "podcast" });

  if (!grant) {
    throw new PodcastAllowanceError(await getTutorAllowance(params.userId, "podcast"));
  }

  let settled = false;

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

    const row = data as LecturePodcastSegmentRow;

    /*
     * Raised only once the settle has actually happened, not before it.
     *
     * Set ahead of the await, a settle that threw left the flag saying the grant was closed and
     * the catch below skipping the close — and a grant nobody closes is swept later and charged
     * at what it RESERVED, which on a fresh paid day is the listener's whole half hour. One
     * transient database error would have cost them the day. Settling twice is harmless:
     * settleTutorGrant returns early on a grant that is already settled.
     */
    const allowance = grant.grantId
      ? await settleTutorGrant({
          userId: params.userId,
          grantId: grant.grantId,
          secondsUsed: Math.max(1, Math.ceil(row.duration_ms / 1000)),
          feature: "podcast",
        })
      : grant.allowance;

    settled = true;

    return { row, audioUrl: await signSegment(row), allowance };
  } catch (error) {
    /*
     * Nothing was spoken, so nothing is charged — but the slice must be closed all the same, or
     * it counts as reserved against the listener until the sweeper eventually clears it.
     */
    if (!settled && grant.grantId) {
      await settleTutorGrant({
        userId: params.userId,
        grantId: grant.grantId,
        secondsUsed: 0,
        feature: "podcast",
      });
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
      text: toSpeechScript(params.text, params.language),
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
    text: toSpeechScript(params.text, params.language),
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
