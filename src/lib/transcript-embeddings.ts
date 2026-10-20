import "server-only";

import { isWorkAbortedError } from "@/lib/abort-context";
import { createEmbeddings } from "@/lib/ai/embeddings";
import { mapWithConcurrency } from "@/lib/concurrency";
import { captureBackgroundError } from "@/lib/monitoring";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { serializeVector } from "@/lib/utils";

/**
 * A transcript's search embeddings are made when it is saved and used for one thing only: finding
 * the passages a chat answer quotes. `match_transcript_segments` already skips a row whose
 * embedding is null, and both chats answer from the note alone when retrieval finds nothing.
 *
 * So an embedding is never worth a note. On 2026-10-20 Google's spend cap refused every
 * embedding call for 35 minutes and every new note failed on it — text ones too, where nothing
 * else needed Google at all. Now a transcript is saved with whatever embeddings could be made and
 * nulls for the rest, and `backfillTranscriptEmbeddings` fills the nulls in once Gemini answers:
 * on the note's first chat question, and hourly from the stall sweep.
 */

const EMBEDDING_BATCH_SIZE = 100;
const EMBEDDING_DIMENSION = 1536;
/** Row updates in flight at once while backfilling; each is one small PATCH. */
const BACKFILL_UPDATE_CONCURRENCY = 8;

/**
 * A row with something to embed (a POSIX class, as Postgres' `~` reads it). A blank segment has
 * nothing to search for and can make Google refuse the whole batch it is in; left as a candidate,
 * it would also keep the sweep asking Gemini every hour for a row it will never embed.
 */
export const HAS_TEXT_PATTERN = "[^[:space:]]";

function isUsableEmbedding(values: number[] | null | undefined): values is number[] {
  return Array.isArray(values) && values.length === EMBEDDING_DIMENSION;
}

/**
 * One embedding per text, in order, with null wherever none could be made.
 *
 * Only a budget abort is rethrown: that is the invocation ending, and the pipeline has to see it
 * as one. Anything else — the spend cap, a provider outage that outlasted the retries — costs the
 * rows from the failing batch on, never the note. It is still reported, because a note saved
 * without search is a degraded note, and the spend cap in particular must not go quiet just
 * because nothing fails on it any more.
 */
export async function embedTranscriptTexts(params: {
  texts: string[];
  lectureId: string;
}): Promise<Array<number[] | null>> {
  const embeddings: Array<number[] | null> = [];

  for (let start = 0; start < params.texts.length; start += EMBEDDING_BATCH_SIZE) {
    const batch = params.texts.slice(start, start + EMBEDDING_BATCH_SIZE);

    try {
      embeddings.push(...(await createEmbeddings(batch)));
    } catch (error) {
      if (isWorkAbortedError(error)) {
        throw error;
      }

      console.warn("Saving the transcript without search embeddings; they are filled in later", {
        lectureId: params.lectureId,
        embedded: start,
        total: params.texts.length,
        error: error instanceof Error ? error.message : String(error),
      });
      captureBackgroundError(error, {
        operation: "embedTranscriptTexts",
        tags: { lectureId: params.lectureId },
        extra: { embedded: start, total: params.texts.length },
      });
      break;
    }
  }

  return params.texts.map((_, index) => {
    const values = embeddings[index];
    return isUsableEmbedding(values) ? values : null;
  });
}

type MissingEmbeddingRow = { id: string; lecture_id: string; text: string };

/**
 * Gives transcript rows saved without an embedding their embedding.
 *
 * Scoped to one lecture (the chat path) or to everything created since `since` (the sweep), and
 * capped at `maxSegments` per call so neither can turn into a long request. Throws when Gemini
 * refuses — the caller decides what that means — but a row it could not update is left for the
 * next call rather than failing the rest.
 *
 * Each row is updated on its own and only while its embedding is still null. Never as an upsert:
 * a transcript can be deleted and rewritten while this runs (a retried lecture re-transcribes),
 * and an upsert of a row that was just deleted would put the old segment back beside the new
 * ones.
 */
export async function backfillTranscriptEmbeddings(params: {
  lectureId?: string;
  since?: string;
  maxSegments: number;
}): Promise<{ filled: number }> {
  const supabase = createSupabaseServiceRoleClient();
  let query = supabase
    .from("transcript_segments")
    .select("id, lecture_id, text")
    .is("embedding", null)
    .filter("text", "match", HAS_TEXT_PATTERN)
    .order("created_at", { ascending: true })
    .limit(params.maxSegments);

  if (params.lectureId) {
    query = query.eq("lecture_id", params.lectureId);
  }

  if (params.since) {
    query = query.gte("created_at", params.since);
  }

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  const rows = ((data ?? []) as MissingEmbeddingRow[]).filter((row) => row.text.trim().length > 0);
  let filled = 0;

  for (let start = 0; start < rows.length; start += EMBEDDING_BATCH_SIZE) {
    const batch = rows.slice(start, start + EMBEDDING_BATCH_SIZE);
    const embeddings = await createEmbeddings(batch.map((row) => row.text));

    await mapWithConcurrency(
      batch.map((row, index) => ({ row, values: embeddings[index] })),
      BACKFILL_UPDATE_CONCURRENCY,
      async ({ row, values }) => {
        if (!isUsableEmbedding(values)) {
          return;
        }

        const { error: updateError } = await supabase
          .from("transcript_segments")
          .update({ embedding: serializeVector(values) } as never)
          .eq("id", row.id)
          .is("embedding", null);

        if (updateError) {
          console.warn("Could not store a backfilled transcript embedding; the next pass retries it", {
            segmentId: row.id,
            lectureId: row.lecture_id,
            error: updateError.message,
          });
          return;
        }

        filled += 1;
      },
    );
  }

  return { filled };
}
