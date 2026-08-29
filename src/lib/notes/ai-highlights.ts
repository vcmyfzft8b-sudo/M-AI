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
import type { NoteTtsBlock } from "@/lib/note-tts-text";
import { parseNoteTtsDocument, stripLeadingRedundantHeading } from "@/lib/note-tts-text";

/**
 * The model runs a highlighter over the finished note the way a diligent student would, and the
 * result is stored as ordinary annotations — the same objects the reader creates by selecting
 * text — so the reader can remove any of them exactly the way they remove their own: select the
 * span, tap highlight again.
 *
 * Yellow on purpose: the classic highlighter colour, and visibly distinct from both the blue the
 * heading highlight uses (.lecture-heading-highlight) and the orange the reader's own highlights
 * default to.
 */
const AI_HIGHLIGHT_COLOR_ID = "yellow";
const AI_HIGHLIGHT_ID_PREFIX = "ai-hl-";
const MAX_AI_HIGHLIGHTS = 12;
/** A note this short is all signal; a highlighter over it marks everything and means nothing. */
const MIN_NOTE_WORDS_FOR_HIGHLIGHTS = 60;

const highlightSelectionSchema = z.object({
  highlights: z
    .array(
      z.object({
        /** Verbatim span copied from the note; matched mechanically, so paraphrase is discarded. */
        quote: z.string().min(12).max(280),
      }),
    )
    .max(20),
});

const HIGHLIGHT_INSTRUCTIONS = `You are the reader's highlighter. You are given finished study notes, and you choose the spans a diligent student would run a highlighter over: the genuinely important or tricky parts — the phrase that carries a key definition, the number that decides an answer, the condition everyone forgets, the half of a distinction that is easy to confuse.

Rules:
- Return each highlight as a VERBATIM quote, copied character-for-character from the note text (including punctuation and diacritics). Quotes are located mechanically; anything paraphrased is discarded.
- Each quote is one continuous span of 3 to 15 words: the decisive phrase, not the whole sentence and never a whole paragraph.
- Choose 4 to 12 across the whole note and spread them across sections; at most 2 per section.
- Never quote a heading, and never quote text inside a "> **...**" callout box — those are already emphasized.
- Quotes must not overlap each other.
- You are the judge of whether a note needs highlights at all: if little is genuinely highlight-worthy, return fewer, and an empty list is a valid answer. Never highlight filler to reach a count.`;

/** The word stream the reader's own selections index against, minus headings and callouts. */
function collectHighlightableWords(blocks: NoteTtsBlock[]) {
  const words: Array<{ index: number; text: string }> = [];

  for (const block of blocks) {
    if (block.kind === "heading" || block.kind === "callout") {
      continue;
    }

    if (block.kind === "list") {
      for (const item of block.items) {
        for (const token of item.tokens) {
          if (token.type === "word") {
            words.push({ index: token.wordIndex, text: token.text });
          }
        }
      }
      continue;
    }

    if (block.kind === "table") {
      for (const row of block.rows) {
        for (const cell of row.cells) {
          for (const token of cell.tokens) {
            if (token.type === "word") {
              words.push({ index: token.wordIndex, text: token.text });
            }
          }
        }
      }
      continue;
    }

    for (const token of block.tokens) {
      if (token.type === "word") {
        words.push({ index: token.wordIndex, text: token.text });
      }
    }
  }

  return words;
}

function normalizeWord(value: string) {
  return value.toLowerCase().normalize("NFC").replace(/[^\p{L}\p{N}]/gu, "");
}

/**
 * Locates a quote in the note's word stream and returns its word-index range — the same indexes
 * a reader's selection of those words would produce. Contiguity is demanded on the GLOBAL index,
 * so a "match" that would silently span a skipped heading or callout is rejected.
 */
function findQuoteRange(
  words: Array<{ index: number; text: string }>,
  normalizedWords: string[],
  quote: string,
) {
  const quoteWords = quote.split(/\s+/).map(normalizeWord).filter(Boolean);

  if (quoteWords.length < 2) {
    return null;
  }

  for (let start = 0; start + quoteWords.length <= normalizedWords.length; start += 1) {
    let matched = true;

    for (let offset = 0; offset < quoteWords.length; offset += 1) {
      if (normalizedWords[start + offset] !== quoteWords[offset]) {
        matched = false;
        break;
      }
    }

    if (!matched) {
      continue;
    }

    const startWordIndex = words[start].index;
    const endWordIndex = words[start + quoteWords.length - 1].index;

    if (endWordIndex - startWordIndex !== quoteWords.length - 1) {
      continue;
    }

    return { startWordIndex, endWordIndex };
  }

  return null;
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

    const selection = await generateStructuredObject({
      schema: highlightSelectionSchema,
      stage: "chat",
      maxOutputTokens: 1600,
      instructions: HIGHLIGHT_INSTRUCTIONS,
      input: cleaned,
      usageContext: { ...(params.usageContext ?? {}), stage: "note_highlight" },
    });

    const normalizedWords = words.map((word) => normalizeWord(word.text));
    const createdAt = new Date().toISOString();
    const ranges: Array<{ startWordIndex: number; endWordIndex: number }> = [];

    for (const highlight of selection.highlights) {
      const range = findQuoteRange(words, normalizedWords, highlight.quote);

      if (!range) {
        continue;
      }

      const overlaps = ranges.some(
        (existing) =>
          range.startWordIndex <= existing.endWordIndex &&
          range.endWordIndex >= existing.startWordIndex,
      );

      if (!overlaps) {
        ranges.push(range);
      }

      if (ranges.length >= MAX_AI_HIGHLIGHTS) {
        break;
      }
    }

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
