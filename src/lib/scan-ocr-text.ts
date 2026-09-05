import { stripUnstorableCharacters } from "./database-text.ts";

/**
 * Why a photo's reading was turned down.
 *
 * The two cases need opposite advice, so they are kept apart all the way to the learner's screen.
 * `unreadable` is the photo: nothing legible came back, or the model answered that it could not
 * read it, and the fix is a better photo. `too_short` is the material: the reading worked and
 * simply found very little on the page, and the fix is more pages — telling that learner their
 * photo was unreadable sends them to retake a picture that was never the problem.
 */
export type ScanOcrRejection = "too_short" | "unreadable";

/**
 * Below this, a reading is too thin to build notes from. Held here rather than in the pipeline
 * because the number only means anything next to the rules that surround it.
 */
export const OCR_MIN_ACCEPTED_TEXT_CHARS = 120;

/**
 * Sentences a model returns instead of a reading. These are refusals, not content: their length
 * is a property of the refusal, so they must be recognised before any character count is applied.
 */
const OCR_FAILURE_PATTERNS = [
  /\b(can(?:not|'t)\s+(?:read|extract|see)|unable\s+to\s+(?:read|extract|see))\b/i,
  /\b(no|without)\s+(?:readable\s+)?text\b/i,
  /\bimage\s+(?:is\s+)?(?:blank|too\s+blurry|illegible)\b/i,
  /\bnot\s+enough\s+readable\s+text\b/i,
  /\bni\s+(?:berljivega\s+)?besedila\b/i,
  /\bne\s+morem\s+(?:prebrati|razbrati)\b/i,
];

export function hasFailurePhrase(text: string) {
  return OCR_FAILURE_PATTERNS.some((pattern) => pattern.test(text));
}

/** Characters that carry meaning on a page, as opposed to stray marks a camera picked up. */
const READABLE_CHARACTER = /[\p{L}\p{N}=+\-*/^.,;:()[\]{}<>%$#@]/u;

const MIN_READABLE_CHARACTER_RATIO = 0.45;

export type ImageOcrVerdict =
  | { acceptable: true }
  | { acceptable: false; rejection: ScanOcrRejection };

/**
 * Whether a reading of a photo is worth keeping, and when it is not, which of the two very
 * different reasons applies.
 *
 * The order of the rules is the substance of this function. A reading is only ever called
 * `too_short` once it has been established to be genuine text: a refusal sentence and a page of
 * stray marks are unreadable photos however many characters they run to, and answering those
 * with "add more pages" would send a learner off to photograph more material we equally cannot
 * read. Only a real reading that is merely thin earns that advice.
 *
 * Expects text already run through `normalizeOcrPlainText`, which is what makes a raw character
 * count meaningful here.
 */
export function classifyImageOcrText(text: string): ImageOcrVerdict {
  const normalized = stripUnstorableCharacters(text).trim();

  if (hasFailurePhrase(normalized)) {
    return { acceptable: false, rejection: "unreadable" };
  }

  const compact = normalized.replace(/\s/g, "");

  if (!compact) {
    return { acceptable: false, rejection: "unreadable" };
  }

  const readableCharacters = Array.from(compact).filter((character) =>
    READABLE_CHARACTER.test(character),
  ).length;

  // Mostly punctuation and noise: a reading of something that was never text.
  if (readableCharacters / compact.length < MIN_READABLE_CHARACTER_RATIO) {
    return { acceptable: false, rejection: "unreadable" };
  }

  // Real text, just not much of it. The page was read; there was little on it.
  if (normalized.length < OCR_MIN_ACCEPTED_TEXT_CHARS) {
    return { acceptable: false, rejection: "too_short" };
  }

  return { acceptable: true };
}

export function isAcceptableImageOcrText(text: string) {
  return classifyImageOcrText(text).acceptable;
}
