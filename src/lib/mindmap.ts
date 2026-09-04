import "server-only";

import { z } from "zod";

import type { Json, LectureMindmapAssetRow, StudyAssetStatus } from "@/lib/database.types";
import { generateStructuredObject } from "@/lib/ai/json";
import { buildMindmapInstructions, mindmapWireSchema } from "@/lib/ai/mindmap-prompt";
import { isWorkAbortedError } from "@/lib/abort-context";
import { resolveMaterialLanguage } from "@/lib/languages";
import {
  countMindmapNodes,
  mindmapDepth,
  parseMindmapDoc,
  tidyMindmapText,
  MINDMAP_TITLE_MAX_LENGTH,
  type MindmapDoc,
} from "@/lib/mindmap-doc";
import { stripLeadingRedundantHeading } from "@/lib/note-tts-text";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { hashNotesContent } from "@/lib/tutor/plan-cache";

/**
 * The mind map of a note: generated once, stored whole, redrawn from the stored tree every time.
 *
 * The whole feature is one model call, which is unusual in this codebase — flashcards, quizzes
 * and practice tests all go through the coverage pipeline that reads the source unit by unit.
 * A map is different in kind: it is a shape rather than a set of items, and a shape can only be
 * judged by something that has read the material end to end. Splitting it into per-chunk calls
 * would produce ten little maps stapled together, which is precisely the failure the competing
 * implementation shows — a single unreadable column with no top-level structure at all.
 */

/**
 * How much of the note the map is drawn from.
 *
 * Notes reach ~120k characters at the top end. The whole of one costs real money on every
 * regeneration and buys little: past this point a map is already at its node ceiling and the
 * tail of a long note is the material a learner is least likely to be mapping. The cut is at a
 * paragraph boundary so the model never reads a sentence that stops mid-clause.
 */
const MINDMAP_NOTE_CHAR_CAP = 60_000;
const MINDMAP_MAX_TOKENS = 12_000;
/**
 * Bumped whenever the prompt or the stored shape changes in a way that makes an existing map
 * worse than a fresh one. A stored map from an older version is still shown — it is a map, not a
 * bug — and is only replaced when something asks for a regeneration.
 */
export const MINDMAP_GENERATION_VERSION = "mindmap-v1";

export type LectureMindmap = {
  status: StudyAssetStatus | null;
  doc: MindmapDoc | null;
  errorMessage: string | null;
  generatedAt: string | null;
  /** True when the note has been edited since this map was drawn from it. */
  stale: boolean;
};

function truncateAtParagraph(text: string, cap: number) {
  if (text.length <= cap) {
    return text;
  }

  const hard = text.slice(0, cap);
  const lastBreak = hard.lastIndexOf("\n\n");

  return lastBreak > cap * 0.6 ? hard.slice(0, lastBreak) : hard;
}

type MindmapGrounding = {
  title: string | null;
  summary: string | null;
  keyTopics: string[];
  notes: string;
  /** The exact string the stored hash is taken over, so a cache check asks the right question. */
  hashedNotes: string;
  languageHint: string;
};

async function loadMindmapGrounding(lectureId: string): Promise<MindmapGrounding | null> {
  const supabase = createSupabaseServiceRoleClient();
  const [{ data: artifact }, { data: lecture }] = await Promise.all([
    supabase
      .from("lecture_artifacts")
      .select("summary, key_topics, structured_notes_md")
      .eq("lecture_id", lectureId)
      .maybeSingle(),
    supabase.from("lectures").select("title, language_hint").eq("id", lectureId).maybeSingle(),
  ]);

  const artifactRow = (artifact ?? null) as {
    summary: string | null;
    key_topics: string[] | null;
    structured_notes_md: string | null;
  } | null;
  const lectureRow = (lecture ?? null) as {
    title: string | null;
    language_hint: string | null;
  } | null;

  if (!artifactRow) {
    return null;
  }

  const fullNotes = stripLeadingRedundantHeading(
    artifactRow.structured_notes_md ?? "",
    lectureRow?.title ?? null,
  );
  const notes = truncateAtParagraph(fullNotes, MINDMAP_NOTE_CHAR_CAP);

  if (notes.trim().length === 0) {
    return null;
  }

  return {
    title: lectureRow?.title ?? null,
    summary: artifactRow.summary ?? null,
    keyTopics: artifactRow.key_topics ?? [],
    notes,
    /*
     * The whole note, not the truncated one. A learner editing a passage the map was never
     * drawn from has still edited the note, and the honest answer to "is this map current?" is
     * no — a hash over the cap would answer yes and quietly show a map of the old text.
     */
    hashedNotes: fullNotes,
    languageHint: lectureRow?.language_hint ?? "",
  };
}

/**
 * The fingerprint of the note as it stands, over the same string the generator hashes.
 *
 * Separate from `loadMindmapGrounding` because the staleness check wants one column, not the
 * summary and topics the prompt needs — this runs on every read of the screen, that one runs
 * once per generation.
 */
async function readNotesHash(lectureId: string) {
  const supabase = createSupabaseServiceRoleClient();
  const [{ data: artifact }, { data: lecture }] = await Promise.all([
    supabase
      .from("lecture_artifacts")
      .select("structured_notes_md")
      .eq("lecture_id", lectureId)
      .maybeSingle(),
    supabase.from("lectures").select("title").eq("id", lectureId).maybeSingle(),
  ]);

  const notes = (artifact as { structured_notes_md: string | null } | null)?.structured_notes_md;

  if (typeof notes !== "string") {
    return null;
  }

  return hashNotesContent(
    stripLeadingRedundantHeading(notes, (lecture as { title: string | null } | null)?.title ?? null),
  );
}

/** Nothing about a map is worth failing a note over, so every error here is a message, not a throw. */
export function describeMindmapError(error: unknown) {
  if (error instanceof z.ZodError) {
    return error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
      .join("; ");
  }

  return error instanceof Error ? error.message : "Unknown mindmap generation error.";
}

async function setMindmapStatus(params: {
  lectureId: string;
  status: StudyAssetStatus;
  errorMessage?: string | null;
  doc?: MindmapDoc | null;
  notesHash?: string | null;
  modelMetadata?: Record<string, unknown>;
}) {
  const supabase = createSupabaseServiceRoleClient();
  const payload: Record<string, unknown> = {
    lecture_id: params.lectureId,
    status: params.status,
    error_message: params.errorMessage ?? null,
    model_metadata: params.modelMetadata ?? {},
    generated_at: new Date().toISOString(),
  };

  /*
   * A failed or re-queued generation leaves the previous map in place. The reader keeps the map
   * they had while a retry runs, and a retry that fails costs them nothing — clearing the column
   * on the way in would turn every transient provider error into a lost map.
   */
  if (params.doc !== undefined) {
    payload.map_json = (params.doc ?? {}) as unknown as Json;
    payload.notes_hash = params.notesHash ?? null;
  }

  const { error } = await supabase
    .from("lecture_mindmap_assets")
    .upsert(payload as never, { onConflict: "lecture_id" });

  if (error) {
    throw error;
  }
}

export async function queueLectureMindmapGeneration(lectureId: string) {
  await setMindmapStatus({ lectureId, status: "queued", errorMessage: null });
}

async function readMindmapRow(lectureId: string) {
  const supabase = createSupabaseServiceRoleClient();
  /*
   * The error is deliberately not read, and that is what makes the deploy order safe: Vercel
   * ships the code and the migrations workflow creates the table, and between the two this asks
   * for a table that does not exist yet. No data reads as "no map", which is the honest answer.
   */
  const { data } = await supabase
    .from("lecture_mindmap_assets")
    .select("*")
    .eq("lecture_id", lectureId)
    .maybeSingle();

  return (data ?? null) as LectureMindmapAssetRow | null;
}

/**
 * The map to put on screen, whatever state it is in.
 *
 * `stale` is surfaced rather than acted on. A map of a note the learner has since edited is
 * still a useful map of most of it, and throwing it away on their behalf would replace something
 * they can read with a spinner they did not ask for — so it is drawn, labelled, and a redraw is
 * one tap away.
 */
export async function loadLectureMindmap(params: {
  lectureId: string;
}): Promise<LectureMindmap> {
  const row = await readMindmapRow(params.lectureId);

  if (!row) {
    return { status: null, doc: null, errorMessage: null, generatedAt: null, stale: false };
  }

  const doc = parseMindmapDoc(row.map_json);
  /*
   * Only worth asking about a finished map, and only about one that recorded what it was drawn
   * from. While a map is being drawn this is polled every couple of seconds, and a staleness
   * check there would answer a question about the map being replaced anyway.
   */
  const currentHash =
    doc && row.notes_hash && row.status === "ready"
      ? await readNotesHash(params.lectureId)
      : null;
  /* A hash that cannot be read is not evidence of an edit, so it is not reported as one. */
  const stale = currentHash != null && currentHash !== row.notes_hash;

  return {
    status: row.status,
    doc,
    errorMessage: row.error_message,
    generatedAt: row.generated_at,
    stale,
  };
}

/**
 * Draws the map, or leaves the stored one alone when it is already the map of this note.
 *
 * The hash check is what makes the "Mindmap" tab free to press twice: opening the tab queues a
 * generation, and if the note has not changed since the last one that generation is a database
 * read rather than a model call.
 */
export async function generateLectureMindmap(params: {
  lectureId: string;
  regenerate?: boolean;
}) {
  const grounding = await loadMindmapGrounding(params.lectureId);

  if (!grounding) {
    await setMindmapStatus({
      lectureId: params.lectureId,
      status: "failed",
      errorMessage: "This note has no written content to map yet.",
    });
    return;
  }

  const notesHash = hashNotesContent(grounding.hashedNotes);

  if (!params.regenerate) {
    const existing = await readMindmapRow(params.lectureId);

    if (
      existing &&
      existing.status === "ready" &&
      existing.notes_hash === notesHash &&
      parseMindmapDoc(existing.map_json)
    ) {
      return;
    }
  }

  await setMindmapStatus({ lectureId: params.lectureId, status: "generating", errorMessage: null });

  try {
    const generated = await generateStructuredObject({
      schema: mindmapWireSchema,
      stage: "mindmap",
      instructions: buildMindmapInstructions(),
      input: JSON.stringify(
        {
          noteTitle: grounding.title,
          summary: grounding.summary,
          keyTopics: grounding.keyTopics,
          notes: grounding.notes,
        },
        null,
        2,
      ),
      maxOutputTokens: MINDMAP_MAX_TOKENS,
      usageContext: { stage: "mindmap", lectureId: params.lectureId },
    });

    const doc = parseMindmapDoc(generated);

    if (!doc) {
      throw new Error("The model returned a map with no usable branches.");
    }

    /*
     * The note's own title wins over the model's when it has one. It is the name the learner
     * gave this material and the name in the breadcrumb above the canvas; a map whose middle
     * says something else reads as a map of a different note.
     */
    const title =
      tidyMindmapText(grounding.title, MINDMAP_TITLE_MAX_LENGTH) ||
      doc.title ||
      tidyMindmapText(grounding.summary, MINDMAP_TITLE_MAX_LENGTH);

    const finished: MindmapDoc = {
      ...doc,
      title,
      language:
        doc.language ||
        resolveMaterialLanguage(`${grounding.summary ?? ""}\n${grounding.notes}`, grounding.languageHint),
    };

    await setMindmapStatus({
      lectureId: params.lectureId,
      status: "ready",
      errorMessage: null,
      doc: finished,
      notesHash,
      modelMetadata: {
        generationVersion: MINDMAP_GENERATION_VERSION,
        nodeCount: countMindmapNodes(finished),
        depth: mindmapDepth(finished),
        branchCount: finished.branches.length,
      },
    });
  } catch (error) {
    if (isWorkAbortedError(error)) {
      /*
       * The invocation ran out of time rather than the work failing. Left as `generating` the
       * screen would poll a job nobody is running; queued, the next open of the tab starts it
       * again, which is what the reader is about to do anyway.
       */
      await setMindmapStatus({
        lectureId: params.lectureId,
        status: "queued",
        errorMessage: null,
      });
      return;
    }

    await setMindmapStatus({
      lectureId: params.lectureId,
      status: "failed",
      errorMessage: describeMindmapError(error),
    });
  }
}
