// Relative imports only: scripts/generate-creator-demo-read-aloud.mjs and the tests load this
// outside Next.
import type { TtsAlignmentWord } from "../note-tts-alignment.ts";
import CLIPS from "./read-aloud-clips.json" with { type: "json" };

/**
 * The opening of every `/creator` demo note, read aloud in the app's real voice.
 *
 * The demo has no account and no key, so it cannot synthesize anything; until 2026-10-15 its
 * read-aloud played silence and moved the highlight at a guessed pace. Now the first minute or so of
 * each note — its first few chunks, in each demo language — is pre-rendered in the default voice
 * (Grace, which Gemini speaks as Kore) by scripts/generate-creator-demo-read-aloud.mjs, with the
 * word timings transcribed from the clip the same way read-aloud times its own. The full notes
 * would be about 70 MB of audio; the opening is what a visitor actually listens to.
 *
 * Each clip is keyed by a hash of the exact chunk text it says. A visitor can edit a demo note, and
 * a clip that no longer matches the words on screen is worse than none, so a changed chunk falls
 * back to the silent reading — as does any chunk past the recorded opening.
 */

export const DEMO_READ_ALOUD_VERSION = "kore-2026-10";

export type DemoReadAloudClip = {
  chunkIndex: number;
  /** `demoReadAloudKey` of the chunk text the clip says. */
  key: string;
  durationMs: number;
  alignment: TtsAlignmentWord[];
};

type Manifest = {
  voice: string;
  clips: Record<string, Record<string, DemoReadAloudClip[]>>;
};

const MANIFEST = CLIPS as Manifest;

/** FNV-1a, 32-bit, over UTF-16 units: small, synchronous, and the same in the browser and the script. */
export function demoReadAloudKey(text: string) {
  let hash = 0x811c9dc5;

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash.toString(16).padStart(8, "0");
}

export function demoReadAloudClipPath(locale: string, lectureId: string, chunkIndex: number) {
  return `/creator-demo/read-aloud/${locale}/${lectureId}-${chunkIndex}.mp3?v=${DEMO_READ_ALOUD_VERSION}`;
}

/** The recorded clip for this chunk, or null when there is none or the note has been edited since. */
export function findDemoReadAloudClip(params: {
  locale: string;
  lectureId: string;
  chunkIndex: number;
  chunkText: string;
}) {
  const clip = MANIFEST.clips[params.locale]?.[params.lectureId]?.find(
    (candidate) => candidate.chunkIndex === params.chunkIndex,
  );

  return clip && clip.key === demoReadAloudKey(params.chunkText) ? clip : null;
}

/**
 * How many chunks of this note the demo reads: the recorded opening, as long as it still matches
 * the note from its first chunk on. A note edited at the top has no usable recording and is read
 * in full, silently, as before.
 */
export function demoReadAloudChunkCount(params: {
  locale: string;
  lectureId: string;
  chunkTexts: string[];
}) {
  let count = 0;

  while (
    count < params.chunkTexts.length &&
    findDemoReadAloudClip({
      locale: params.locale,
      lectureId: params.lectureId,
      chunkIndex: count,
      chunkText: params.chunkTexts[count],
    })
  ) {
    count += 1;
  }

  return count > 0 ? count : params.chunkTexts.length;
}
