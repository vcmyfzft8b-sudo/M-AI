/**
 * Whether a source has anything at all to make notes from.
 *
 * This used to demand 120 characters, which turned away a photo of one exercise, a single spoken
 * question and a pasted topic name -- material a learner reasonably expects notes from. Short
 * material now goes on to the notes stage, which teaches the topic it names when there is no
 * explanation to condense (note-generation.ts, topic notes). Only text with nothing in it stops
 * here.
 *
 * A word is enough, and so is a formula: a photographed maths exercise such as
 * "(7x-3y)^5 · (6y-14x)^3 =" has no two letters in a row but is plainly something to learn
 * (note triage, lecture 3e3d20af). A formula is three letters or digits joined by an operator.
 *
 * Kept free of imports so scripts/replay-failed-note.mjs applies the same rule production does.
 */
export function hasEnoughSourceTextToTeach(text: string) {
  if (/\p{L}{2,}/u.test(text)) {
    return true;
  }

  const symbols = text.match(/[\p{L}\p{N}]/gu)?.length ?? 0;
  return symbols >= 3 && /[=+\-−–×·*/÷^<>≤≥≠√∫∑²³]/u.test(text);
}
