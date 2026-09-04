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
 * How wide a subtitle line is allowed to be.
 *
 * Broadcast subtitling settles around 37-42 characters a line because that is about what the eye
 * takes in one movement; past it a reader is scanning rather than glancing, which is the opposite
 * of what a subtitle is for. This app's line wraps on a phone at roughly the same width.
 */
const CUE_MAX_CHARS = 42;

/**
 * The shortest a line may stay up, and the longest.
 *
 * A cue that flashes is unreadable however correct its timing, so a very short phrase is held on
 * until the next one needs the space. The ceiling is the other failure — a listener who looked
 * away and came back should not be reading a line whose audio finished four seconds ago.
 */
const CUE_MIN_MS = 900;
const CUE_MAX_MS = 6_000;

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
 * Turns the synthesizer's per-word timings into subtitle lines.
 *
 * The break is chosen the way a subtitler chooses it, best first: at a sentence end, then at a
 * clause boundary, and only failing both at the word that would have overflowed. Breaking purely
 * on width is what produces the subtitle that ends mid-preposition and reads as a fault.
 */
export function buildPodcastCues(
  text: string,
  pieces: ReadonlyArray<{ text: string; start_ms: number; end_ms: number }>,
): PodcastCue[] {
  const timedWords = alignPodcastWords(text, pieces);
  const cues: PodcastCue[] = [];
  let words: PodcastCue[] = [];

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

    const width = words.reduce((sum, word) => sum + word.text.length + 1, 0) + piece.text.length;
    const span = words.length > 0 ? piece.endMs - words[0].startMs : 0;

    if (words.length > 0 && (width > CUE_MAX_CHARS || span > CUE_MAX_MS)) {
      flush();
    }

    words.push(piece);

    const last = words[words.length - 1].text;
    const wideEnough = words.reduce((sum, word) => sum + word.text.length + 1, 0) > CUE_MAX_CHARS * 0.5;

    /* A sentence always ends a line; a clause only once the line is worth ending. */
    if (SENTENCE_END.test(last) || (wideEnough && CLAUSE_END.test(last))) {
      flush();
    }
  }

  flush();

  /*
   * Nothing may flash. A line shorter than the floor borrows from the gap before the next one,
   * and the last line simply holds until the audio stops.
   */
  return cues.map((cue, index) => {
    const next = cues[index + 1];
    const wanted = cue.startMs + CUE_MIN_MS;

    return {
      ...cue,
      endMs: Math.max(cue.endMs, next ? Math.min(wanted, next.startMs) : wanted),
    };
  });
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
