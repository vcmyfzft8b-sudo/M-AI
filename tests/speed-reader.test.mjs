import assert from "node:assert/strict";
import test from "node:test";

import { parseNoteTtsDocument } from "../src/lib/note-tts-text.ts";
import {
  SPEED_READER_MAX_WPM,
  SPEED_READER_MIN_WPM,
  buildSpeedReadWords,
  focusIndex,
  nextSentenceStart,
  sentenceStart,
  splitAtFocus,
  totalDurationMs,
  wordDurationMs,
  wpmAtProgress,
} from "../src/lib/speed-reader.ts";

/*
 * The reader is a timing device, so these cover the two things a reader would
 * actually notice going wrong: the pivot letter drifting off the centre line,
 * and punctuation losing its beat so sentences run together.
 */

function wordsOf(markdown) {
  return buildSpeedReadWords(parseNoteTtsDocument(markdown));
}

test("the pivot letter sits just left of the middle and never runs away", () => {
  assert.equal(focusIndex("a"), 0);
  assert.equal(focusIndex("in"), 0);
  assert.equal(focusIndex("rasti"), 2);
  assert.equal(focusIndex("branje"), 2);
  // Capped, so a long term is not dragged off to one side of the stage.
  assert.equal(focusIndex("fotosinteza"), 4);
  assert.equal(focusIndex("elektroencefalografija"), 4);
});

test("a word splits into exactly its own letters around the pivot", () => {
  const split = splitAtFocus("rasti");

  assert.deepEqual(split, { before: "ra", focus: "s", after: "ti" });
  assert.equal(split.before + split.focus + split.after, "rasti");

  // A one-letter word still has a focus letter rather than an empty stage.
  assert.deepEqual(splitAtFocus("a"), { before: "", focus: "a", after: "" });
});

test("punctuation between words becomes the pause that follows them", () => {
  const words = wordsOf("Rastline rastejo, ker imajo svetlobo. Voda pomaga.");

  assert.deepEqual(
    words.map((word) => [word.text, word.pause]),
    [
      ["Rastline", "none"],
      ["rastejo", "clause"],
      ["ker", "none"],
      ["imajo", "none"],
      ["svetlobo", "sentence"],
      ["Voda", "none"],
      // The last word of a paragraph closes the block, not just the sentence.
      ["pomaga", "block"],
    ],
  );
});

test("an opening bracket belongs to the word after it, so it earns no pause", () => {
  const words = wordsOf("Klorofil (zelenilo) lovi svetlobo.");

  assert.deepEqual(
    words.map((word) => [word.text, word.pause]),
    [
      ["Klorofil", "none"],
      ["zelenilo", "clause"],
      ["lovi", "none"],
      ["svetlobo", "block"],
    ],
  );
});

test("every list item and heading is its own run", () => {
  const words = wordsOf("# Rastline\n\n- prva\n- druga\n");

  assert.deepEqual(
    words.map((word) => [word.text, word.pause]),
    [
      ["Rastline", "block"],
      ["prva", "block"],
      ["druga", "block"],
    ],
  );
});

test("the reader covers the same words the read-aloud player speaks", () => {
  const markdown = "# Fotosinteza\n\nRastline rastejo, ker imajo svetlobo.\n\n- voda\n- zrak\n";
  const document = parseNoteTtsDocument(markdown);

  assert.deepEqual(
    buildSpeedReadWords(document).map((word) => word.text),
    document.words.map((word) => word.text),
  );
});

test("a longer word and a heavier pause both buy more time", () => {
  const base = wordDurationMs({ text: "voda", pause: "none" }, 300);

  assert.equal(base, 200);
  assert.ok(wordDurationMs({ text: "fotosinteza", pause: "none" }, 300) > base);
  assert.ok(wordDurationMs({ text: "voda", pause: "clause" }, 300) > base);
  assert.ok(
    wordDurationMs({ text: "voda", pause: "sentence" }, 300) >
      wordDurationMs({ text: "voda", pause: "clause" }, 300),
  );
  // A formula is parsed rather than read, so it holds longer than its length alone.
  assert.ok(
    wordDurationMs({ text: "x^2+y^2", pause: "none", math: true }, 300) >
      wordDurationMs({ text: "x^2+y^2", pause: "none" }, 300),
  );
});

test("a word never freezes the reader, however long the token is", () => {
  const url = "https://example.com/a-very-long-path-that-is-not-a-word-at-all";
  const capped = wordDurationMs({ text: url, pause: "none" }, 300);

  assert.equal(capped, 500);
  assert.equal(wordDurationMs({ text: `${url}${url}`, pause: "none" }, 300), capped);
});

test("a faster setting is a shorter word", () => {
  assert.ok(
    wordDurationMs({ text: "voda", pause: "none" }, 600) <
      wordDurationMs({ text: "voda", pause: "none" }, 300),
  );
});

test("gradual speed-up starts at the set rate and climbs from there", () => {
  assert.equal(wpmAtProgress(300, 0, false), 300);
  assert.equal(wpmAtProgress(300, 1, false), 300);

  /*
   * The first word is read at exactly the rate the slider was moved to. Anything
   * slower would be the screen quietly overriding the setting on the very screen
   * the setting lives on.
   */
  assert.equal(wpmAtProgress(300, 0, true), 300);
  assert.equal(wpmAtProgress(300, 0.5, true), 345);
  assert.equal(wpmAtProgress(300, 1, true), 390);

  // True wherever the slider is, not just at its default.
  assert.equal(wpmAtProgress(500, 0, true), 500);
  assert.equal(wpmAtProgress(200, 0, true), 200);
});

test("the ramp stays inside the slider's own range", () => {
  // Already at the top, so there is nowhere to climb to and it simply holds.
  assert.equal(wpmAtProgress(SPEED_READER_MAX_WPM, 0, true), SPEED_READER_MAX_WPM);
  assert.equal(wpmAtProgress(SPEED_READER_MAX_WPM, 1, true), SPEED_READER_MAX_WPM);
  assert.equal(wpmAtProgress(SPEED_READER_MIN_WPM, 0, true), SPEED_READER_MIN_WPM);
});

test("the ramp only ever makes the note quicker, never slower", () => {
  const words = Array.from({ length: 400 }, () => ({ text: "voda", pause: "none" }));

  for (const wpm of [200, 300, 525, 800]) {
    const flat = totalDurationMs(words, wpm, false);
    const ramped = totalDurationMs(words, wpm, true);

    assert.ok(ramped <= flat, `${wpm} WPM: ramped ${ramped} should not exceed flat ${flat}`);
  }
});

test("what is left of the note is timed from where the reader is on the ramp", () => {
  const words = Array.from({ length: 400 }, () => ({ text: "voda", pause: "none" }));

  /*
   * The last quarter is read at the top of the ramp, so it has to be quoted as
   * quicker than the same quarter timed as if the note started there.
   */
  const tail = totalDurationMs(words, 300, true, 300);
  const asIfRestarted = totalDurationMs(words.slice(300), 300, true);

  assert.ok(tail < asIfRestarted, `${tail} should be under ${asIfRestarted}`);
  // And the whole note is the sum of its parts.
  assert.equal(
    Math.round(totalDurationMs(words, 300, true)),
    Math.round(totalDurationMs(words, 300, true, 0)),
  );
});

test("stepping by sentence lands on the first word of a sentence", () => {
  const words = wordsOf("Ena dve tri. Stiri pet sest. Sedem osem.");

  assert.equal(nextSentenceStart(words, 0), 3);
  assert.equal(nextSentenceStart(words, 3), 6);
  assert.equal(sentenceStart(words, 4), 3);
  assert.equal(sentenceStart(words, 7), 6);

  // Neither end of the note can be stepped off.
  assert.equal(sentenceStart(words, 0), 0);
  assert.equal(nextSentenceStart(words, words.length - 1), words.length - 1);
});

test("an empty note yields nothing to read rather than a blank word", () => {
  assert.deepEqual(wordsOf(""), []);
  assert.deepEqual(wordsOf("---\n\n   \n"), []);
});
