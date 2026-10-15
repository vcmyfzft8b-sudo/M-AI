// Relative imports only: tests load this outside Next (tests/tutor-speech-pieces.test.mjs).
import type { SpeechCharacterTimings } from "./turn-audio.ts";

/**
 * How a turn's streaming text is cut into the pieces Gemini speaks, and how a piece's audio is
 * mapped back onto its characters.
 *
 * Soniox took text as it was written, a word at a time, down one socket. Gemini's speech model
 * takes a whole request and answers with audio, so the turn is said as a run of requests, each a
 * sentence or a few — and where the cuts fall decides two things a learner hears. The first piece
 * is the wait before the tutor starts talking, so it is cut at the first sentence end. Every later
 * piece is spoken while the one before it plays, so those wait for whole sentences: a cut in the
 * middle of one is a cut in its melody, because each request is voiced on its own.
 */

/** Short enough that the tutor starts quickly; long enough not to say "Dobro." on its own. */
const MIN_FIRST_PIECE_CHARS = 12;
/** A first sentence that runs on is cut at a comma rather than waited for. */
const FIRST_PIECE_FORCE_CHARS = 140;
/** Long pieces take longer to start and lose more when a request fails. */
export const MAX_PIECE_CHARS = 420;

const LETTER = /\p{Letter}/u;
const AUDIO_TAG = /\[[^\]]{0,40}\]/gu;

/** Whether a piece has anything to say. A lone `[laughs]` or `…` is not worth a request. */
export function hasSpeakableText(text: string) {
  return LETTER.test(text.replace(AUDIO_TAG, " "));
}

/**
 * Where each sentence in `text` ends, as the index just past its closing punctuation and quotes.
 *
 * A full stop only ends a sentence when what follows it starts a new one: a capital, a digit, a
 * quote, a tag, or the end of a final buffer. "npr. kisik" and "2. svetovna vojna" carry on, and
 * a stop with nothing after it yet is not trusted until the next word shows which it was — one
 * token of waiting, against reading an abbreviation as the end of a thought. A number can end a
 * sentence ("leta 1990. Nato…"), and the capital that follows is what tells it from an ordinal.
 */
function sentenceEnds(text: string, final: boolean) {
  const ends: number[] = [];
  const pattern = /[.!?…]+["'»”’)\]]*(?=\s)|\n/gu;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text))) {
    const end = match.index + match[0].length;

    if (match[0] === "\n") {
      ends.push(end);
      continue;
    }

    const after = text.slice(end).trimStart();

    if (!after) {
      if (final) {
        ends.push(end);
      }
      continue;
    }

    if (match[0].startsWith(".") && !/^[\p{Lu}\d"'«„“[(]/u.test(after)) {
      continue;
    }

    ends.push(end);
  }

  return ends;
}

/** The last place a long run of words can be cut without splitting one: a clause, else a space. */
function softCut(text: string, limit: number) {
  const window = text.slice(0, limit);
  const clause = Math.max(window.lastIndexOf(", "), window.lastIndexOf("; "), window.lastIndexOf(": "));

  if (clause > limit / 3) {
    return clause + 1;
  }

  const space = window.lastIndexOf(" ");

  return space > 0 ? space : limit;
}

export type SpeechPieceCut = { piece: string; rest: string };

/**
 * The next piece to send for synthesis, or null to wait for more text.
 *
 * `first` is the turn's opening piece, which is cut as early as a sentence allows. `flush` sends
 * everything that is there — the writer has finished, or has gone quiet long enough that waiting
 * for the end of the sentence would be a silence the learner hears.
 */
export function nextSpeechPiece(
  buffer: string,
  options: { first: boolean; flush: boolean },
): SpeechPieceCut | null {
  if (!buffer.trim()) {
    return null;
  }

  const take = (end: number): SpeechPieceCut | null => {
    const piece = buffer.slice(0, end);

    /* A tag or a dot on its own rides along with what follows rather than costing a request. */
    if (!hasSpeakableText(piece)) {
      return null;
    }

    return { piece, rest: buffer.slice(end) };
  };

  const ends = sentenceEnds(buffer, options.flush);

  if (options.first) {
    for (const end of ends) {
      if (end > MAX_PIECE_CHARS) {
        break;
      }

      if (buffer.slice(0, end).trim().length >= MIN_FIRST_PIECE_CHARS) {
        const cut = take(end);

        if (cut) {
          return cut;
        }
      }
    }
  } else {
    const within = ends.filter((end) => end <= MAX_PIECE_CHARS);

    for (let index = within.length - 1; index >= 0; index -= 1) {
      const cut = take(within[index]);

      if (cut) {
        return cut;
      }
    }
  }

  if (buffer.length > (options.first ? FIRST_PIECE_FORCE_CHARS : MAX_PIECE_CHARS)) {
    const cut = take(softCut(buffer, options.first ? FIRST_PIECE_FORCE_CHARS : MAX_PIECE_CHARS));

    if (cut) {
      return cut;
    }
  }

  if (options.flush) {
    if (buffer.length > MAX_PIECE_CHARS) {
      return take(softCut(buffer, MAX_PIECE_CHARS)) ?? { piece: buffer, rest: "" };
    }

    return hasSpeakableText(buffer) ? { piece: buffer, rest: "" } : null;
  }

  return null;
}

/*
 * How long each character takes, relative to a letter. Gemini reports no timestamps, so the
 * record of what was heard is spread over a piece's audio by these weights: a comma and a full
 * stop are where a speaker pauses, and a tag is a sound rather than a word.
 */
function characterWeight(character: string): number {
  if (/[.!?…]/u.test(character)) {
    return 4;
  }

  if (/[,;:]/u.test(character)) {
    return 2.5;
  }

  return 1;
}

/** Speech runs at about twelve characters a second; a piece still arriving is assumed to. */
export const ESTIMATED_CHARACTERS_PER_SECOND = 12;

/**
 * Character timings for one spoken piece, spread over the audio it produced.
 *
 * The cut this feeds is the word the learner was on when they interrupted, so it has to be right
 * to within a word rather than a syllable — which an even spread by weight gets, since one piece
 * is one or two sentences said at one pace. A piece whose audio is still arriving is spread over
 * the longer of what has arrived and what its length predicts, so the cut errs towards "not yet
 * said" rather than claiming words the speaker has not reached.
 */
export function spreadPieceTimings(
  timings: SpeechCharacterTimings,
  piece: { text: string; offsetSeconds: number; durationSeconds: number; complete: boolean },
) {
  const characters = Array.from(piece.text);
  const tagged = new Set<number>();

  for (const match of piece.text.matchAll(AUDIO_TAG)) {
    const start = Array.from(piece.text.slice(0, match.index)).length;
    const length = Array.from(match[0]).length;

    for (let index = start; index < start + length; index += 1) {
      tagged.add(index);
    }
  }

  const weights = characters.map((character, index) => (tagged.has(index) ? 0 : characterWeight(character)));
  const total = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  const estimated = total / ESTIMATED_CHARACTERS_PER_SECOND;
  const duration = piece.complete
    ? piece.durationSeconds
    : Math.max(piece.durationSeconds, estimated);
  let elapsed = 0;

  for (let index = 0; index < characters.length; index += 1) {
    const length = (weights[index] / total) * duration;

    timings.characters.push(characters[index]);
    timings.startSeconds.push(piece.offsetSeconds + elapsed);
    timings.endSeconds.push(piece.offsetSeconds + elapsed + length);
    elapsed += length;
  }

  return timings;
}
