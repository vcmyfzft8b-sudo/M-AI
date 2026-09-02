import assert from "node:assert/strict";
import test from "node:test";

import {
  buildNoteTtsChunks,
  parseNoteTtsDocument,
  speakableMath,
  stripLeadingRedundantHeading,
} from "../src/lib/note-tts-text.ts";

// The formula that took a chunk past Soniox's per-request audio cap: the model read the LaTeX
// commands letter by letter. The spoken form must carry no backslashes or braces.
test("reads a rational-function definition as symbols and words", () => {
  const spoken = speakableMath("r(x) = \\frac{P(x)}{Q(x)}, \\text{kjer} Q(x) \\neq 0");

  assert.equal(spoken, "r(x) = P(x) / Q(x) , kjer Q(x) ≠ 0");
});

test("resolves nested fractions and roots", () => {
  assert.equal(speakableMath("\\frac{1}{\\frac{a}{b}}"), "1 / a / b");
  // A root inside a fraction and a fraction inside a root: neither may leave "frac" or "sqrt"
  // behind to be read as a word.
  assert.equal(speakableMath("\\frac{\\sqrt{x}}{2}"), "√(x) / 2");
  assert.equal(speakableMath("\\sqrt{\\frac{a}{b}}"), "√( a / b )");
  assert.equal(speakableMath("\\dfrac{\\partial^{2} u}{\\partial x^{2}}"), "∂^2 u / ∂ x^2");
  assert.equal(speakableMath("\\sqrt{x^{2} + y_{1}}"), "√(x^2 + y_1)");
  assert.equal(speakableMath("\\sqrt[3]{8}"), "3√(8)");
});

test("maps common symbols and Greek letters, keeps unknown commands as words", () => {
  assert.equal(speakableMath("\\alpha + \\beta \\to \\infty"), "α + β → ∞");
  assert.equal(speakableMath("\\lim_{x \\to 0} \\sin x"), "lim_x → 0 sin x");
  assert.equal(speakableMath("\\text{st}(P) < \\text{st}(Q)"), "st (P) < st (Q)");
  assert.equal(speakableMath("50\\%"), "50%");
});

test("leaves plain expressions alone", () => {
  assert.equal(speakableMath("E = mc^2"), "E = mc^2");
});

test("chunks ramp from a few seconds to a minute and never near the provider's audio cap", () => {
  const words = Array.from({ length: 1000 }, (_, i) => `b${i}`).join(" ");
  const chunks = buildNoteTtsChunks(parseNoteTtsDocument(words));
  const sizes = chunks.map((chunk) => chunk.wordEndIndex - chunk.wordStartIndex);

  // No punctuation anywhere, so nothing to snap to: the pure ramp.
  assert.deepEqual(sizes.slice(0, 5), [30, 48, 58, 79, 90]);

  for (const [index, size] of sizes.entries()) {
    assert.ok(size <= 90, `chunk ${index} has ${size} words`);
    // 1.6 words per second was the slowest tenth of production notes on tts-rt-v2.
    assert.ok(size / 1.6 < 120, "a slow note must still fit far under the 180s cap");
  }

  // Contiguous and complete: every word belongs to exactly one chunk.
  assert.equal(chunks[0].wordStartIndex, 0);
  for (let index = 1; index < chunks.length; index += 1) {
    assert.equal(chunks[index].wordStartIndex, chunks[index - 1].wordEndIndex);
  }
  assert.equal(chunks.at(-1).wordEndIndex, 1000);
  assert.equal(chunks[0].estimatedSeconds, Math.ceil(30 / 1.7));
});

function sentences(count, wordsPerSentence) {
  return Array.from(
    { length: count },
    (_, s) => Array.from({ length: wordsPerSentence }, (_, w) => `b${s}w${w}`).join(" ") + ".",
  ).join(" ");
}

test("boundaries land on sentence ends when one is within reach, and never on nothing", () => {
  const chunks = buildNoteTtsChunks(parseNoteTtsDocument(sentences(80, 7)));
  const sizes = chunks.map((chunk) => chunk.wordEndIndex - chunk.wordStartIndex);

  // Every chunk but the last ends exactly on a sentence (a multiple of 7 words).
  for (const size of sizes.slice(0, -1)) {
    assert.equal(size % 7, 0, `chunk of ${size} words cuts a sentence`);
  }

  // Snapped back from the 30/48/66/90 targets to the nearest sentence end at or below them.
  assert.deepEqual(sizes.slice(0, 4), [28, 42, 49, 63]);
  // The speech text then does not need an invented full stop at the cut.
  assert.ok(chunks[0].text.endsWith("."), chunks[0].text.slice(-20));
});

// Formulas carry no words and are read at about a third of the speed of prose; the word ramp
// alone let a 48-word chunk reach 1,200 characters of speech, past the provider's three-minute
// cap. The speech-text cap pulls such chunks back until they fit.
test("a formula-heavy chunk is capped by its speech text, not only by its words", () => {
  const heavy = Array.from(
    { length: 40 },
    (_, i) =>
      `Formula ${i}: $\\frac{\\partial^2 u}{\\partial x^2} + \\frac{\\partial^2 u}{\\partial y^2} = \\lambda_{${i}} \\cdot \\sum_{k=1}^{n} a_k x^k$ velja.`,
  ).join(" ");
  const chunks = buildNoteTtsChunks(parseNoteTtsDocument(heavy));

  for (const chunk of chunks) {
    assert.ok(chunk.text.length <= 700, `chunk ${chunk.chunkIndex} has ${chunk.text.length} chars`);
    assert.ok(chunk.wordEndIndex - chunk.wordStartIndex >= 12);
    // The estimate follows the speech, so the quota reservation is not a fraction of the truth.
    assert.ok(chunk.estimatedSeconds >= Math.ceil(chunk.text.length / 12));
  }
  assert.equal(chunks.at(-1).wordEndIndex, parseNoteTtsDocument(heavy).words.length);
});

// Every route hashes this result into the chunk cache key, so a trailing newline must not make
// the same note hash two ways depending on whether the heading was stripped.
test("the heading strip always returns trimmed text", () => {
  assert.equal(stripLeadingRedundantHeading("## Uvod\n\nBesedilo.\n", "Fotosinteza"), "## Uvod\n\nBesedilo.");
  assert.equal(stripLeadingRedundantHeading("# Fotosinteza\n\nBesedilo.\n", "Fotosinteza"), "Besedilo.");
});

test("a boundary is not moved back further than the snap window allows", () => {
  // One 200-word sentence: nothing to snap to before the target, so the cap decides.
  const chunks = buildNoteTtsChunks(parseNoteTtsDocument(sentences(1, 200)));
  const sizes = chunks.map((chunk) => chunk.wordEndIndex - chunk.wordStartIndex);

  assert.deepEqual(sizes.slice(0, 3), [30, 48, 58]);
});

// The player synthesizes two chunks at once from the start, then one at a time. At 0.9x real
// time plus ~4s of upload per chunk (measured 0.88x + 3s), each chunk must be finished before
// the reader reaches it — for the pure ramp and for the snapped one.
for (const [label, markdown] of [
  ["unpunctuated", Array.from({ length: 600 }, (_, i) => `w${i}`).join(" ")],
  ["short sentences", sentences(90, 7)],
  ["long sentences", sentences(30, 23)],
]) {
test(`the ramp keeps the next chunk ready before the current one ends (${label})`, () => {
  const chunks = buildNoteTtsChunks(parseNoteTtsDocument(markdown));
  const audioSeconds = chunks.map((chunk) => (chunk.wordEndIndex - chunk.wordStartIndex) / 1.7);
  const synthSeconds = audioSeconds.map((seconds) => seconds * 0.9 + 4);
  // Cold: nothing cached, two lanes from the first click; a chunk starts when the earlier of the
  // two before it finishes. Warm: the first two chunks were made at note creation, playback starts
  // at once, and chunks 2 and 3 start at the click and at the first boundary.
  for (const [mode, startAtFor] of [
    ["cold", (index, readyAt) => (index < 2 ? 0 : Math.min(readyAt[index - 1], readyAt[index - 2]))],
    [
      "warm",
      (index, readyAt, playStart) =>
        index < 2 ? -Infinity : index === 2 ? 0 : index === 3 ? playStart[1] : Math.min(readyAt[index - 1], readyAt[index - 2]),
    ],
  ]) {
    const readyAt = [];
    const playStart = [];
    for (let index = 0; index < chunks.length; index += 1) {
      const startAt = startAtFor(index, readyAt, playStart);
      readyAt.push(startAt === -Infinity ? 0 : startAt + synthSeconds[index]);
      playStart.push(index === 0 ? readyAt[0] : playStart[index - 1] + audioSeconds[index - 1]);
    }
    for (let index = 1; index < chunks.length; index += 1) {
      assert.ok(
        readyAt[index] <= playStart[index],
        `${mode}: chunk ${index} ready at ${readyAt[index].toFixed(1)}s, needed at ${playStart[index].toFixed(1)}s`,
      );
    }
  }
});
}

test("the speech text of a chunk carries the spoken form of its formulas", () => {
  const chunks = buildNoteTtsChunks(
    parseNoteTtsDocument("Velja $\\frac{a}{b} \\neq 0$ za vse $b$."),
  );

  assert.equal(chunks.length, 1);
  assert.ok(!chunks[0].text.includes("\\"), chunks[0].text);
  assert.ok(chunks[0].text.includes("a / b ≠ 0"), chunks[0].text);
});
