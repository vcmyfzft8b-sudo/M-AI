// How a written script becomes a list of turns the player and the synthesizer can both use.
//
// Kept free of "server-only", and imported relatively, so the rules below stay unit-testable
// (tests/podcast-script.test.mjs). Every one of them exists because the failure it prevents is
// silent: nothing here throws, it just plays wrong.

import { speakableMath } from "./note-tts-text.ts";
import { stripAudioTags } from "./tutor/turn-audio.ts";
import {
  PODCAST_MAX_TURN_WORDS,
  type PodcastSpeaker,
  type PodcastTurn,
} from "./podcast-settings.ts";

function countWords(value: string) {
  return value.trim().split(/\s+/u).filter(Boolean).length;
}

/**
 * A turn as the synthesizer will receive it.
 *
 * The prompt asks for plain speech and mostly gets it, but "mostly" is not a property a text-to-
 * speech request can rely on: one stray asterisk is a character read aloud, and one LaTeX
 * fragment is a sentence of punctuation names. So the same defences the note's read-aloud path
 * applies to markdown are applied here, including its speakable rendering of formulas.
 */
export function toSpokenTurnText(value: string) {
  return (
    value
      /* A model that has been told not to write "Host A:" occasionally still does. */
      .replace(/^\s*(?:host\s*)?[ab]\s*[:—-]\s+/i, "")
      .replace(/\$\$([^$]+)\$\$/g, (_match, formula: string) => spokenFormula(formula))
      .replace(/\$([^$\n]+)\$/g, (_match, formula: string) => spokenFormula(formula))
      .replace(/`+/g, "")
      .replace(/\*+/g, "")
      .replace(/^#+\s*/gm, "")
      .replace(/^\s*[-•]\s+/gm, "")
      /*
       * Every kind of whitespace, not just runs of it. A line break is nothing on a page and a
       * long unexplained pause in the mouth of a host, and the turn is one thing being said.
       */
      .replace(/\s+/g, " ")
      .trim()
  );
}

/**
 * A formula, said rather than printed.
 *
 * The note's own read-aloud renders LaTeX commands into words and stops there, which is right for
 * a reader who can also see the note. Here nobody can, so the two characters it leaves behind are
 * finished off: a caret and an underscore have no sound, and "m c squared" read as "m c caret two"
 * is worse than "m c two". This is a floor, not a translation — the prompt's rule that formulas
 * are written out in words is what actually keeps them speakable, and this is what catches the
 * turns where the model wrote one anyway.
 */
function spokenFormula(latex: string) {
  return speakableMath(latex)
    .replace(/[\^_]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Cuts an over-long turn at the last sentence end that fits, so neither half starts mid-thought. */
function splitLongTurn(text: string): string[] {
  if (countWords(text) <= PODCAST_MAX_TURN_WORDS) {
    return [text];
  }

  const sentences = text.match(/[^.!?…]+[.!?…]*\s*/gu) ?? [text];
  const parts: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    if (current && countWords(current) + countWords(sentence) > PODCAST_MAX_TURN_WORDS) {
      parts.push(current.trim());
      current = sentence;
      continue;
    }

    current += sentence;
  }

  if (current.trim()) {
    parts.push(current.trim());
  }

  return parts.filter(Boolean);
}

/**
 * The script the player is actually given, which is not quite the one the model wrote.
 *
 * Three things are settled here rather than trusted to the prompt, because each of them is a
 * silent failure rather than a visible one. In a two-hander, consecutive turns from the same host
 * are merged: the model breaks strict alternation occasionally, and left alone that plays as the
 * same voice stopping and starting for no reason. A solo episode's every turn is forced onto the
 * one host it has. And a turn longer than the synthesizer's own ceiling is split, because Soniox
 * truncates past three minutes of audio with a 200 and no warning — the listener would simply
 * lose the end of a sentence.
 *
 * The merge deliberately does NOT apply to a solo episode, and that exception was earned. With
 * one host every turn is by definition the same speaker as the last, so merging turned an
 * eleven-turn briefing into three blocks of up to 216 words — two minutes of audio in a single
 * request, which is a two-minute wait for the first sound and a transcript with three lines in
 * it. Alone, the writer's paragraphing IS the turn structure; there is no alternation for it to
 * have broken.
 */
export function normalizePodcastTurns(params: {
  turns: Array<{ speaker: string; text: string }>;
  speakerCount: 1 | 2;
}): PodcastTurn[] {
  const merged: PodcastTurn[] = [];

  for (const turn of params.turns) {
    const text = toSpokenTurnText(turn.text ?? "");

    if (!text) {
      continue;
    }

    const speaker: PodcastSpeaker =
      params.speakerCount === 1 ? "a" : turn.speaker === "b" ? "b" : "a";
    const previous = merged[merged.length - 1];

    if (params.speakerCount === 2 && previous && previous.speaker === speaker) {
      previous.text = `${previous.text} ${text}`;
      continue;
    }

    merged.push({ speaker, text });
  }

  return merged.flatMap((turn) =>
    splitLongTurn(turn.text).map((text) => ({ speaker: turn.speaker, text })),
  );
}

export function parseStoredTurns(value: unknown): PodcastTurn[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") {
      return [];
    }

    const speaker = (entry as { speaker?: unknown }).speaker;
    const text = (entry as { text?: unknown }).text;

    return typeof text === "string" && text.length > 0
      ? [{ speaker: speaker === "b" ? ("b" as const) : ("a" as const), text }]
      : [];
  });
}

/**
 * One line of subtitle: what is being said, and when.
 *
 * Timed against the turn's own audio, so the player only has to compare the element's
 * currentTime against these — no second clock, and nothing to drift.
 */
export type PodcastCue = {
  text: string;
  startMs: number;
  endMs: number;
};

/**
 * How much of a turn is on screen at once.
 *
 * These are captions rather than broadcast subtitles: a few words appear, hold for as long as
 * they are being said, and are replaced by the next few. That is a different object from a
 * 42-character line of a sentence, and it wants different numbers — small enough that the eye
 * takes the whole burst without moving, which is what makes it readable at a glance rather than
 * something to be read.
 *
 * The character cap does the real work, because a burst of four Slovenian words is not the same
 * width as four English ones.
 */
const CUE_MAX_WORDS = 4;
const CUE_MAX_CHARS = 26;

/**
 * The shortest a burst may stay up, and the longest.
 *
 * A burst that flashes is unreadable however correct its timing, and with bursts this small that
 * is a real risk rather than a theoretical one: "In?" is a whole caption and a fifth of a second
 * of audio. So the floor is enforced by NOT closing a burst that has not been up long enough —
 * the next words join it instead. Padding the end was tried first and cannot work here, because
 * the following burst starts the moment this one stops being spoken; there is no gap to borrow.
 *
 * The ceiling is the opposite failure: a listener glancing up should never be reading words whose
 * audio finished seconds ago.
 */
const CUE_MIN_MS = 850;
const CUE_MAX_MS = 4_000;

/** Ends a line: the reader gets a complete thought rather than a fragment. */
const SENTENCE_END = /[.!?…]$/u;
const CLAUSE_END = /[,;:—-]$/u;

/** Compared to decide whether a spoken piece is the same word as one in the script. */
function normalizeWord(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{Mark}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

/**
 * Puts the synthesizer's timings onto the words the script actually says.
 *
 * The timings cannot simply be used as the subtitle text, which is what this originally did, and
 * it was wrong in a way that only showed up on a real episode: the first cue of a turn beginning
 * "Danes gre za osnove…" came back reading "es gre za osnove…". The stream drops a few leading
 * characters from its timestamps — the audio is complete, the timing report is not — and anything
 * built from the report inherits the hole.
 *
 * So the report is used for WHEN, and the script for WHAT. A word the report never mentioned
 * still gets a place: its timing is interpolated from the neighbours that were reported, which is
 * how read-aloud has always handled the same gap.
 */
export function alignPodcastWords(
  text: string,
  pieces: ReadonlyArray<{ text: string; start_ms: number; end_ms: number }>,
): PodcastCue[] {
  const words = stripAudioTags(text).split(/\s+/u).filter(Boolean);

  if (words.length === 0) {
    return [];
  }

  const spoken = pieces.filter((piece) => normalizeWord(piece.text).length > 0);
  const timed: Array<{ text: string; startMs: number | null; endMs: number | null }> = words.map(
    (word) => ({ text: word, startMs: null, endMs: null }),
  );

  let pieceIndex = 0;

  for (let wordIndex = 0; wordIndex < words.length && pieceIndex < spoken.length; wordIndex += 1) {
    const word = normalizeWord(words[wordIndex]);

    if (!word) {
      continue;
    }

    /*
     * A short lookahead rather than a strict match. The report can drop a word as well as the
     * head of one, and a single miss must not throw the rest of the turn out of step.
     */
    for (let ahead = 0; ahead < 3 && pieceIndex + ahead < spoken.length; ahead += 1) {
      const candidate = normalizeWord(spoken[pieceIndex + ahead].text);

      if (candidate === word || candidate.endsWith(word) || word.endsWith(candidate)) {
        timed[wordIndex].startMs = spoken[pieceIndex + ahead].start_ms;
        timed[wordIndex].endMs = spoken[pieceIndex + ahead].end_ms;
        pieceIndex += ahead + 1;
        break;
      }
    }
  }

  /* Every word that was never matched sits between two that were, and is placed between them. */
  const known = timed.filter((word) => word.startMs !== null);

  if (known.length === 0) {
    return [];
  }

  const firstStart = known[0].startMs ?? 0;
  const lastEnd = known[known.length - 1].endMs ?? firstStart;

  for (let index = 0; index < timed.length; index += 1) {
    if (timed[index].startMs !== null) {
      continue;
    }

    let before = index - 1;
    while (before >= 0 && timed[before].endMs === null) before -= 1;
    let after = index + 1;
    while (after < timed.length && timed[after].startMs === null) after += 1;

    const from = before >= 0 ? (timed[before].endMs as number) : firstStart;
    const to = after < timed.length ? (timed[after].startMs as number) : lastEnd;
    const gap = Math.max(0, to - from);
    const share = gap / Math.max(1, after - before);

    timed[index].startMs = Math.round(from + share * (index - before - 1));
    timed[index].endMs = Math.round(from + share * (index - before));
  }

  return timed.map((word) => ({
    text: word.text,
    startMs: word.startMs as number,
    endMs: Math.max(word.endMs as number, word.startMs as number),
  }));
}

/**
 * Turns the synthesizer's per-word timings into captions.
 *
 * A few words appear, hold while they are being spoken, and are replaced by the next few. Two
 * things decide where one burst ends and the next begins, and they pull against each other:
 *
 *   - it should be SMALL, so the eye takes it whole — four words, twenty-six characters;
 *   - it should not FLASH, so it must have been on screen long enough to read.
 *
 * When those disagree the second wins, and the burst simply takes more words. Padding a short
 * burst's end instead does not work here and it is worth saying why: the next burst starts the
 * instant this one stops being spoken, so there is no gap to borrow from — holding it would put
 * two captions on screen at once. Growing the burst is the only move that has both properties.
 *
 * A sentence ending still closes a burst where it can, because a caption that runs across a full
 * stop reads as one thought when it is two.
 */
export function buildPodcastCues(
  text: string,
  pieces: ReadonlyArray<{ text: string; start_ms: number; end_ms: number }>,
): PodcastCue[] {
  return groupWordsIntoCues(alignPodcastWords(text, pieces));
}

/**
 * Groups timed words into captions.
 *
 * Separate from the alignment above, and stored separately, because the two have very different
 * lifetimes. What the synthesizer said and when is a fact about audio that was paid for once and
 * never changes. How those words are cut into captions is a judgement that has already been
 * revised twice — and while the cuts were what got stored, revising them left every episode that
 * already existed showing the old ones for ever, with nothing short of re-synthesis to fix it.
 *
 * So the words are the durable artifact and the captions are a view, recomputed on every read.
 */
export function groupWordsIntoCues(timedWords: ReadonlyArray<PodcastCue>): PodcastCue[] {
  const cues: PodcastCue[] = [];
  let words: PodcastCue[] = [];

  const width = () => words.reduce((sum, word) => sum + word.text.length + 1, 0) - 1;
  const span = () => (words.length === 0 ? 0 : words[words.length - 1].endMs - words[0].startMs);

  const flush = () => {
    if (words.length === 0) {
      return;
    }

    cues.push({
      text: words.map((word) => word.text).join(" "),
      startMs: words[0].startMs,
      endMs: Math.max(words[words.length - 1].endMs, words[0].startMs + 1),
    });
    words = [];
  };

  for (const piece of timedWords) {
    if (!piece.text.trim()) {
      continue;
    }

    words.push(piece);

    const full = words.length >= CUE_MAX_WORDS || width() >= CUE_MAX_CHARS;
    const readable = span() >= CUE_MIN_MS;
    const overlong = span() >= CUE_MAX_MS;
    const ends = SENTENCE_END.test(piece.text) || CLAUSE_END.test(piece.text);

    /*
     * Close on a boundary or a full burst, but only once it has been readable — except when it
     * has run long, which is its own failure and ends the burst whatever else is true.
     */
    if (overlong || ((full || ends) && readable)) {
      flush();
    }
  }

  flush();

  /*
   * The last burst of a turn has no successor to crowd it, so it alone can be held: it stays up
   * until the audio stops rather than vanishing on the final syllable.
   */
  return cues.map((cue, index) =>
    index === cues.length - 1
      ? { ...cue, endMs: Math.max(cue.endMs, cue.startMs + CUE_MIN_MS) }
      : cue,
  );
}

/** The line to show at this point in a turn, or null before the first word is spoken. */
export function cueAt(cues: ReadonlyArray<PodcastCue>, positionMs: number): PodcastCue | null {
  let current: PodcastCue | null = null;

  for (const cue of cues) {
    if (cue.startMs > positionMs) {
      break;
    }

    current = cue;
  }

  /* Past the end of a line with no successor yet, the last one stays rather than blanking. */
  return current;
}

export function parseStoredCues(value: unknown): PodcastCue[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") {
      return [];
    }

    const { text, startMs, endMs } = entry as Record<string, unknown>;

    return typeof text === "string" && typeof startMs === "number" && typeof endMs === "number"
      ? [{ text, startMs, endMs }]
      : [];
  });
}
