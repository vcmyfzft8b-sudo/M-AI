import "server-only";

import { z } from "zod";

import { generateStructuredObject } from "@/lib/ai/json";
import type { GeminiUsageContext } from "@/lib/ai/usage-logging";
import {
  MAX_NOTE_ANNOTATIONS,
  parseStoredNoteDoc,
  readLectureArtifactForNoteDoc,
  saveEditableNoteDoc,
} from "@/lib/note-doc-server";
import {
  collectHighlightableWords,
  highlightTarget,
  MAX_AI_HIGHLIGHTS,
  MAX_KEYWORD_WORDS,
  MIN_NOTE_WORDS_FOR_HIGHLIGHTS,
  pickHighlightRanges,
} from "@/lib/notes/ai-highlight-ranges";
import { parseNoteTtsDocument, stripLeadingRedundantHeading } from "@/lib/note-tts-text";

/**
 * The model runs a highlighter over the finished note and the result is stored as ordinary
 * annotations — the same objects the reader creates by selecting text — so the reader can remove
 * any of them exactly the way they remove their own: select the span, tap highlight again.
 *
 * What it marks is the key words inside the definitions of the note's most important concepts,
 * the part a learner has to remember. A learner asked for exactly that in the October 2026 survey:
 * "da Memo ključne besede v definicijah poudari, saj bi tako lažje prepoznala najpomembnejše pojme
 * in si jih hitreje zapomnila". It used to mark 3-to-15-word phrases it judged important anywhere,
 * which read as random half-sentences, and it skipped the definition boxes entirely.
 *
 * Stored with the palette's "yellow" colour id, the same as before this change.
 */
const AI_HIGHLIGHT_COLOR_ID = "yellow";
const AI_HIGHLIGHT_ID_PREFIX = "ai-hl-";

/**
 * No length bounds here on purpose. They are stripped from the request and only enforced when the
 * answer is parsed, so one pick too many or one long context would reject the whole answer and
 * leave the note with no highlights. pickHighlightRanges applies every limit to what comes back.
 */
const highlightSelectionSchema = z.object({
  highlights: z.array(
    z.object({
      /** The concept the definition is about; not highlighted itself. */
      concept: z.string(),
      /** The key words inside its definition, verbatim; matched mechanically. */
      keywords: z.string(),
      /** Verbatim words from the same sentence, to find the right occurrence. */
      context: z.string(),
    }),
  ),
});

function highlightInstructions(target: number) {
  return `You are the reader's highlighter. You are given finished study notes. A learner wants the KEY WORDS IN THE DEFINITIONS emphasized, so she can spot the most important concepts at a glance and remember them faster.

Step 1. Choose the most important concepts of this material: the ones a teacher would ask about in a test. Aim for about ${target}, spread evenly across the whole note, from its first section to its last. Skip minor terms, side remarks, examples, people and places mentioned in passing.

Step 2. For each one, find where the note defines or explains it. That can be a sentence, a list item such as "- **Mitoza:** delitev, pri kateri ...", a row of a table, or a definition box ("> **Definicija:** ...").

Step 3. Pick the KEY WORDS INSIDE that definition: the decisive words that carry its meaning and must be memorized, not the concept's own name. Examples:
- "Mitoza: delitev, pri kateri iz ene celice nastaneta dve hčerinski celici z enakim številom kromosomov kot materinska celica." → keywords "dve hčerinski celici z enakim številom kromosomov"
- "Celica je najmanjša zgradbena in delovna enota živega bitja." → keywords "najmanjša zgradbena in delovna enota"
- "Ponudba brez bistvenih sestavin ni ponudba, temveč zgolj vabilo k ponudbi." → keywords "brez bistvenih sestavin"

Output for each pick:
- "concept": the concept's name.
- "keywords": copied VERBATIM from the definition (same spelling, diacritics and case), one continuous span of 2 to ${MAX_KEYWORD_WORDS} words, usually 3 to 6. Never a single word, never the concept's name alone, never a whole sentence, never a bare number.
- "context": 6 to 25 words copied verbatim from the same sentence, containing the keywords, so the right place can be found.

Rules:
- One pick per concept, in note order. Picks must not overlap. Never pick from a heading or a box label ("Definicija", "Ključno").
- Fewer is fine only when the note really has fewer definitions of important concepts; an empty list is a valid answer. Never pick filler to reach a count.`;
}

/**
 * Runs the highlighter over a freshly generated note and stores the result as annotations.
 *
 * Best-effort by design, exactly like document-image placement: a finished note must never be
 * thrown away over a decoration, so every failure path returns quietly. Idempotent across the
 * pipeline's retries — a doc that already carries AI highlights is left alone, which also means
 * a reader who deleted them never has them forced back.
 */
export async function applyAiHighlightsToNote(params: {
  lectureId: string;
  structuredNotesMd: string;
  lectureTitle?: string | null;
  usageContext?: GeminiUsageContext;
}) {
  try {
    const cleaned = stripLeadingRedundantHeading(params.structuredNotesMd, params.lectureTitle);
    const words = collectHighlightableWords(parseNoteTtsDocument(cleaned).blocks);

    if (words.length < MIN_NOTE_WORDS_FOR_HIGHLIGHTS) {
      return;
    }

    const target = highlightTarget(words.length);
    const selection = await generateStructuredObject({
      schema: highlightSelectionSchema,
      stage: "chat",
      maxOutputTokens: 2400,
      instructions: highlightInstructions(target),
      input: cleaned,
      usageContext: { ...(params.usageContext ?? {}), stage: "note_highlight" },
    });

    const createdAt = new Date().toISOString();
    const ranges = pickHighlightRanges(words, selection.highlights, MAX_AI_HIGHLIGHTS);

    if (ranges.length === 0) {
      return;
    }

    const artifact = await readLectureArtifactForNoteDoc(params.lectureId);

    if (!artifact) {
      return;
    }

    const storedDoc = parseStoredNoteDoc(artifact);

    if (storedDoc.annotations.some((annotation) => annotation.id.startsWith(AI_HIGHLIGHT_ID_PREFIX))) {
      return;
    }

    const openSlots = Math.max(0, MAX_NOTE_ANNOTATIONS - storedDoc.annotations.length);

    await saveEditableNoteDoc({
      lectureId: params.lectureId,
      expectedRevision: artifact.editable_notes_revision ?? 0,
      doc: {
        ...storedDoc,
        annotations: [
          ...storedDoc.annotations,
          ...ranges.slice(0, openSlots).map((range) => ({
            id: `${AI_HIGHLIGHT_ID_PREFIX}${crypto.randomUUID()}`,
            kind: "highlight" as const,
            startWordIndex: range.startWordIndex,
            endWordIndex: range.endWordIndex,
            colorId: AI_HIGHLIGHT_COLOR_ID,
            createdAt,
          })),
        ],
      },
    });
  } catch (error) {
    console.warn("AI highlight pass failed; the note keeps its text.", {
      lectureId: params.lectureId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
