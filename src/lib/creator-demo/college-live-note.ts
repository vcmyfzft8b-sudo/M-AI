/**
 * The script the `/creator/college` live-recording takeover types out.
 *
 * It is built from the very note the demo's record flow creates
 * (`DEMO_CREATE_PACKS.record`), so the note a creator watches being written is
 * the note that opens when they stop the recording — same markdown, same
 * figures, in the same order.
 *
 * Nothing here is generated at runtime and nothing is transcribed: this is a
 * scripted playback for video, and it only exists under `/creator/college`.
 */
import { DEMO_CREATE_PACKS, getDemoNotePack } from "@/lib/creator-demo/content";

export type LiveNoteSegment =
  | { kind: "markdown"; text: string }
  | { kind: "figure"; src: string; alt: string; fileName: string; widthPercent: number };

const RECORD_PACK_KEY = DEMO_CREATE_PACKS.record[0];

/**
 * Where each figure drops in during the live write-up.
 *
 * The finished note anchors its figures to the sections that explain them; a
 * recording cannot wait that long, so the takeover pulls both forward to the
 * opening of the note. Keyed by the figure's file, and an entry that no longer
 * matches falls back to the pack's own anchor.
 */
const EARLY_FIGURE_ANCHORS: Record<string, string> = {
  "ponudba-povprasevanje.svg": "Ko se spremeni katerikoli dejavnik razen cene",
  "elasticnost.svg": "Elastičnost meri občutljivost količine na spremembo cene",
};

/**
 * Splits the note markdown at each figure's anchor phrase, so a figure lands
 * under the paragraph it belongs to. An anchor that no longer matches is
 * dropped rather than silently moving its figure.
 */
function buildSegments(): LiveNoteSegment[] {
  const pack = getDemoNotePack(RECORD_PACK_KEY);
  const anchors = pack.images
    .map((image) => {
      const earlyAnchor = EARLY_FIGURE_ANCHORS[image.file];
      const earlyIndex = earlyAnchor ? pack.notesMd.indexOf(earlyAnchor) : -1;

      return {
        image,
        index: earlyIndex >= 0 ? earlyIndex : pack.notesMd.indexOf(image.afterText),
        anchorLength: earlyIndex >= 0 ? earlyAnchor!.length : image.afterText.length,
      };
    })
    .filter((entry) => entry.index >= 0)
    .sort((a, b) => a.index - b.index);

  const segments: LiveNoteSegment[] = [];
  let cursor = 0;

  for (const { image, index, anchorLength } of anchors) {
    // Cut at the end of the paragraph the anchor phrase belongs to, so the
    // figure never lands mid-sentence.
    const paragraphEnd = pack.notesMd.indexOf("\n\n", index + anchorLength);
    const cut = paragraphEnd === -1 ? pack.notesMd.length : paragraphEnd;

    segments.push({ kind: "markdown", text: pack.notesMd.slice(cursor, cut) });
    segments.push({
      kind: "figure",
      src: `/creator-demo/${image.file}`,
      alt: image.alt,
      fileName: image.fileName,
      widthPercent: image.widthPercent ?? 100,
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
export const LIVE_NOTE_STATUS_STEPS = [
  "Poslušam predavanje",
  "Razumem povedano",
  "Pišem zapiske",
  "Dodajam sliko",
  "Urejam strukturo",
  "Pripravljam kartice",
] as const;
