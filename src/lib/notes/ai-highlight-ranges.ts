import type { NoteTtsBlock, NoteTtsInlineToken } from "@/lib/note-tts-text";

/**
 * The mechanical half of the note highlighter: which words may be highlighted, and where a
 * model's verbatim pick lands in the word stream the reader's own selections index against.
 * Kept free of the model and the database so it can be tested directly.
 */

export type HighlightableWord = { index: number; text: string };

export type HighlightPick = {
  /** The concept the definition is about; identifies the pick, never highlighted itself. */
  concept: string;
  /** The key words inside its definition, verbatim: what gets highlighted. */
  keywords: string;
  /** A verbatim run of words around the key words, used to find the right occurrence. */
  context: string;
};

export type HighlightRange = { startWordIndex: number; endWordIndex: number };

/** The most highlights one note gets: the core concepts, not every term it mentions. */
export const MAX_AI_HIGHLIGHTS = 10;
/** A note this short is all signal; a highlighter over it marks everything and means nothing. */
export const MIN_NOTE_WORDS_FOR_HIGHLIGHTS = 60;
/** About one core concept for this many words of note. */
const WORDS_PER_HIGHLIGHT = 90;
const MIN_HIGHLIGHT_TARGET = 5;
/** Key words are the decisive part of a definition, not the whole of it. */
export const MAX_KEYWORD_WORDS = 10;

/** How many core concepts to ask for: five to ten, growing with the note. */
export function highlightTarget(wordCount: number) {
  return Math.min(
    MAX_AI_HIGHLIGHTS,
    Math.max(MIN_HIGHLIGHT_TARGET, Math.round(wordCount / WORDS_PER_HIGHLIGHT)),
  );
}

/**
 * The words before a callout's leading label colon ("Definicija:", "Pogosta napaka:"). The label
 * names the box; the term it defines comes after it, and only that should ever be highlighted.
 */
function calloutLabelWordCount(tokens: NoteTtsInlineToken[]) {
  let words = 0;

  for (const token of tokens) {
    if (token.type === "word") {
      words += 1;
    } else if (token.text.includes(":")) {
      return words <= 3 ? words : 0;
    }

    if (words > 3) {
      return 0;
    }
  }

  return 0;
}

function pushWords(target: HighlightableWord[], tokens: NoteTtsInlineToken[], skip = 0) {
  let skipped = 0;

  for (const token of tokens) {
    if (token.type !== "word") {
      continue;
    }

    if (skipped < skip) {
      skipped += 1;
      continue;
    }

    target.push({ index: token.wordIndex, text: token.text });
  }
}

/**
 * Every word a highlight may cover: the note body, list items, tables and the text of callout
 * boxes (a "Definition" box is exactly where a key term is defined), but never headings and never
 * a callout's own label.
 */
export function collectHighlightableWords(blocks: NoteTtsBlock[]) {
  const words: HighlightableWord[] = [];

  for (const block of blocks) {
    if (block.kind === "heading") {
      continue;
    }

    if (block.kind === "callout") {
      pushWords(words, block.tokens, calloutLabelWordCount(block.tokens));
      continue;
    }

    if (block.kind === "list") {
      for (const item of block.items) {
        pushWords(words, item.tokens);
      }
      continue;
    }

    if (block.kind === "table") {
      for (const row of block.rows) {
        for (const cell of row.cells) {
          pushWords(words, cell.tokens);
        }
      }
      continue;
    }

    pushWords(words, block.tokens);
  }

  return words;
}

export function normalizeHighlightWord(value: string) {
  return value.toLowerCase().normalize("NFC").replace(/[^\p{L}\p{N}]/gu, "");
}

function splitWords(value: string) {
  return value.split(/\s+/).map(normalizeHighlightWord).filter(Boolean);
}

/**
 * Where `needle` occurs in the stream, searching match starts from `from` up to a match ending at
 * `to`. Contiguity is demanded on the GLOBAL word index, so a match that would silently span a
 * skipped heading or callout label is rejected.
 */
function findSequence(
  words: HighlightableWord[],
  normalized: string[],
  needle: string[],
  from = 0,
  to = normalized.length,
) {
  if (needle.length === 0) {
    return null;
  }

  for (let start = from; start + needle.length <= to; start += 1) {
    let matched = true;

    for (let offset = 0; offset < needle.length; offset += 1) {
      if (normalized[start + offset] !== needle[offset]) {
        matched = false;
        break;
      }
    }

    if (!matched) {
      continue;
    }

    const startWordIndex = words[start].index;
    const endWordIndex = words[start + needle.length - 1].index;

    if (endWordIndex - startWordIndex !== needle.length - 1) {
      continue;
    }

    return { start, startWordIndex, endWordIndex };
  }

  return null;
}

/**
 * The word range of one pick's key words. The context finds the right sentence (the definition,
 * not a passing mention of the same words), and only the key words inside it are highlighted. A
 * pick whose context cannot be found, or does not contain the key words, falls back to their first
 * occurrence.
 */
export function findHighlightRange(
  words: HighlightableWord[],
  normalized: string[],
  pick: Pick<HighlightPick, "keywords" | "context">,
): HighlightRange | null {
  const keywords = splitWords(pick.keywords);

  // One word lifted out of a definition ("relativno") tells the reader nothing on its own.
  if (keywords.length < 2 || keywords.length > MAX_KEYWORD_WORDS) {
    return null;
  }

  const context = splitWords(pick.context);
  const contextMatch =
    context.length >= keywords.length ? findSequence(words, normalized, context) : null;
  const match =
    (contextMatch &&
      findSequence(words, normalized, keywords, contextMatch.start, contextMatch.start + context.length)) ||
    findSequence(words, normalized, keywords);

  return match ? { startWordIndex: match.startWordIndex, endWordIndex: match.endWordIndex } : null;
}

/**
 * Turns the model's picks into stored ranges: located, never overlapping, one per concept, never
 * just the concept's own name (that is the heading or label already), and capped.
 */
export function pickHighlightRanges(
  words: HighlightableWord[],
  picks: HighlightPick[],
  limit: number,
) {
  const normalized = words.map((word) => normalizeHighlightWord(word.text));
  const ranges: HighlightRange[] = [];
  const seenConcepts = new Set<string>();

  for (const pick of picks) {
    if (ranges.length >= limit) {
      break;
    }

    const conceptKey = splitWords(pick.concept).join(" ");
    const keywordsKey = splitWords(pick.keywords).join(" ");

    if (!keywordsKey || seenConcepts.has(conceptKey) || keywordsKey === conceptKey) {
      continue;
    }

    // A bare number ("50") tells the reader nothing once it is lifted out as a highlight.
    if (/^\d+$/.test(keywordsKey)) {
      continue;
    }

    const range = findHighlightRange(words, normalized, pick);

    if (!range) {
      continue;
    }

    const overlaps = ranges.some(
      (existing) =>
        range.startWordIndex <= existing.endWordIndex && range.endWordIndex >= existing.startWordIndex,
    );

    if (overlaps) {
      continue;
    }

    if (conceptKey) {
      seenConcepts.add(conceptKey);
    }
    ranges.push(range);
  }

  return ranges;
}
