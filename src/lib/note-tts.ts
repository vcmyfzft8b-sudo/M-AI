import "server-only";

import { createHash } from "node:crypto";

import { SonioxNodeClient, type TranscriptToken } from "@soniox/node";

import { getUserEntitlementState } from "@/lib/billing";
import { STORAGE_BUCKET } from "@/lib/constants";
import type { Json, LectureTtsChunkRow, TtsGenerationEventRow } from "@/lib/database.types";
import { normalizeNoteLanguage } from "@/lib/languages";
import { DEFAULT_NOTE_TTS_VOICE, type NoteTtsVoice } from "@/lib/note-tts-settings";
import type { TtsAlignmentPiece } from "@/lib/note-tts-alignment";
import {
  TtsAudioTruncatedError,
  synthesizeTtsChunkWithTimestamps,
} from "@/lib/note-tts-synthesis";
import {
  NOTE_TTS_CHUNK_PLAN_VERSION,
  stripLeadingRedundantHeading,
  type NoteTtsChunkPlan,
  type NoteTtsWord,
} from "@/lib/note-tts-text";
import { isMissingLectureReferenceError } from "@/lib/postgres-errors";
import { getServerEnv, requireSonioxEnv } from "@/lib/server-env";
import { retryTransientStorageOperation } from "@/lib/storage-download-errors";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

export type TtsAlignmentWord = {
  wordIndex: number;
  startMs: number;
  endMs: number;
};

export type TtsQuotaState = {
  allowed: boolean;
  alreadyConsumed: boolean;
  secondsUsed: number;
  remainingSeconds: number;
  limitSeconds: number;
  chargedSeconds: number;
  code?: string;
};

export type TtsQuotaContext = {
  hasPaidAccess: boolean;
  hasUnlimitedUsage?: boolean;
};

export class TtsQuotaLimitError extends Error {
  constructor(public readonly quota: TtsQuotaState) {
    super("TTS daily generation limit reached.");
    this.name = "TtsQuotaLimitError";
  }
}

export class TtsGenerationPendingError extends Error {
  constructor() {
    super("TTS chunk generation is already in progress.");
    this.name = "TtsGenerationPendingError";
  }
}

// Synthesizing a chunk takes up to a minute, and the reader can delete the note in that time. The
// row then has nothing to hang off and the write fails on the cascade's foreign key — an answer
// ("the note is gone"), not a fault, and the only reason to tell the two apart at the route.
export class LectureRemovedDuringTtsError extends Error {
  constructor() {
    super("The lecture was deleted while its audio was being generated.");
    this.name = "LectureRemovedDuringTtsError";
  }
}

/**
 * One piece of synthesized audio, named exactly enough to be charged for once.
 *
 * `contentHash` and `chunkIndex` are what the two callers differ in: read-aloud names a note's
 * content and the chunk of it being spoken, and a podcast names the episode and the turn. The
 * quota ledger does not care which — it only has to be able to tell two pieces apart.
 */
export type TtsGenerationIdentity = {
  userId: string;
  lectureId: string;
  contentHash: string;
  chunkIndex: number;
  language: string;
  voice: NoteTtsVoice;
  model: string;
};

type ReservedTtsGenerationQuota = {
  eventId: string;
  userId: string;
  usageDate: string;
  reservedSeconds: number;
  quota: TtsQuotaState;
};

type TtsGenerationReservationResult = {
  eventId: string | null;
  quota: TtsQuotaState;
  usageDate?: string;
  reservedSeconds?: number;
};

export const FREE_TTS_DAILY_LIMIT_SECONDS = 5 * 60;
export const PAID_TTS_DAILY_LIMIT_SECONDS = 60 * 60;
export const UNLIMITED_TTS_USAGE_SECONDS = Number.MAX_SAFE_INTEGER;

const UNLIMITED_TTS_USAGE_EMAILS = new Set(["nace.valencic@gmail.com"]);

export const TTS_OUTPUT_FORMAT = "mp3";
export const TTS_OUTPUT_MIME_TYPE = "audio/mpeg";
export const TTS_OUTPUT_BITRATE = 64_000;
// On the REST fallback the alignment transcription is the long pole, and it is not the only thing
// that has to fit inside the calling route's maxDuration: synthesis runs before it, and the
// storage upload, row insert and quota finalization run after it. This must therefore stay
// comfortably below the smallest maxDuration that reaches here — see the note on the read-aloud
// chunk route, which was raised to 300s precisely so a slow transcription still lands inside its
// invocation instead of being killed partway through.
const TTS_WAIT_TIMEOUT_MS = 120_000;
// The WebSocket synthesis runs a little faster than real time and a chunk is about a minute, so
// this only trips when the stream has stalled. Soniox itself stops at three minutes of audio.
const TTS_STREAM_TIMEOUT_MS = 120_000;
// Everything one chunk's synthesis may take — the stream attempt and, after it fails, the REST
// fallback with its transcription — shares this budget, sized under the 300s the chunk route
// allows with room for the upload, row and quota work that follow. A stream that used its whole
// timeout leaves the fallback the remainder; too little remainder and the failure is reported
// instead, because an invocation Vercel kills runs no catch block and the quota reservation
// would stay held for ten minutes.
const TTS_GENERATION_BUDGET_MS = 250_000;
const TTS_FALLBACK_MIN_BUDGET_MS = 70_000;
const TTS_FALLBACK_SYNTHESIS_RESERVE_MS = 40_000;
const TTS_WAIT_INTERVAL_MS = 2_000;
const TTS_CACHE_WAIT_TIMEOUT_MS = 24_000;
const TTS_GENERATION_RESERVATION_STALE_MS = 10 * 60 * 1000;

let sonioxClient: SonioxNodeClient | undefined;

function getSonioxClient() {
  if (!sonioxClient) {
    const env = requireSonioxEnv();
    sonioxClient = new SonioxNodeClient({
      api_key: env.SONIOX_API_KEY,
    });
  }

  return sonioxClient;
}

function wait(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function isTtsProviderRateLimitError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const statusCode =
    "statusCode" in error && typeof error.statusCode === "number"
      ? error.statusCode
      : undefined;
  const message = error instanceof Error ? error.message : "";

  const code = "code" in error && typeof error.code === "string" ? error.code : undefined;

  return (
    statusCode === 429 ||
    code === "quota_exceeded" ||
    message.includes("HTTP 429") ||
    message.includes("rate limit") ||
    message.includes("Concurrent requests limit")
  );
}

export function getTtsDailyLimitSeconds(hasPaidAccess: boolean) {
  return hasPaidAccess ? PAID_TTS_DAILY_LIMIT_SECONDS : FREE_TTS_DAILY_LIMIT_SECONDS;
}

export function hasUnlimitedTtsUsage(email?: string | null) {
  return email ? UNLIMITED_TTS_USAGE_EMAILS.has(email.trim().toLowerCase()) : false;
}

export function getLjubljanaUsageDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Ljubljana",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";

  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function hashNoteTtsContent(content: string) {
  return createHash("sha256")
    .update(`note-tts-v8-speakable-math:${NOTE_TTS_CHUNK_PLAN_VERSION}:${content}`)
    .digest("hex");
}

export function safeStorageSegment(value: string) {
  return value.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "") || "default";
}

function buildTtsStoragePath(params: {
  userId: string;
  lectureId: string;
  contentHash: string;
  chunkIndex: number;
  model: string;
  voice: string;
}) {
  return [
    "tts",
    params.userId,
    params.lectureId,
    params.contentHash,
    `${String(params.chunkIndex).padStart(4, "0")}-${safeStorageSegment(params.model)}-${safeStorageSegment(params.voice)}.mp3`,
  ].join("/");
}

function normalizeAlignmentText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{Mark}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

type TtsAlignmentToken = TtsAlignmentPiece & Partial<Pick<TranscriptToken, "is_audio_event">>;

function collectTranscriptPieces(tokens: TtsAlignmentToken[]) {
  return tokens
    .map((token, index) => ({
      index,
      text: normalizeAlignmentText(token.text),
      startMs: token.start_ms,
      endMs: token.end_ms,
    }))
    .filter((token) => token.text.length > 0 && !tokens[token.index]?.is_audio_event);
}

function interpolateMissingTimings(params: {
  timings: Array<TtsAlignmentWord | null>;
  wordStartIndex: number;
  durationMs: number;
}) {
  const timings = [...params.timings];
  const durationMs = Math.max(params.durationMs, timings.length * 250, 1);

  for (let index = 0; index < timings.length; index += 1) {
    if (timings[index]) {
      continue;
    }

    const previousIndex = (() => {
      for (let candidate = index - 1; candidate >= 0; candidate -= 1) {
        if (timings[candidate]) {
          return candidate;
        }
      }

      return -1;
    })();
    const nextIndex = (() => {
      for (let candidate = index + 1; candidate < timings.length; candidate += 1) {
        if (timings[candidate]) {
          return candidate;
        }
      }

      return timings.length;
    })();
    const previousEnd = previousIndex >= 0 ? timings[previousIndex]?.endMs ?? 0 : 0;
    const nextStart =
      nextIndex < timings.length ? timings[nextIndex]?.startMs ?? durationMs : durationMs;
    const missingCount = nextIndex - previousIndex - 1;
    const sliceMs = Math.max(80, (nextStart - previousEnd) / Math.max(missingCount, 1));
    const offset = index - previousIndex - 1;
    const startMs = Math.max(0, Math.round(previousEnd + sliceMs * offset));
    const endMs = Math.min(durationMs, Math.max(startMs + 80, Math.round(startMs + sliceMs)));

    timings[index] = {
      wordIndex: params.wordStartIndex + index,
      startMs,
      endMs,
    };
  }

  return timings.filter((timing): timing is TtsAlignmentWord => Boolean(timing));
}

export function alignTtsTokensToWords(params: {
  words: NoteTtsWord[];
  tokens: TtsAlignmentToken[];
  wordStartIndex: number;
  durationMs: number;
}) {
  const transcriptPieces = collectTranscriptPieces(params.tokens);
  const timings: Array<TtsAlignmentWord | null> = Array.from({ length: params.words.length }, () => null);
  let tokenIndex = 0;

  for (const [wordOffset, word] of params.words.entries()) {
    const target = normalizeAlignmentText(word.text);

    if (!target) {
      continue;
    }

    let bestMatch:
      | {
          startPieceIndex: number;
          endPieceIndex: number;
        }
      | null = null;

    for (
      let candidateStart = tokenIndex;
      candidateStart < Math.min(transcriptPieces.length, tokenIndex + 8);
      candidateStart += 1
    ) {
      let accumulated = "";

      for (
        let candidateEnd = candidateStart;
        candidateEnd < Math.min(transcriptPieces.length, candidateStart + 8);
        candidateEnd += 1
      ) {
        accumulated += transcriptPieces[candidateEnd].text;

        if (accumulated === target || accumulated.includes(target) || target.includes(accumulated)) {
          bestMatch = {
            startPieceIndex: candidateStart,
            endPieceIndex: candidateEnd,
          };

          if (accumulated === target) {
            break;
          }
        }

        if (accumulated.length > target.length + 8) {
          break;
        }
      }

      if (bestMatch) {
        break;
      }
    }

    if (!bestMatch) {
      continue;
    }

    const startPiece = transcriptPieces[bestMatch.startPieceIndex];
    const endPiece = transcriptPieces[bestMatch.endPieceIndex];
    timings[wordOffset] = {
      wordIndex: word.index,
      startMs: Math.max(0, Math.round(startPiece.startMs)),
      endMs: Math.max(startPiece.startMs + 80, Math.round(endPiece.endMs)),
    };
    tokenIndex = bestMatch.endPieceIndex + 1;
  }

  return interpolateMissingTimings({
    timings,
    wordStartIndex: params.wordStartIndex,
    durationMs: params.durationMs,
  });
}

export async function getTtsUsageState(params: {
  userId: string;
  hasPaidAccess: boolean;
  hasUnlimitedUsage?: boolean;
}) {
  if (params.hasUnlimitedUsage) {
    return {
      usageDate: getLjubljanaUsageDate(),
      secondsUsed: 0,
      limitSeconds: UNLIMITED_TTS_USAGE_SECONDS,
      remainingSeconds: UNLIMITED_TTS_USAGE_SECONDS,
      hasUnlimitedUsage: true,
    };
  }

  const limitSeconds = getTtsDailyLimitSeconds(params.hasPaidAccess);
  const usageDate = getLjubljanaUsageDate();
  const { data } = await createSupabaseServiceRoleClient()
    .from("tts_daily_usage")
    .select("seconds_used, limit_seconds")
    .eq("user_id", params.userId)
    .eq("usage_date", usageDate)
    .maybeSingle();
  const usage = data as { seconds_used: number; limit_seconds: number } | null;
  const secondsUsed = usage?.seconds_used ?? 0;

  return {
    usageDate,
    secondsUsed,
    limitSeconds,
    remainingSeconds: Math.max(limitSeconds - secondsUsed, 0),
    hasUnlimitedUsage: false,
  };
}

function isUniqueConstraintError(error: { code?: string } | null) {
  return error?.code === "23505";
}

export async function getTtsQuotaContext(params: {
  userId: string;
}): Promise<TtsQuotaContext> {
  const entitlement = await getUserEntitlementState(params.userId);

  return {
    hasPaidAccess: entitlement.hasPaidAccess,
    hasUnlimitedUsage: hasUnlimitedTtsUsage(entitlement.profile?.email),
  };
}

async function readTtsUsageRow(params: { userId: string; usageDate: string }) {
  const { data, error } = await createSupabaseServiceRoleClient()
    .from("tts_daily_usage")
    .select("seconds_used, limit_seconds")
    .eq("user_id", params.userId)
    .eq("usage_date", params.usageDate)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data as { seconds_used: number; limit_seconds: number } | null;
}

async function ensureTtsUsageRow(params: {
  userId: string;
  usageDate: string;
  limitSeconds: number;
}) {
  const { error } = await createSupabaseServiceRoleClient()
    .from("tts_daily_usage")
    .upsert(
      {
        user_id: params.userId,
        usage_date: params.usageDate,
        seconds_used: 0,
        limit_seconds: params.limitSeconds,
      } as never,
      { onConflict: "user_id,usage_date", ignoreDuplicates: true },
    );

  if (error) {
    throw error;
  }
}

function buildQuotaState(params: {
  allowed: boolean;
  alreadyConsumed?: boolean;
  secondsUsed: number;
  limitSeconds: number;
  chargedSeconds?: number;
  code?: string;
}): TtsQuotaState {
  return {
    allowed: params.allowed,
    alreadyConsumed: params.alreadyConsumed ?? false,
    secondsUsed: params.secondsUsed,
    remainingSeconds: Math.max(params.limitSeconds - params.secondsUsed, 0),
    limitSeconds: params.limitSeconds,
    chargedSeconds: params.chargedSeconds ?? 0,
    code: params.code,
  };
}

async function getExistingTtsGenerationEvent(identity: TtsGenerationIdentity) {
  const { data, error } = await createSupabaseServiceRoleClient()
    .from("tts_generation_events")
    .select("*")
    .eq("user_id", identity.userId)
    .eq("lecture_id", identity.lectureId)
    .eq("content_hash", identity.contentHash)
    .eq("chunk_index", identity.chunkIndex)
    .eq("language", identity.language)
    .eq("voice", identity.voice)
    .eq("model", identity.model)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data as TtsGenerationEventRow | null;
}

function isStaleTtsGenerationReservation(event: TtsGenerationEventRow) {
  return (
    event.status === "reserved" &&
    Date.now() - new Date(event.created_at).getTime() > TTS_GENERATION_RESERVATION_STALE_MS
  );
}

async function insertTtsGenerationReservation(params: {
  identity: TtsGenerationIdentity;
  usageDate: string;
  reservedSeconds: number;
}) {
  const { data, error } = await createSupabaseServiceRoleClient()
    .from("tts_generation_events")
    .insert(
      {
        user_id: params.identity.userId,
        lecture_id: params.identity.lectureId,
        content_hash: params.identity.contentHash,
        chunk_index: params.identity.chunkIndex,
        language: params.identity.language,
        voice: params.identity.voice,
        model: params.identity.model,
        usage_date: params.usageDate,
        reserved_seconds: params.reservedSeconds,
        charged_seconds: 0,
        status: "reserved",
      } as never,
    )
    .select("id")
    .single();

  if (isUniqueConstraintError(error)) {
    return null;
  }

  if (error) {
    throw error;
  }

  return (data as { id: string }).id;
}

async function adjustTtsDailyUsage(params: {
  userId: string;
  usageDate: string;
  limitSeconds: number;
  deltaSeconds: number;
}) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const usage = await readTtsUsageRow({
      userId: params.userId,
      usageDate: params.usageDate,
    });
    const secondsUsed = usage?.seconds_used ?? 0;
    const nextSecondsUsed = Math.max(0, secondsUsed + params.deltaSeconds);

    const { data, error } = await createSupabaseServiceRoleClient()
      .from("tts_daily_usage")
      .update(
        {
          seconds_used: nextSecondsUsed,
          limit_seconds: params.limitSeconds,
        } as never,
      )
      .eq("user_id", params.userId)
      .eq("usage_date", params.usageDate)
      .eq("seconds_used", secondsUsed)
      .select("seconds_used, limit_seconds")
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!data) {
      continue;
    }

    return data as { seconds_used: number; limit_seconds: number };
  }

  throw new Error("Could not update TTS usage after concurrent updates.");
}

async function reserveTtsGenerationQuota(params: {
  identity: TtsGenerationIdentity;
  estimatedSeconds: number;
  quotaContext: TtsQuotaContext;
}): Promise<TtsGenerationReservationResult> {
  if (params.quotaContext.hasUnlimitedUsage) {
    return {
      eventId: null,
      quota: buildQuotaState({
        allowed: true,
        secondsUsed: 0,
        limitSeconds: UNLIMITED_TTS_USAGE_SECONDS,
        chargedSeconds: 0,
      }),
    };
  }

  const limitSeconds = getTtsDailyLimitSeconds(params.quotaContext.hasPaidAccess);
  const usageDate = getLjubljanaUsageDate();
  const reservedSeconds = Math.max(1, Math.ceil(params.estimatedSeconds));

  await ensureTtsUsageRow({
    userId: params.identity.userId,
    usageDate,
    limitSeconds,
  });

  const reservationId = await insertTtsGenerationReservation({
    identity: params.identity,
    usageDate,
    reservedSeconds,
  });

  if (!reservationId) {
    const existingEvent = await getExistingTtsGenerationEvent(params.identity);

    if (existingEvent && isStaleTtsGenerationReservation(existingEvent)) {
      await releaseTtsGenerationReservation({
        eventId: existingEvent.id,
        userId: params.identity.userId,
        usageDate: existingEvent.usage_date,
        limitSeconds,
        reservedSeconds: existingEvent.reserved_seconds,
      });

      return reserveTtsGenerationQuota(params);
    }

    const usage = await getTtsUsageState({
      userId: params.identity.userId,
      hasPaidAccess: params.quotaContext.hasPaidAccess,
    });

    return {
      eventId: null,
      quota: buildQuotaState({
        allowed: true,
        alreadyConsumed: true,
        secondsUsed: usage.secondsUsed,
        limitSeconds: usage.limitSeconds,
        chargedSeconds: 0,
      }),
    };
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const usage = await readTtsUsageRow({
      userId: params.identity.userId,
      usageDate,
    });
    const secondsUsed = usage?.seconds_used ?? 0;
    const nextSecondsUsed = secondsUsed + reservedSeconds;

    if (nextSecondsUsed > limitSeconds) {
      await releaseTtsGenerationReservation({
        eventId: reservationId,
        userId: params.identity.userId,
        usageDate,
        limitSeconds,
        reservedSeconds: 0,
      });

      return {
        eventId: null,
        quota: buildQuotaState({
          allowed: false,
          secondsUsed,
          limitSeconds,
          code: "tts_daily_limit_reached",
        }),
      };
    }

    const { data, error } = await createSupabaseServiceRoleClient()
      .from("tts_daily_usage")
      .update(
        {
          seconds_used: nextSecondsUsed,
          limit_seconds: limitSeconds,
        } as never,
      )
      .eq("user_id", params.identity.userId)
      .eq("usage_date", usageDate)
      .eq("seconds_used", secondsUsed)
      .select("seconds_used, limit_seconds")
      .maybeSingle();

    if (error) {
      await releaseTtsGenerationReservation({
        eventId: reservationId,
        userId: params.identity.userId,
        usageDate,
        limitSeconds,
        reservedSeconds: 0,
      });
      throw error;
    }

    if (!data) {
      continue;
    }

    const updatedUsage = data as { seconds_used: number; limit_seconds: number };

    return {
      eventId: reservationId,
      quota: buildQuotaState({
        allowed: true,
        secondsUsed: updatedUsage.seconds_used,
        limitSeconds: updatedUsage.limit_seconds,
        chargedSeconds: reservedSeconds,
      }),
      usageDate,
      reservedSeconds,
    };
  }

  await releaseTtsGenerationReservation({
    eventId: reservationId,
    userId: params.identity.userId,
    usageDate,
    limitSeconds,
    reservedSeconds: 0,
  });
  throw new Error("Could not reserve TTS generation quota after concurrent updates.");
}

async function finalizeTtsGenerationQuota(params: {
  reservation: ReservedTtsGenerationQuota | null;
  actualSeconds: number;
}) {
  if (!params.reservation) {
    return null;
  }

  const chargedSeconds = Math.max(1, Math.ceil(params.actualSeconds));
  const deltaSeconds = chargedSeconds - params.reservation.reservedSeconds;
  const updatedUsage =
    deltaSeconds === 0
      ? {
          seconds_used: params.reservation.quota.secondsUsed,
          limit_seconds: params.reservation.quota.limitSeconds,
        }
      : await adjustTtsDailyUsage({
          userId: params.reservation.userId,
          usageDate: params.reservation.usageDate,
          limitSeconds: params.reservation.quota.limitSeconds,
          deltaSeconds,
        });

  const { error } = await createSupabaseServiceRoleClient()
    .from("tts_generation_events")
    .update(
      {
        charged_seconds: chargedSeconds,
        status: "charged",
      } as never,
    )
    .eq("id", params.reservation.eventId);

  if (error) {
    throw error;
  }

  return buildQuotaState({
    allowed: true,
    secondsUsed: updatedUsage.seconds_used,
    limitSeconds: updatedUsage.limit_seconds,
    chargedSeconds,
  });
}

async function releaseTtsGenerationReservation(params: {
  eventId: string;
  userId: string;
  usageDate: string;
  limitSeconds: number;
  reservedSeconds: number;
}) {
  const { error } = await createSupabaseServiceRoleClient()
    .from("tts_generation_events")
    .delete()
    .eq("id", params.eventId);

  if (error) {
    throw error;
  }

  if (params.reservedSeconds > 0) {
    await adjustTtsDailyUsage({
      userId: params.userId,
      usageDate: params.usageDate,
      limitSeconds: params.limitSeconds,
      deltaSeconds: -params.reservedSeconds,
    });
  }
}

function parseStoredAlignment(value: unknown): TtsAlignmentWord[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }

    const record = item as Record<string, unknown>;
    const wordIndex = record.wordIndex;
    const startMs = record.startMs;
    const endMs = record.endMs;

    if (
      typeof wordIndex !== "number" ||
      typeof startMs !== "number" ||
      typeof endMs !== "number"
    ) {
      return [];
    }

    return [{ wordIndex, startMs, endMs }];
  });
}

async function getCachedTtsChunkRow(params: TtsGenerationIdentity) {
  const { data, error } = await createSupabaseServiceRoleClient()
    .from("lecture_tts_chunks")
    .select("*")
    .eq("lecture_id", params.lectureId)
    .eq("content_hash", params.contentHash)
    .eq("chunk_index", params.chunkIndex)
    .eq("language", params.language)
    .eq("voice", params.voice)
    .eq("model", params.model)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data as LectureTtsChunkRow | null;
}

// Signing is the last thing every path here does, including the one that has already synthesized,
// uploaded and charged the audio — so a storage fault this late threw away roughly two minutes of
// finished work and answered the reader with a 500, for a call that only reads object metadata.
// Production saw Supabase answer it with a bare 520 (StorageApiError, empty message). Repeating a
// signed-URL read changes nothing, so retry it before giving up.
async function signTtsChunk(row: LectureTtsChunkRow) {
  const { data: signedUrl, error: signedUrlError } = await retryTransientStorageOperation(() =>
    createSupabaseServiceRoleClient()
      .storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(row.audio_storage_path, 10 * 60),
  );

  if (signedUrlError || !signedUrl?.signedUrl) {
    throw signedUrlError ?? new Error("Could not create a signed TTS audio URL.");
  }

  return {
    row,
    audioUrl: signedUrl.signedUrl,
    alignment: parseStoredAlignment(row.alignment_json),
  };
}

async function waitForCachedTtsChunkRow(params: TtsGenerationIdentity) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < TTS_CACHE_WAIT_TIMEOUT_MS) {
    const cached = await getCachedTtsChunkRow(params);

    if (cached) {
      return cached;
    }

    await wait(1_500);
  }

  return null;
}

async function transcribeGeneratedAudio(params: {
  audio: Uint8Array;
  language: string;
  clientReferenceId: string;
  timeoutMs?: number;
}) {
  const env = getServerEnv();
  const transcription = await getSonioxClient().stt.transcribe({
    model: env.SONIOX_MODEL,
    file: params.audio,
    filename: "note-read-aloud.mp3",
    language_hints: [params.language],
    language_hints_strict: true,
    wait: true,
    wait_options: {
      interval_ms: TTS_WAIT_INTERVAL_MS,
      timeout_ms: Math.min(TTS_WAIT_TIMEOUT_MS, params.timeoutMs ?? TTS_WAIT_TIMEOUT_MS),
    },
    client_reference_id: params.clientReferenceId,
    cleanup: ["file", "transcription"],
  });

  if (transcription.status !== "completed") {
    throw new Error(
      transcription.error_message ||
        `Soniox alignment transcription failed with status ${transcription.status}.`,
    );
  }

  return transcription.transcript ?? (await transcription.getTranscript());
}

// The WebSocket returns the timing of every character it spoke, which is the alignment the
// highlight wants: exact, and free of the transcription pass that used to add several seconds and
// a second bill per chunk. The REST path stays as the fallback for a stream that fails for a
// reason retrying will not fix — but not for the organization's concurrent-stream cap, which the
// caller retries, and not for a truncation, which REST would repeat silently.
async function synthesizeAlignedTtsChunk(params: {
  text: string;
  chunkWords: NoteTtsWord[];
  wordStartIndex: number;
  estimatedSeconds: number;
  language: string;
  voice: NoteTtsVoice;
  clientReferenceId: string;
}) {
  const env = getServerEnv();
  const client = getSonioxClient();
  const startedAt = Date.now();
  const remainingBudgetMs = () => TTS_GENERATION_BUDGET_MS - (Date.now() - startedAt);

  try {
    const synthesized = await synthesizeTtsChunkWithTimestamps({
      client,
      text: params.text,
      model: env.SONIOX_TTS_MODEL,
      voice: params.voice,
      language: params.language,
      audioFormat: TTS_OUTPUT_FORMAT,
      bitrate: TTS_OUTPUT_BITRATE,
      timeoutMs: Math.min(TTS_STREAM_TIMEOUT_MS, TTS_GENERATION_BUDGET_MS),
    });

    if (synthesized.pieces.length > 0) {
      return {
        audio: synthesized.audio,
        durationMs: synthesized.durationMs,
        alignment: alignTtsTokensToWords({
          words: params.chunkWords,
          tokens: synthesized.pieces,
          wordStartIndex: params.wordStartIndex,
          durationMs: synthesized.durationMs,
        }),
      };
    }

    console.warn("Soniox TTS stream returned no timestamps; aligning by transcription", {
      clientReferenceId: params.clientReferenceId,
    });
  } catch (error) {
    if (
      isTtsProviderRateLimitError(error) ||
      error instanceof TtsAudioTruncatedError ||
      remainingBudgetMs() < TTS_FALLBACK_MIN_BUDGET_MS
    ) {
      throw error;
    }

    console.warn("Soniox TTS stream failed; falling back to REST synthesis", {
      clientReferenceId: params.clientReferenceId,
      error,
    });
  }

  const audio = await client.tts.generate({
    text: params.text,
    model: env.SONIOX_TTS_MODEL,
    voice: params.voice,
    language: params.language,
    audio_format: TTS_OUTPUT_FORMAT,
    bitrate: TTS_OUTPUT_BITRATE,
  });
  const transcript = await transcribeGeneratedAudio({
    audio,
    language: params.language,
    clientReferenceId: params.clientReferenceId,
    timeoutMs: Math.max(30_000, remainingBudgetMs() - TTS_FALLBACK_SYNTHESIS_RESERVE_MS),
  });
  // The SDK types a token's times as optional; a token without them cannot place a word, so it
  // is dropped rather than pinned to zero.
  const tokens: TtsAlignmentToken[] = (transcript?.tokens ?? []).flatMap((token) =>
    typeof token.start_ms === "number" && typeof token.end_ms === "number"
      ? [
          {
            text: token.text,
            start_ms: token.start_ms,
            end_ms: token.end_ms,
            is_audio_event: token.is_audio_event,
          },
        ]
      : [],
  );
  const durationMs = Math.max(
    tokens.reduce((max, token) => Math.max(max, token.end_ms), 0),
    params.estimatedSeconds * 1000,
  );

  return {
    audio,
    durationMs,
    alignment: alignTtsTokensToWords({
      words: params.chunkWords,
      tokens,
      wordStartIndex: params.wordStartIndex,
      durationMs,
    }),
  };
}

async function generateTtsChunk(params: {
  userId: string;
  lectureId: string;
  contentHash: string;
  chunk: NoteTtsChunkPlan;
  chunkWords: NoteTtsWord[];
  language: string;
  voice: NoteTtsVoice;
}) {
  const env = getServerEnv();
  const { audio, durationMs, alignment } = await synthesizeAlignedTtsChunk({
    text: params.chunk.text,
    chunkWords: params.chunkWords,
    wordStartIndex: params.chunk.wordStartIndex,
    estimatedSeconds: params.chunk.estimatedSeconds,
    language: params.language,
    voice: params.voice,
    clientReferenceId: `${params.lectureId}:${params.contentHash}:${params.chunk.chunkIndex}`,
  });
  const audioStoragePath = buildTtsStoragePath({
    userId: params.userId,
    lectureId: params.lectureId,
    contentHash: params.contentHash,
    chunkIndex: params.chunk.chunkIndex,
    model: env.SONIOX_TTS_MODEL,
    voice: params.voice,
  });
  const service = createSupabaseServiceRoleClient();
  // Same storage fault, one step earlier: here it costs the whole synthesis, because the caller
  // releases the quota reservation and the reader has to pay for the generation again. The upload
  // upserts a path derived from the content hash, so repeating it is safe.
  const { error: uploadError } = await retryTransientStorageOperation(() =>
    service.storage.from(STORAGE_BUCKET).upload(audioStoragePath, Buffer.from(audio), {
      contentType: TTS_OUTPUT_MIME_TYPE,
      upsert: true,
    }),
  );

  if (uploadError) {
    throw uploadError;
  }

  const { data, error } = await service
    .from("lecture_tts_chunks")
    .upsert(
      {
        lecture_id: params.lectureId,
        content_hash: params.contentHash,
        chunk_index: params.chunk.chunkIndex,
        text: params.chunk.text,
        word_start_index: params.chunk.wordStartIndex,
        word_end_index: params.chunk.wordEndIndex,
        language: params.language,
        voice: params.voice,
        model: env.SONIOX_TTS_MODEL,
        audio_storage_path: audioStoragePath,
        audio_mime_type: TTS_OUTPUT_MIME_TYPE,
        duration_ms: Math.ceil(durationMs),
        alignment_json: alignment as unknown as Json,
      } as never,
      {
        onConflict: "lecture_id,content_hash,chunk_index,language,voice,model",
      },
    )
    .select("*")
    .single();

  if (error) {
    if (isMissingLectureReferenceError(error)) {
      // The note was deleted mid-generation. Its own delete removed the audio it knew about, which
      // could not include this object — it lands seconds later — so clear it here rather than
      // leaving a deleted note's audio in the bucket.
      await service.storage.from(STORAGE_BUCKET).remove([audioStoragePath]);

      throw new LectureRemovedDuringTtsError();
    }

    throw error;
  }

  return data as LectureTtsChunkRow;
}

/**
 * Claims the right to synthesize one piece of audio, and holds the quota it will cost.
 *
 * Two callers need this and neither of them should own it: the read-aloud chunk below, and one
 * turn of a generated podcast. What it does is not about either — it is the ledger that stops the
 * same second of audio being paid for twice, whether "twice" means two tabs, a double tap or a
 * client that retried a request that had in fact succeeded.
 *
 * `claimed: false` is not a failure. It means somebody else is already synthesizing exactly this,
 * and the right move is to wait for their audio rather than to make a second copy of it.
 */
export async function claimTtsGeneration(params: {
  identity: TtsGenerationIdentity;
  estimatedSeconds: number;
  quotaContext: TtsQuotaContext;
}) {
  const result = await reserveTtsGenerationQuota(params);

  if (!result.quota.allowed) {
    throw new TtsQuotaLimitError(result.quota);
  }

  if (!result.eventId) {
    /*
     * An account with no ceiling never takes a reservation at all, so there is nothing to hold
     * and nothing to wait for — it simply generates. Everybody else without an event id lost the
     * race for it.
     */
    return {
      claimed: params.quotaContext.hasUnlimitedUsage,
      reservation: null,
      quota: result.quota,
    };
  }

  if (result.usageDate === undefined || result.reservedSeconds === undefined) {
    throw new Error("TTS generation reservation is missing quota metadata.");
  }

  return {
    claimed: true,
    reservation: {
      eventId: result.eventId,
      userId: params.identity.userId,
      usageDate: result.usageDate,
      reservedSeconds: result.reservedSeconds,
      quota: result.quota,
    } satisfies ReservedTtsGenerationQuota,
    quota: result.quota,
  };
}

/** Charges what the audio actually came to, once it exists. */
export async function settleTtsGeneration(params: {
  reservation: ReservedTtsGenerationQuota | null;
  fallbackQuota: TtsQuotaState;
  actualSeconds: number;
}) {
  return (
    (await finalizeTtsGenerationQuota({
      reservation: params.reservation,
      actualSeconds: params.actualSeconds,
    })) ?? params.fallbackQuota
  );
}

/**
 * Gives the reservation back after a generation that produced nothing.
 *
 * Must run on every failing path that had claimed one: an invocation Vercel kills runs no catch
 * block, and a reservation nobody releases holds the listener's allowance for the ten minutes it
 * takes to go stale.
 */
export async function abandonTtsGeneration(reservation: ReservedTtsGenerationQuota | null) {
  if (!reservation) {
    return;
  }

  await releaseTtsGenerationReservation({
    eventId: reservation.eventId,
    userId: reservation.userId,
    usageDate: reservation.usageDate,
    limitSeconds: reservation.quota.limitSeconds,
    reservedSeconds: reservation.reservedSeconds,
  });
}

export async function getOrCreateTtsChunk(params: {
  userId: string;
  lectureId: string;
  contentHash: string;
  chunk: NoteTtsChunkPlan;
  allWords: NoteTtsWord[];
  languageHint: string | null;
  voice?: NoteTtsVoice;
  quotaContext: TtsQuotaContext;
}) {
  const env = getServerEnv();
  const language = normalizeNoteLanguage(params.languageHint);
  const voice = params.voice ?? DEFAULT_NOTE_TTS_VOICE;
  const identity: TtsGenerationIdentity = {
    userId: params.userId,
    lectureId: params.lectureId,
    contentHash: params.contentHash,
    chunkIndex: params.chunk.chunkIndex,
    language,
    voice,
    model: env.SONIOX_TTS_MODEL,
  };
  const cached = await getCachedTtsChunkRow(identity);
  const usage = await getTtsUsageState({
    userId: params.userId,
    hasPaidAccess: params.quotaContext.hasPaidAccess,
    hasUnlimitedUsage: params.quotaContext.hasUnlimitedUsage,
  });

  if (cached) {
    return {
      ...(await signTtsChunk(cached)),
      quota: buildQuotaState({
        allowed: true,
        alreadyConsumed: true,
        secondsUsed: usage.secondsUsed,
        limitSeconds: usage.limitSeconds,
        chargedSeconds: 0,
      }),
    };
  }

  const claim = await claimTtsGeneration({
    identity,
    estimatedSeconds: params.chunk.estimatedSeconds,
    quotaContext: params.quotaContext,
  });

  if (!claim.claimed) {
    const generatedByConcurrentRequest = await waitForCachedTtsChunkRow(identity);

    if (!generatedByConcurrentRequest) {
      throw new TtsGenerationPendingError();
    }

    return {
      ...(await signTtsChunk(generatedByConcurrentRequest)),
      quota: claim.quota,
    };
  }

  const reservation = claim.reservation;
  let shouldReleaseReservation = Boolean(reservation);

  try {
    const row = await generateTtsChunk({
      userId: params.userId,
      lectureId: params.lectureId,
      contentHash: params.contentHash,
      chunk: params.chunk,
      chunkWords: params.allWords.slice(params.chunk.wordStartIndex, params.chunk.wordEndIndex),
      language,
      voice,
    });

    shouldReleaseReservation = false;

    const finalizedQuota = await settleTtsGeneration({
      reservation,
      fallbackQuota: claim.quota,
      actualSeconds: Math.max(1, Math.ceil(row.duration_ms / 1000)),
    });

    return {
      ...(await signTtsChunk(row)),
      quota: finalizedQuota,
    };
  } catch (error) {
    if (shouldReleaseReservation) {
      await abandonTtsGeneration(reservation);
    }

    throw error;
  }
}

// How many chunks from the start of the note are already synthesized for this voice. The note
// page warms that many (at most two) the moment it opens, so a note listened to before starts on
// the click rather than after a round trip — without ever generating anything, and so without
// spending any of the daily allowance, on a note nobody has asked to hear.
export async function getReadyLeadingTtsChunkCount(params: {
  lectureId: string;
  content: string;
  title?: string | null;
  languageHint: string | null;
  voice?: NoteTtsVoice;
  limit?: number;
}) {
  const content = stripLeadingRedundantHeading(params.content, params.title).trim();

  if (!content) {
    return 0;
  }

  const env = getServerEnv();
  const limit = Math.max(1, params.limit ?? 2);
  const { data, error } = await createSupabaseServiceRoleClient()
    .from("lecture_tts_chunks")
    .select("chunk_index")
    .eq("lecture_id", params.lectureId)
    .eq("content_hash", hashNoteTtsContent(content))
    .eq("language", normalizeNoteLanguage(params.languageHint))
    .eq("voice", params.voice ?? DEFAULT_NOTE_TTS_VOICE)
    .eq("model", env.SONIOX_TTS_MODEL)
    .lt("chunk_index", limit);

  if (error) {
    throw error;
  }

  const ready = new Set((data as Array<{ chunk_index: number }>).map((row) => row.chunk_index));
  let count = 0;

  while (count < limit && ready.has(count)) {
    count += 1;
  }

  return count;
}

