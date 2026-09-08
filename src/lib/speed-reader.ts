import type { NoteTtsBlock, NoteTtsDocument, NoteTtsInlineToken } from "./note-tts-text.ts";

/**
 * Speed reading — one word at a time, in place.
 *
 * The whole point of RSVP is that the eye never moves: every word is drawn with
 * the same letter under the same pixel, so the reader spends their time reading
 * rather than tracking a line. Two things have to be right for that to work,
 * and both live here rather than in the component:
 *
 *   - which letter to centre on (`focusIndex`), and
 *   - how long each word stays up (`wordDurationMs`).
 *
 * A flat 60000/wpm for every word reads badly: a fourteen-letter term goes past
 * in the same instant as "in", and a full stop lands with no more weight than a
 * space, so sentences run into each other. The multipliers below are what make
 * a constant word rate feel like reading instead of like a slideshow.
 */

/** What follows a word, which is what earns it extra time on screen. */
export type SpeedReadPause = "none" | "clause" | "sentence" | "block";

export type SpeedReadWord = {
  text: string;
  pause: SpeedReadPause;
  /** A formula, shown as its source. It needs longer than its length suggests. */
  math?: true;
};

export const SPEED_READER_MIN_WPM = 200;
export const SPEED_READER_MAX_WPM = 800;
export const SPEED_READER_DEFAULT_WPM = 300;
/** One notch of the keyboard shortcuts, and the slider's step. */
export const SPEED_READER_WPM_STEP = 25;

/**
 * Gradual speed-up: start at the rate that was chosen and climb from there.
 *
 * It used to open below it — the note was the warm-up, and the set rate was the
 * midpoint of the ramp rather than its start. That reads as the setting being
 * ignored: someone who has moved the slider to 500 has said what they can read
 * at, and starting them at 350 is slower than the speed they asked for, on the
 * screen where they asked for it. So the number on the slider is where the
 * reader begins, and the ramp is what it does afterwards.
 *
 * A note read with this on therefore finishes sooner than the same note read
 * flat, which is the point of it.
 */
const GRADUAL_START_FACTOR = 1;
const GRADUAL_END_FACTOR = 1.3;

/**
 * How much longer than a plain word each kind of ending stays up. Roughly the
 * proportions of spoken pauses: a comma is half a beat, a full stop is a beat,
 * and the gap between paragraphs is a little more than that.
 */
const PAUSE_FACTORS: Record<SpeedReadPause, number> = {
  none: 1,
  clause: 1.5,
  sentence: 2.2,
  block: 2.6,
};

/**
 * Words up to this length are read at a glance; every letter past it costs a
 * little more time. The cap stops a stray 40-character token (a URL, a chemical
 * name) freezing the reader for a second and a half.
 */
const FREE_WORD_LENGTH = 7;
const PER_LETTER_FACTOR = 0.06;
const MAX_LENGTH_FACTOR = 2.5;
/** A formula is parsed, not read, so it gets double the time its length earns. */
const MATH_FACTOR = 2;

/**
 * The letter the eye lands on when it reads a word in one fixation: the middle
 * one, a shade left of centre on an even-length word.
 *
 * It used to be capped at the fifth letter, on the theory that a pivot too far
 * into a long word drags the eye off the centre line. What that actually did
 * was hang the whole of a long word off one side of the stage: the pivot is
 * pinned to the middle of the screen, so "mikroekonomski" pivoted on its fifth
 * letter has to fit nine letters into the right half and four into the left,
 * and the right half is what ran off the edge. Balanced halves are what let a
 * long word be shown whole, and being shown whole beats being pivoted ideally.
 */
export function focusIndex(word: string) {
  return Math.max(0, Math.round(word.length / 2) - 1);
}

/** Splits a word around its focus letter, ready for the three-column stage. */
export function splitAtFocus(word: string) {
  const at = Math.min(focusIndex(word), Math.max(0, word.length - 1));

  return {
    before: word.slice(0, at),
    focus: word.slice(at, at + 1),
    after: word.slice(at + 1),
  };
}

/**
 * How wide the word is on the stage, counted in letters.
 *
 * Not its length: the pivot is held on the centre line, so the stage has to be
 * wide enough for *twice* the longer of the two halves, plus the pivot itself.
 * A word measured by its length alone is sized to fit a space it does not get,
 * and the far half is clipped. This is the number the type size is chosen for.
 */
export function stageWidthInLetters(word: string) {
  const { before, after } = splitAtFocus(word);

  return Math.max(before.length, after.length) * 2 + 1;
}

export function clampWpm(wpm: number) {
  if (!Number.isFinite(wpm)) {
    return SPEED_READER_DEFAULT_WPM;
  }

  return Math.min(SPEED_READER_MAX_WPM, Math.max(SPEED_READER_MIN_WPM, Math.round(wpm)));
}

/**
 * The rate the reader is actually running at, `progress` being how far through
 * the note it is (0 at the first word, 1 at the last). Without the ramp this is
 * just the set rate.
 */
export function wpmAtProgress(targetWpm: number, progress: number, gradual: boolean) {
  if (!gradual) {
    return clampWpm(targetWpm);
  }

  const position = Math.min(1, Math.max(0, Number.isFinite(progress) ? progress : 0));
  const factor = GRADUAL_START_FACTOR + (GRADUAL_END_FACTOR - GRADUAL_START_FACTOR) * position;

  return clampWpm(targetWpm * factor);
}

/** How long one word stays on the stage, in milliseconds. */
export function wordDurationMs(word: SpeedReadWord, wpm: number) {
  const base = 60000 / clampWpm(wpm);
  const lengthFactor = Math.min(
    MAX_LENGTH_FACTOR,
    1 + Math.max(0, word.text.length - FREE_WORD_LENGTH) * PER_LETTER_FACTOR,
  );

  return base * lengthFactor * PAUSE_FACTORS[word.pause] * (word.math ? MATH_FACTOR : 1);
}

/**
 * How long the rest of the note takes from `fromIndex`, so the screen can say
 * so. The ramp is measured against the whole note rather than against what is
 * left of it: a reader four fifths of the way through is four fifths of the way
 * up the ramp, and timing the remainder as if it started over would quote them
 * the opening rate for the fastest part of the note.
 */
export function totalDurationMs(
  words: SpeedReadWord[],
  wpm: number,
  gradual: boolean,
  fromIndex = 0,
) {
  const lastIndex = Math.max(1, words.length - 1);
  let total = 0;

  for (let index = Math.max(0, fromIndex); index < words.length; index += 1) {
    total += wordDurationMs(words[index], wpmAtProgress(wpm, index / lastIndex, gradual));
  }

  return total;
}

/*
 * Punctuation is read off the text between two words, because the tokenizer
 * strips it from the words themselves. Only closing marks count: an opening
 * bracket belongs to the word after it, and pausing before it would put the
 * break in the wrong place.
 */
const SENTENCE_MARKS = /[.!?…]/u;
const CLAUSE_MARKS = /[,;:)\]}»”"]|—|–/u;

const PAUSE_RANK: Record<SpeedReadPause, number> = {
  none: 0,
  clause: 1,
  sentence: 2,
  block: 3,
};

function strongerPause(current: SpeedReadPause, next: SpeedReadPause) {
  return PAUSE_RANK[next] > PAUSE_RANK[current] ? next : current;
}

function pauseForGap(text: string): SpeedReadPause {
  if (SENTENCE_MARKS.test(text)) {
    return "sentence";
  }

  return CLAUSE_MARKS.test(text) ? "clause" : "none";
}

function appendTokens(words: SpeedReadWord[], tokens: readonly NoteTtsInlineToken[]) {
  for (const token of tokens) {
    if (token.type === "word") {
      words.push({ text: token.text, pause: "none" });
      continue;
    }

    if (token.type === "math") {
      words.push({ text: token.text.trim(), pause: "none", math: true });
      continue;
    }

    const last = words.at(-1);
    if (last) {
      last.pause = strongerPause(last.pause, pauseForGap(token.text));
    }
  }
}

/** Closes off a run — a paragraph, a list item, a table cell — with its own beat. */
function endRun(words: SpeedReadWord[]) {
  const last = words.at(-1);
  if (last) {
    last.pause = strongerPause(last.pause, "block");
  }
}

function appendBlock(words: SpeedReadWord[], block: NoteTtsBlock) {
  if (block.kind === "list") {
    for (const item of block.items) {
      appendTokens(words, item.tokens);
      endRun(words);
    }

    return;
  }

  if (block.kind === "table") {
    for (const row of block.rows) {
      for (const cell of row.cells) {
        appendTokens(words, cell.tokens);
        endRun(words);
      }
    }

    return;
  }

  appendTokens(words, block.tokens);
  endRun(words);
}

/**
 * The reading order, taken from the same parse the read-aloud player uses — so
 * the two ways of taking in a note cover exactly the same words in exactly the
 * same order.
 */
export function buildSpeedReadWords(document: NoteTtsDocument) {
  const words: SpeedReadWord[] = [];

  for (const block of document.blocks) {
    appendBlock(words, block);
  }

  return words.filter((word) => word.text.length > 0);
}

/** The first word of the sentence at or before `index`, for stepping backwards. */
export function sentenceStart(words: SpeedReadWord[], index: number) {
  const from = Math.min(Math.max(0, index), Math.max(0, words.length - 1));

  for (let cursor = from - 1; cursor > 0; cursor -= 1) {
    if (words[cursor - 1].pause === "sentence" || words[cursor - 1].pause === "block") {
      return cursor;
    }
  }

  return 0;
}

/** The first word of the next sentence after `index`, for stepping forwards. */
export function nextSentenceStart(words: SpeedReadWord[], index: number) {
  for (let cursor = Math.max(0, index); cursor < words.length - 1; cursor += 1) {
    if (words[cursor].pause === "sentence" || words[cursor].pause === "block") {
      return cursor + 1;
    }
  }

  return Math.max(0, words.length - 1);
}
