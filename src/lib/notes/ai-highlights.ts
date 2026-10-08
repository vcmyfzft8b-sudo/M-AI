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
  MAX_TERM_WORDS,
  MIN_NOTE_WORDS_FOR_HIGHLIGHTS,
  pickHighlightRanges,
} from "@/lib/notes/ai-highlight-ranges";
import { parseNoteTtsDocument, stripLeadingRedundantHeading } from "@/lib/note-tts-text";

/**
 * The model runs a highlighter over the finished note and the result is stored as ordinary
 * annotations — the same objects the reader creates by selecting text — so the reader can remove
 * any of them exactly the way they remove their own: select the span, tap highlight again.
 *
 * What it marks is the key terms where the note defines them (a learner asked for exactly that in
 * the October 2026 survey: "poudari ključne besede v definicijah", so the most important ideas
 * stand out and stick). It used to mark 3-to-15-word phrases it judged important, which read as
 * half-sentences and missed the terms themselves, and it skipped the definition boxes entirely.
 *
 * Yellow on purpose: the classic highlighter colour, and visibly distinct from both the blue the
 * heading highlight uses (.lecture-heading-highlight) and the orange the reader's own highlights
 * default to.
 */
const AI_HIGHLIGHT_COLOR_ID = "yellow";
const AI_HIGHLIGHT_ID_PREFIX = "ai-hl-";

const highlightSelectionSchema = z.object({
  highlights: z
    .array(
      z.object({
        /** The key term itself, verbatim; matched mechanically, so paraphrase is discarded. */
        term: z.string().min(1).max(120),
        /** Verbatim words around it from the same sentence, to find the right occurrence. */
        context: z.string().max(300),
        kind: z.enum(["term", "fact"]),
      }),
    )
    .max(MAX_AI_HIGHLIGHTS + 10),
});

function highlightInstructions(target: number) {
  return `You are the reader's highlighter. You are given finished study notes. Highlight the KEY TERMS: the concepts a student must know, at the place where the note defines or explains each one, so the most important ideas stand out and are easier to remember.

What to pick:
- "term": the key term itself, copied VERBATIM from the note (1 to ${MAX_TERM_WORDS} words, same spelling, diacritics and case), e.g. "Cenovna elastičnost", "inzulinska rezistenca", "Frank-Starlingov zakon". The term, never the definition sentence.
- The note usually puts a defined term in **bold** where it introduces it, and definitions often sit in "> **Definicija:** ..." (or "Definition:") boxes. Prefer those terms, and do highlight terms inside definition boxes, but never the box label itself ("Definicija", "Pogosta napaka", "Ključno").
- A list item that starts with a bold term, a colon and its explanation ("- **Jedro:** organel, ki ...") is a definition: highlight that term. So is a term in the first column of a table that explains or compares it.
- Skip bold that is not a concept: labels that only name a group, a step or an example ("Pravice:", "Naloga 4:", "Primer:"), names of people used as examples, and plain numbers.
- Highlight each term once, where it is defined, not at later mentions.
- "context": 4 to 20 words copied verbatim from the same sentence, containing the term, so the right occurrence can be found.
- "kind": "term" for a key term. Use "fact" only for a decisive number, date, formula or condition that a test would ask about, at most a quarter of your picks. For a fact, "term" is the value together with what it is (2 to ${MAX_TERM_WORDS} words, e.g. "približno 50 %", "32 bitov", "od 15. leta"), never a bare number.

Rules:
- Never pick from a heading. Picks must not overlap.
- Highlight every key term the note defines or introduces, in note order, up to ${target} picks. If the note has more, keep the most important ones and spread them across the whole note. Fewer is fine when the note has fewer real key terms; an empty list is a valid answer. Never pick filler to reach a count.`;
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
