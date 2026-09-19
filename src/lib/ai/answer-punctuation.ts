/**
 * The last thing that happens to a chat answer before anybody reads it.
 *
 * The tutor is told not to write an em dash, and measured over 18 answers it
 * does not. "Told not to" is a preference, though, and the instruction here was
 * "never": a model that has spent its whole training writing "X — the thing
 * that matters" will eventually write one, and the em dash is the single
 * clearest sign to a reader that a machine wrote something. So the prompt makes
 * it rare and this makes it impossible.
 *
 * The en dash goes with it. It is what a model reaches for the moment it is
 * told to stop using the em dash, and it reads exactly the same way.
 *
 * What it must not do is change meaning. Three cases are handled before the
 * general one for that reason: a dash between numbers is a range ("1914–1918"),
 * a dash at the start of a line is a bullet, and a hyphen inside a word
 * ("e-pošta", "matter-of-fact") is not a dash at all and is never touched.
 *
 * Kept free of "server-only" so it stays unit-testable (tests/answer-punctuation.test.mjs).
 */

/** Em dash and en dash. The hyphen-minus is deliberately not here. */
const DASHES = /[—–]/;

/**
 * The same replacement, safe to apply to one chunk of a streaming answer.
 *
 * A dash is a single character, so it never straddles two chunks. The spaces
 * around it can, which is the one imperfection: when a chunk ends in a space
 * and the next begins with a dash, the comma lands after that space. It is
 * visible for as long as one token takes to arrive and is gone the moment the
 * finished answer replaces what was painted, which is what both chats already
 * do with the closing frame.
 */
export function stripDashPunctuation(text: string): string {
  if (!DASHES.test(text)) {
    return text;
  }

  return (
    text
      /*
       * A line that opens with a dash is a bullet somebody typed the wrong way. The newline
       * has to be in the match rather than an anchor: this also runs on one chunk of a
       * streaming answer, where the start of the chunk is not the start of a line.
       */
      .replace(/(\n[ \t]*)[—–][ \t]+/g, "$1- ")
      // "1914–1918", "5–10 minut": a range, where a comma would invert the meaning.
      .replace(/(\d)\s*[—–]\s*(\d)/g, "$1-$2")
      /*
       * Everything else is punctuation, and a comma is what it was standing in for. Only
       * horizontal whitespace is consumed, so a dash sitting at the end of a line cannot
       * swallow the line break and glue two lines together.
       */
      .replace(/[ \t]*[—–][ \t]*/g, ", ")
      // Tidy what the substitution can leave behind at a seam or a sentence end.
      .replace(/,\s*,/g, ",")
      .replace(/[ \t]*,[ \t]*([.!?;:])/g, "$1")
      .replace(/[ \t]*,[ \t]*(\n)/g, "$1")
      .replace(/,[ \t]*$/, "")
  );
}
