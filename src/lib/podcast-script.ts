// How a written script becomes a list of turns the player and the synthesizer can both use.
//
// Kept free of "server-only", and imported relatively, so the rules below stay unit-testable
// (tests/podcast-script.test.mjs). Every one of them exists because the failure it prevents is
// silent: nothing here throws, it just plays wrong.

import { speakableMath } from "./note-tts-text.ts";
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
 * Words long enough to be a term somebody will be examined on.
 *
 * Six characters, which is a threshold rather than a rule: it keeps "povezavni", "protokol" and
 * "naslavljanje" and lets go of "kabel", "bile" and "štiri", where the checker's inflection
 * fixes are usually right and the material's spelling carries no authority anyway.
 */
const TERM_MIN_LENGTH = 6;

/**
 * A term reduced to its first six characters, because these languages inflect.
 *
 * The lecture says "povezavna plast" and the turn says "povezavni plasti", and comparing whole
 * words would call those two different terms and protect neither. Six characters is enough to
 * keep the ones that matter apart — "poveza" against the checker's "povezo" and "podatk" — and
 * a collision only ever means an edit is allowed through, which is the failure that costs less.
 */
function terms(text: string) {
  return new Set(
    (text.toLowerCase().match(/\p{L}[\p{L}\p{N}-]*/gu) ?? [])
      .filter((word) => word.length >= TERM_MIN_LENGTH)
      .map((word) => word.slice(0, TERM_MIN_LENGTH)),
  );
}

/**
 * Whether a proofread turn still uses the words the material used.
 *
 * The language checker is a second model that sees one turn and the one before it, and nothing
 * else — deliberately, because handing it the topic made its edits worse (see
 * buildLanguageRepairInput). The cost of that blindness is that it cannot tell a subject term
 * from a misspelling. Measured on the omrezja-sl fixture: it changed "povezavni" to
 * "povezovalni" in one turn and to "podatkovni" in another, both times confidently, and
 * "povezavna plast" is what the lecture calls it and what the exam will call it.
 *
 * So the material decides. A correction that drops a long word the source itself uses is
 * refused whole — not patched, because the checker's other edits in that turn were made in the
 * belief that this one was going in too, and half a repair is not a repair. Every other kind of
 * fix is untouched: the guard only fires when a word the lecture actually contains has gone
 * missing from the sentence that had it.
 */
export function keepsSourceTerms(original: string, corrected: string, source: string) {
  const sourceTerms = terms(source);

  if (sourceTerms.size === 0) {
    return true;
  }

  const kept = terms(corrected);

  for (const word of terms(original)) {
    if (sourceTerms.has(word) && !kept.has(word)) {
      return false;
    }
  }

  return true;
}
