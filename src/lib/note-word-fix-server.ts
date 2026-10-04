import "server-only";

import type { Json, LectureArtifactRow } from "@/lib/database.types";
import { NOTE_DOC_VERSION, serializeEditableNoteDoc, type EditableNoteDoc } from "@/lib/note-doc";
import { parseStoredNoteDoc } from "@/lib/note-doc-server";
import { parseNoteTtsDocument, stripLeadingRedundantHeading } from "@/lib/note-tts-text";
import {
  remapNoteAnnotations,
  replaceNoteWord,
  replaceNoteWordInJson,
} from "@/lib/note-word-fix";
import { generationCacheKey } from "@/lib/notes/generation-cache-key";
import { hashPodcastSource } from "@/lib/podcast";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { hashNotesContent } from "@/lib/tutor/plan-cache";

/*
 * "Fix a word": one learner-initiated edit that reaches everything made from the note, so the
 * corrected name is what the learner sees everywhere without paying to regenerate anything.
 *
 * - The note, its title, summary and topics, and the facts decks are rebuilt from.
 * - Highlights and underlines, moved onto the corrected words (they are word positions).
 * - Flashcards, quiz and practice questions, edited in place: their ids carry progress.
 * - The transcript, which chat quotes from. Its search embedding is left as it is: one
 *   misspelled name barely moves a semantic match, and re-embedding would cost a call per row.
 * - The mind map and the tutor's running order, edited in place and kept fresh when they were
 *   fresh, so the fix does not turn into a paid redraw.
 * - Podcast episodes keep their audio, which still says the old word, and get the corrected
 *   script; without re-keying them they would vanish from the note, which is worse.
 * - Read-aloud is not touched: it is keyed by the note's text and re-voices on the next play,
 *   as after any other change.
 *
 * Nothing here is one transaction, so every step is idempotent: running the same fix again finds
 * nothing left in the parts that succeeded and finishes the ones that did not.
 */

export type NoteWordFixOutcome =
  | { status: "not_ready" }
  | { status: "conflict" }
  | {
      status: "ok";
      noteCount: number;
      otherCount: number;
      revision: number;
      doc: EditableNoteDoc;
    };

type Service = ReturnType<typeof createSupabaseServiceRoleClient>;

// Below PostgREST's default row cap, so a page that comes back full means there may be more.
const FIX_ROWS_PAGE_SIZE = 500;

function noteWords(markdown: string, title: string | null) {
  return parseNoteTtsDocument(stripLeadingRedundantHeading(markdown, title)).words.map((word) => word.text);
}

/** Rewrites the given text columns of every row that contains the word; returns the count. */
async function fixRows(params: {
  service: Service;
  table: string;
  filterColumn: string;
  filterValues: string[];
  columns: string[];
  jsonColumns?: string[];
  find: string;
  replace: string;
}) {
  if (params.filterValues.length === 0) {
    return 0;
  }

  // Paged: a long lecture has more transcript segments than one PostgREST response returns, and
  // the name late in the recording must be fixed too.
  const rows: Array<Record<string, unknown>> = [];

  for (let from = 0; ; from += FIX_ROWS_PAGE_SIZE) {
    const { data, error } = await params.service
      .from(params.table as never)
      .select(["id", ...params.columns, ...(params.jsonColumns ?? [])].join(","))
      .in(params.filterColumn, params.filterValues)
      .order("id")
      .range(from, from + FIX_ROWS_PAGE_SIZE - 1);

    if (error) {
      throw error;
    }

    const page = (data ?? []) as unknown as Array<Record<string, unknown>>;
    rows.push(...page);

    if (page.length < FIX_ROWS_PAGE_SIZE) {
      break;
    }
  }

  let total = 0;
  const updates: Array<{ id: string; patch: Record<string, unknown> }> = [];

  for (const row of rows) {
    const patch: Record<string, unknown> = {};

    for (const column of params.columns) {
      const value = row[column];
      if (typeof value !== "string") continue;
      const fixed = replaceNoteWord(value, params.find, params.replace);
      if (fixed.count > 0) {
        patch[column] = fixed.text;
        total += fixed.count;
      }
    }

    for (const column of params.jsonColumns ?? []) {
      const fixed = replaceNoteWordInJson(row[column], params.find, params.replace);
      if (fixed.count > 0) {
        patch[column] = fixed.value;
        total += fixed.count;
      }
    }

    if (Object.keys(patch).length > 0) {
      updates.push({ id: String(row.id), patch });
    }
  }

  // A handful of rows at most for a name; a few in flight keeps a long transcript quick.
  for (let index = 0; index < updates.length; index += 8) {
    const batch = updates.slice(index, index + 8);
    const results = await Promise.all(
      batch.map((update) =>
        params.service
          .from(params.table as never)
          .update(update.patch as never)
          .eq("id", update.id),
      ),
    );
    const failed = results.find((result) => result.error);
    if (failed?.error) {
      throw failed.error;
    }
  }

  return total;
}

async function fixMindmap(params: {
  service: Service;
  lectureId: string;
  oldHash: string;
  newHash: string;
  find: string;
  replace: string;
}) {
  const { data, error } = await params.service
    .from("lecture_mindmap_assets")
    .select("status, map_json, notes_hash, generated_at")
    .eq("lecture_id", params.lectureId)
    .maybeSingle();

  if (error) throw error;
  const asset = data as { status: string; map_json: Json; notes_hash: string | null; generated_at: string } | null;

  if (!asset || asset.status !== "ready") {
    return 0;
  }

  const fixed = replaceNoteWordInJson(asset.map_json, params.find, params.replace);
  // A map drawn for this exact note stays fresh; one that was already stale stays stale.
  const keepFresh = asset.notes_hash === params.oldHash;

  if (fixed.count === 0 && !keepFresh) {
    return 0;
  }

  const { error: updateError } = await params.service
    .from("lecture_mindmap_assets")
    .update({
      map_json: fixed.value,
      ...(keepFresh ? { notes_hash: params.newHash } : {}),
    } as never)
    .eq("lecture_id", params.lectureId)
    .eq("status", "ready")
    // A redraw that finished in the meantime wins.
    .eq("generated_at", asset.generated_at);

  if (updateError) throw updateError;
  return fixed.count;
}

async function fixPodcasts(params: {
  service: Service;
  lectureId: string;
  oldHash: string;
  newHash: string;
  find: string;
  replace: string;
}) {
  const { data, error } = await params.service
    .from("lecture_podcasts")
    .select("id, content_hash, status, title, turns")
    .eq("lecture_id", params.lectureId);

  if (error) throw error;
  let total = 0;
  const episodes = (data ?? []) as Array<{
    id: string;
    content_hash: string;
    status: string;
    title: string | null;
    turns: Json;
  }>;
  const readyEpisodes = episodes.filter((episode) => episode.status === "ready");

  for (const episode of episodes) {
    const patch: Record<string, unknown> = {};

    // Keep every episode attached to the corrected note, one still being made included:
    // "<noteHash>" or "<noteHash>:<castKey>".
    if (episode.content_hash === params.oldHash || episode.content_hash.startsWith(`${params.oldHash}:`)) {
      patch.content_hash = params.newHash + episode.content_hash.slice(params.oldHash.length);
    }

    // The script of an episode still being written belongs to its generator; only finished ones
    // are corrected here.
    if (episode.status === "ready" && episode.title) {
      const title = replaceNoteWord(episode.title, params.find, params.replace);
      if (title.count > 0) {
        patch.title = title.text;
        total += title.count;
      }
    }

    const turns =
      episode.status === "ready"
        ? replaceNoteWordInJson(episode.turns, params.find, params.replace)
        : { value: episode.turns, count: 0 };
    if (turns.count > 0) {
      patch.turns = turns.value;
      total += turns.count;
    }

    if (Object.keys(patch).length > 0) {
      const { error: updateError } = await params.service
        .from("lecture_podcasts")
        .update(patch as never)
        .eq("id", episode.id);
      if (updateError) throw updateError;
    }
  }

  total += await fixRows({
    service: params.service,
    table: "lecture_podcast_segments",
    filterColumn: "podcast_id",
    filterValues: readyEpisodes.map((episode) => episode.id),
    columns: ["text"],
    find: params.find,
    replace: params.replace,
  });

  return total;
}

export async function applyNoteWordFix(params: {
  lectureId: string;
  find: string;
  replace: string;
}): Promise<NoteWordFixOutcome> {
  const service = createSupabaseServiceRoleClient();
  const { find, replace, lectureId } = params;

  const [{ data: lectureData, error: lectureError }, { data: artifactData, error: artifactError }] = await Promise.all([
    service.from("lectures").select("title").eq("id", lectureId).maybeSingle(),
    service.from("lecture_artifacts").select("*").eq("lecture_id", lectureId).maybeSingle(),
  ]);

  if (lectureError) throw lectureError;
  if (artifactError) throw artifactError;

  const artifact = artifactData as LectureArtifactRow | null;
  const oldTitle = (lectureData as { title: string | null } | null)?.title ?? null;

  if (!artifact || typeof artifact.structured_notes_md !== "string") {
    return { status: "not_ready" };
  }

  const oldNote = artifact.structured_notes_md;
  const note = replaceNoteWord(oldNote, find, replace);
  const title = oldTitle ? replaceNoteWord(oldTitle, find, replace) : { text: oldTitle, count: 0 };
  const newNote = note.text;
  const newTitle = title.text;
  const summary = replaceNoteWord(artifact.summary ?? "", find, replace);
  const keyTopics = replaceNoteWordInJson(artifact.key_topics ?? [], find, replace);

  // The facts flashcards and practice questions are rebuilt from, so a later regeneration does
  // not bring the old name back.
  const metadata = (artifact.model_metadata ?? {}) as Record<string, unknown>;
  const knowledgeItems = replaceNoteWordInJson(metadata.knowledgeItems ?? null, find, replace);
  const nextMetadata: Record<string, unknown> = { ...metadata };
  if (knowledgeItems.count > 0) nextMetadata.knowledgeItems = knowledgeItems.value;
  const sourceLanguage = metadata.sourceLanguage as { notesHash?: string } | undefined;
  if (sourceLanguage?.notesHash === generationCacheKey([oldNote])) {
    // Same note, same language: no reason to pay for detecting it again.
    nextMetadata.sourceLanguage = { ...sourceLanguage, notesHash: generationCacheKey([newNote]) };
  }

  const storedDoc = parseStoredNoteDoc(artifact);
  const doc: EditableNoteDoc = {
    version: NOTE_DOC_VERSION,
    baseNotesHash: hashNotesContent(newNote),
    updatedAt: new Date().toISOString(),
    annotations: remapNoteAnnotations(storedDoc.annotations, noteWords(oldNote, oldTitle), noteWords(newNote, newTitle)),
    mediaBlocks: storedDoc.mediaBlocks,
  };

  // The tutor's running order is kept against the raw note (tutor-plan.ts reads it that way).
  const tutorPlanFresh =
    artifact.tutor_plan != null && artifact.tutor_plan_notes_hash === hashNotesContent(oldNote);
  const tutorPlan = tutorPlanFresh
    ? replaceNoteWordInJson(artifact.tutor_plan, find, replace)
    : { value: artifact.tutor_plan, count: 0 };

  const revision = artifact.editable_notes_revision ?? 0;
  const updatedAt = new Date().toISOString();
  let update = service
    .from("lecture_artifacts")
    .update({
      structured_notes_md: newNote,
      summary: summary.text,
      key_topics: keyTopics.value,
      model_metadata: nextMetadata as Json,
      editable_notes_doc: serializeEditableNoteDoc({ ...doc, updatedAt }) as Json,
      editable_notes_revision: revision + 1,
      editable_notes_updated_at: updatedAt,
      ...(tutorPlanFresh
        ? { tutor_plan: tutorPlan.value, tutor_plan_notes_hash: hashNotesContent(newNote) }
        : {}),
    } as never)
    .eq("lecture_id", lectureId);

  // Same compare-and-set as the highlight save: a highlight saved meanwhile is not overwritten
  // with positions computed for the note before it.
  update =
    revision === 0
      ? update.or("editable_notes_revision.eq.0,editable_notes_revision.is.null")
      : update.eq("editable_notes_revision", revision);

  const { data: saved, error: saveError } = await update.select("editable_notes_revision").maybeSingle();
  if (saveError) throw saveError;
  if (!saved) return { status: "conflict" };

  if (title.count > 0 && newTitle) {
    const { error } = await service.from("lectures").update({ title: newTitle } as never).eq("id", lectureId);
    if (error) throw error;
  }

  const oldStripped = stripLeadingRedundantHeading(oldNote, oldTitle);
  const newStripped = stripLeadingRedundantHeading(newNote, newTitle);

  const [flashcards, sections, quiz, practice, transcript, mindmap, podcasts] = await Promise.all([
    fixRows({ service, table: "flashcards", filterColumn: "lecture_id", filterValues: [lectureId], columns: ["front", "back", "hint"], find, replace }),
    fixRows({ service, table: "lecture_study_sections", filterColumn: "lecture_id", filterValues: [lectureId], columns: ["title", "source_label"], find, replace }),
    fixRows({ service, table: "quiz_questions", filterColumn: "lecture_id", filterValues: [lectureId], columns: ["prompt", "explanation"], jsonColumns: ["options_json"], find, replace }),
    fixRows({ service, table: "practice_test_questions", filterColumn: "lecture_id", filterValues: [lectureId], columns: ["prompt", "answer_guide"], find, replace }),
    fixRows({ service, table: "transcript_segments", filterColumn: "lecture_id", filterValues: [lectureId], columns: ["text"], find, replace }),
    fixMindmap({ service, lectureId, oldHash: hashNotesContent(oldStripped), newHash: hashNotesContent(newStripped), find, replace }),
    fixPodcasts({ service, lectureId, oldHash: hashPodcastSource(oldStripped), newHash: hashPodcastSource(newStripped), find, replace }),
  ]);

  return {
    status: "ok",
    noteCount: note.count + title.count,
    otherCount:
      summary.count + keyTopics.count + flashcards + sections + quiz + practice + transcript + mindmap + podcasts + tutorPlan.count,
    revision: (saved as { editable_notes_revision: number }).editable_notes_revision,
    doc,
  };
}
