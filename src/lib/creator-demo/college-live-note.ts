/**
 * The script the `/creator/college` live-recording takeover types out.
 *
 * It is built from the very note the demo's record flow creates
 * (`DEMO_CREATE_PACKS.record`), so the note a creator watches being written is
 * the note that opens when they stop the recording — same markdown, in the same
 * order.
 *
 * Figures and highlights are the one deliberate difference. The finished note
 * carries two figures anchored to the sections that explain them; a recording
 * wants more of them, sooner, so this module adds college-only figures and
 * pulls them all forward. None of that touches the shared content pack, so
 * `/creator` is unaffected.
 *
 * It is written in the reader's language, like the rest of the demo.
 *
 * Nothing here is generated at runtime and nothing is transcribed: this is a
 * scripted playback for video, and it only exists under `/creator/college`.
 */
import type { Locale } from "@/lib/i18n/locales";
import type { MessageKey } from "@/lib/i18n/messages/keys";

import {
  DEMO_CREATE_PACKS,
  getDemoContent,
  getDemoNotePack,
  type DemoLocaleContent,
} from "@/lib/creator-demo/content";

export type LiveNoteSegment =
  | { kind: "markdown"; text: string }
  | { kind: "figure"; src: string; alt: string; fileName: string; widthPercent: number };

const RECORD_PACK_KEY = DEMO_CREATE_PACKS.record[0];

/**
 * The figures and highlights themselves are per language (`liveFigures` and
 * `liveHighlights` in `./locales`), because both are anchored to phrases in
 * the note's own text.
 *
 * Figures: every figure the write-up shows, in note order. The first two are
 * the pack's own, re-anchored to the opening so a short clip still catches
 * one; the rest exist only here, so a long take keeps getting something new to
 * land. Seven across the note means roughly one every section.
 *
 * Highlights: phrases the app marks as it writes them, with the colour it
 * reaches for. Matched against the rendered text, so a highlight can only
 * appear once its phrase is fully written — which is what makes it read as the
 * app deciding that line mattered, rather than as formatting that was always
 * there. Kept deliberately short — eight lines across the whole note. A
 * marked-up page only reads as "these are the bits that matter" while most of
 * it is unmarked. Two colours carry the distinction: green for what a thing
 * *is* (definitions, conditions) and purple for what it *does* (mechanisms and
 * the exam traps). Every phrase occurs exactly once in its language's note
 * (`tests/creator-demo-locales.test.mjs`), so none can mis-mark or go missing.
 */
export type LiveNoteScript = {
  title: string;
  segments: LiveNoteSegment[];
  highlights: DemoLocaleContent["liveHighlights"];
  /** Total characters of markdown, so the typing engine can report progress. */
  totalChars: number;
};

/**
 * Splits the note markdown at each figure's anchor phrase, so a figure lands
 * under the paragraph it belongs to. An anchor that no longer matches is
 * dropped rather than silently moving its figure.
 */
function buildSegments(locale: Locale): LiveNoteSegment[] {
  const pack = getDemoNotePack(RECORD_PACK_KEY, locale);
  const anchors = getDemoContent(locale)
    .liveFigures.map((figure) => ({
      figure,
      index: pack.notesMd.indexOf(figure.anchor),
    }))
    .filter((entry) => entry.index >= 0)
    .sort((a, b) => a.index - b.index);

  const segments: LiveNoteSegment[] = [];
  let cursor = 0;

  for (const { figure, index } of anchors) {
    // Cut at the end of the paragraph the anchor phrase belongs to, so the
    // figure never lands mid-sentence.
    const paragraphEnd = pack.notesMd.indexOf("\n\n", index + figure.anchor.length);
    const cut = paragraphEnd === -1 ? pack.notesMd.length : paragraphEnd;

    if (cut <= cursor) {
      continue;
    }

    segments.push({ kind: "markdown", text: pack.notesMd.slice(cursor, cut) });
    segments.push({
      kind: "figure",
      src: `/creator-demo/${figure.file}`,
      alt: figure.alt,
      fileName: figure.fileName,
      widthPercent: 100,
    });

    cursor = cut;
  }

  segments.push({ kind: "markdown", text: pack.notesMd.slice(cursor) });

  return segments.filter(
    (segment) => segment.kind !== "markdown" || segment.text.trim().length > 0,
  );
}

const scripts = new Map<Locale, LiveNoteScript>();

/** The write-up in `locale`, built once per language and then reused. */
export function getLiveNoteScript(locale: Locale): LiveNoteScript {
  const cached = scripts.get(locale);

  if (cached) {
    return cached;
  }

  const segments = buildSegments(locale);
  const script: LiveNoteScript = {
    title: getDemoNotePack(RECORD_PACK_KEY, locale).title,
    segments,
    highlights: getDemoContent(locale).liveHighlights,
    totalChars: segments.reduce(
      (total, segment) => total + (segment.kind === "markdown" ? segment.text.length : 0),
      0,
    ),
  };

  scripts.set(locale, script);
  return script;
}

/**
 * Captions under the wave, replayed on a loop so the stage always reads as
 * "the app is working on it" rather than sitting still.
 */
/** Keys, not sentences: the recording pane renders these in the reader's language. */
export const LIVE_NOTE_STATUS_STEP_KEYS = [
  "creatorDemo.liveStepListening",
  "creatorDemo.liveStepUnderstanding",
  "creatorDemo.liveStepWriting",
  "creatorDemo.liveStepFigure",
  "creatorDemo.liveStepHighlighting",
  "creatorDemo.liveStepCards",
] as const satisfies readonly MessageKey[];
