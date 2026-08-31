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
 * Nothing here is generated at runtime and nothing is transcribed: this is a
 * scripted playback for video, and it only exists under `/creator/college`.
 */
import type { MessageKey } from "@/lib/i18n/messages/keys";

import { DEMO_CREATE_PACKS, getDemoNotePack } from "@/lib/creator-demo/content";

export type LiveNoteSegment =
  | { kind: "markdown"; text: string }
  | { kind: "figure"; src: string; alt: string; fileName: string; widthPercent: number };

const RECORD_PACK_KEY = DEMO_CREATE_PACKS.record[0];

type LiveFigure = {
  file: string;
  fileName: string;
  alt: string;
  /** A distinctive phrase; the figure lands at the end of that paragraph. */
  anchor: string;
};

/**
 * Every figure the write-up shows, in note order. The first two are the pack's
 * own, re-anchored to the opening so a short clip still catches one; the rest
 * exist only here, so a long take keeps getting something new to land. Seven
 * across the note means roughly one every section.
 */
const LIVE_FIGURES: LiveFigure[] = [
  {
    file: "ponudba-povprasevanje.svg",
    fileName: "graf-ravnovesje.png",
    alt: "Graf ponudbe in povpraševanja z ravnovesno točko",
    anchor: "Ko se spremeni katerikoli dejavnik razen cene",
  },
  {
    file: "elasticnost.svg",
    fileName: "elasticnost-primerjava.png",
    alt: "Primerjava elastičnega in neelastičnega povpraševanja",
    anchor: "Elastičnost meri občutljivost količine na spremembo cene",
  },
  {
    file: "premik-krivulje.svg",
    fileName: "premik-povprasevanja.png",
    alt: "Premik krivulje povpraševanja v desno in novo ravnovesje",
    anchor: "Krivulja povpraševanja pada, ker vsaka dodatna enota",
  },
  {
    file: "substituti-komplementi.svg",
    fileName: "substituti-in-komplementi.png",
    alt: "Substituti se nadomeščata, komplementa se uporabljata skupaj",
    anchor: "dobrini, ki se med seboj nadomeščata",
  },
  {
    file: "premik-ponudbe.svg",
    fileName: "premik-ponudbe.png",
    alt: "Premik krivulje ponudbe v desno zaradi nižjih stroškov",
    anchor: "Stroški dela in surovin premaknejo krivuljo ponudbe",
  },
  {
    file: "presezek-primanjkljaj.svg",
    fileName: "presezek-in-primanjkljaj.png",
    alt: "Presežek ponudbe nad ravnovesno ceno in primanjkljaj pod njo",
    anchor: "Če je cena previsoka, ostane blago neprodano",
  },
  {
    file: "prihodek-elasticnost.svg",
    fileName: "prihodek-in-elasticnost.png",
    alt: "Skupni prihodek je najvišji tam, kjer je elastičnost enaka 1",
    anchor: "Kadar je rezultat po absolutni vrednosti večji od 1",
  },
];

export type LiveHighlightColor = "green" | "purple";

/**
 * Phrases the app marks as it writes them, with the colour it reaches for.
 *
 * Matched against the rendered text, so a highlight can only appear once its
 * phrase is fully written — which is what makes it read as the app deciding
 * that line mattered, rather than as formatting that was always there.
 *
 * Kept deliberately short — eight lines across the whole note. A marked-up page
 * only reads as "these are the bits that matter" while most of it is unmarked;
 * past that it just looks like decoration.
 *
 * Two colours carry the distinction: green for what a thing *is* (definitions,
 * conditions) and purple for what it *does* (mechanisms and the exam traps).
 * Every phrase is verified to occur exactly once in the pack's markdown, so
 * none of them can silently mis-mark or go missing.
 */
export const LIVE_NOTE_HIGHLIGHTS: Array<{ phrase: string; color: LiveHighlightColor }> = [
  { phrase: "Ta točka je tržno ravnovesje", color: "green" },
  { phrase: "Cena ne premakne krivulje", color: "purple" },
  { phrase: "Povpraševana količina je količina pri eni sami ceni", color: "green" },
  {
    phrase: "Ravnovesje je edina cena, pri kateri ni ne presežka ne primanjkljaja",
    color: "green",
  },
  { phrase: "Premik po krivulji sproži samo sprememba cene", color: "purple" },
  { phrase: "malo substitutov, kratek rok, nujne dobrine", color: "green" },
  { phrase: "prihodek je največji tam, kjer je elastičnost enaka 1", color: "purple" },
  {
    phrase:
      "Najpogostejša napaka na izpitu je zamenjava premika krivulje s premikom po krivulji",
    color: "purple",
  },
];

/**
 * Splits the note markdown at each figure's anchor phrase, so a figure lands
 * under the paragraph it belongs to. An anchor that no longer matches is
 * dropped rather than silently moving its figure.
 */
function buildSegments(): LiveNoteSegment[] {
  const pack = getDemoNotePack(RECORD_PACK_KEY);
  const anchors = LIVE_FIGURES.map((figure) => ({
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

export const LIVE_NOTE_SEGMENTS = buildSegments();

export const LIVE_NOTE_TITLE = getDemoNotePack(RECORD_PACK_KEY).title;

/** Total characters of markdown, so the typing engine can report progress. */
export const LIVE_NOTE_TOTAL_CHARS = LIVE_NOTE_SEGMENTS.reduce(
  (total, segment) => total + (segment.kind === "markdown" ? segment.text.length : 0),
  0,
);

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
