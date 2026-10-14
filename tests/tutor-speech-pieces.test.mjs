import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_PIECE_CHARS,
  hasSpeakableText,
  nextSpeechPiece,
  spreadPieceTimings,
} from "../src/lib/tutor/speech-pieces.ts";
import { createEmptyCharacterTimings, spokenTextBefore } from "../src/lib/tutor/turn-audio.ts";

/** Cuts a whole buffer the way the player does, as text arrives and then at the end. */
function cutAll(text, { flushAtEnd = true } = {}) {
  const pieces = [];
  let buffer = text;

  for (;;) {
    const cut = nextSpeechPiece(buffer, { first: pieces.length === 0, flush: false });

    if (!cut) {
      break;
    }

    pieces.push(cut.piece);
    buffer = cut.rest;
  }

  while (flushAtEnd && buffer) {
    const cut = nextSpeechPiece(buffer, { first: pieces.length === 0, flush: true });

    if (!cut) {
      break;
    }

    pieces.push(cut.piece);
    buffer = cut.rest;
  }

  return { pieces, rest: buffer };
}

test("the first piece is the first sentence, so the tutor starts talking early", () => {
  const cut = nextSpeechPiece("Dobro, gremo naprej na fotosintezo. Predstavljaj si list", {
    first: true,
    flush: false,
  });

  assert.deepEqual(cut, {
    piece: "Dobro, gremo naprej na fotosintezo.",
    rest: " Predstavljaj si list",
  });
});

test("a full stop is not trusted until the next word shows a new sentence starts", () => {
  // Nothing after the stop yet: it might be "npr." or "2." — wait one token.
  assert.equal(nextSpeechPiece("To je kisik, ki ga dihamo.", { first: true, flush: false }), null);
  // Abbreviation and ordinal: the sentence carries on.
  assert.equal(nextSpeechPiece("Na primer npr. kisik ali dušik in", { first: true, flush: false }), null);
  assert.equal(nextSpeechPiece("Med 2. svetovno vojno so", { first: true, flush: false }), null);
  // A question mark is unambiguous once something follows it.
  assert.equal(
    nextSpeechPiece("Kaj misliš, zakaj je tako? Pomisli", { first: true, flush: false }).piece,
    "Kaj misliš, zakaj je tako?",
  );
});

test("a very short opening rides along with the next sentence", () => {
  const cut = nextSpeechPiece("Dobro. Zdaj pa poglejva ravnovesno ceno. In", { first: true, flush: false });

  assert.equal(cut.piece, "Dobro. Zdaj pa poglejva ravnovesno ceno.");
});

test("later pieces take every whole sentence that has arrived, never half of one", () => {
  const cut = nextSpeechPiece("Prvi stavek je tu. Drugi stavek tudi. Tretji še ni kon", {
    first: false,
    flush: false,
  });

  assert.equal(cut.piece, "Prvi stavek je tu. Drugi stavek tudi.");
  assert.equal(cut.rest, " Tretji še ni kon");
});

test("a lone tag is not a request of its own; it is said with what follows", () => {
  assert.equal(hasSpeakableText("[laughs] "), false);
  assert.equal(nextSpeechPiece("[laughs] Ne", { first: false, flush: false }), null);

  const { pieces } = cutAll("[laughs] Ta napaka je čisto normalna. [sighs] Ta del je zoprn.");

  assert.deepEqual(pieces, ["[laughs] Ta napaka je čisto normalna.", " [sighs] Ta del je zoprn."]);
});

test("flushing sends a half sentence when the writer has stopped, and drops a stray tag", () => {
  assert.deepEqual(nextSpeechPiece(" in potem se", { first: false, flush: true }), {
    piece: " in potem se",
    rest: "",
  });
  assert.equal(nextSpeechPiece(" [laughs]", { first: false, flush: true }), null);
});

test("a long run with no full stop is cut at a clause, within the limit", () => {
  const long = Array.from({ length: 60 }, (_, index) => `beseda${index},`).join(" ");
  const { pieces } = cutAll(long);

  assert.ok(pieces.length > 1);
  assert.equal(pieces.join(""), long);

  for (const piece of pieces) {
    assert.ok(piece.length <= MAX_PIECE_CHARS, `${piece.length} chars`);
  }
});

test("the pieces always add back up to the text that was written", () => {
  const text =
    "Super, gremo naprej. Predstavljaj si list kot majhno tovarno. Vanjo pride sončna svetloba, " +
    "voda in ogljikov dioksid. [whispers] To pride na izpit. Zdaj pa jaz vprašam tebe: zakaj?";
  const { pieces, rest } = cutAll(text);

  assert.equal(pieces.join("") + rest, text);
  assert.equal(rest, "");
});

test("a piece's characters are spread over its audio, pausing on punctuation", () => {
  const timings = createEmptyCharacterTimings();

  spreadPieceTimings(timings, {
    text: "Ena dva. Tri",
    offsetSeconds: 2,
    durationSeconds: 3,
    complete: true,
  });

  assert.equal(timings.characters.join(""), "Ena dva. Tri");
  assert.equal(timings.startSeconds[0], 2);
  assert.ok(Math.abs(timings.endSeconds.at(-1) - 5) < 1e-9);

  const letter = timings.endSeconds[0] - timings.startSeconds[0];
  const stop = timings.endSeconds[7] - timings.startSeconds[7];

  assert.ok(stop > letter * 3, "a full stop is where the speaker pauses");
});

test("tags take no time, since they are sounds rather than words", () => {
  const timings = createEmptyCharacterTimings();

  spreadPieceTimings(timings, { text: "[laughs] Ja", offsetSeconds: 0, durationSeconds: 1, complete: true });

  assert.equal(timings.endSeconds[7], 0);
  assert.ok(timings.endSeconds.at(-1) > 0.99);
});

test("a piece still arriving errs towards not having said its words yet", () => {
  const text = "To je zelo dolg stavek, ki ga tutor še govori, ko ga učenec prekine.";
  const timings = createEmptyCharacterTimings();

  // One second of audio has arrived, of a sentence that will take about six.
  spreadPieceTimings(timings, { text, offsetSeconds: 0, durationSeconds: 1, complete: false });

  const heard = spokenTextBefore(timings, 1, text);

  assert.ok(heard.split(" ").length <= 3, `heard "${heard}"`);
});

test("the cut lands on a whole word, which is what the interruption record needs", () => {
  const text = "Mitohondrij je elektrarna celice.";
  const timings = createEmptyCharacterTimings();

  spreadPieceTimings(timings, { text, offsetSeconds: 0, durationSeconds: 2, complete: true });

  const heard = spokenTextBefore(timings, 1.1, text);

  assert.ok(text.startsWith(heard));
  assert.ok(!heard.endsWith(" "));
  assert.ok(/^(Mitohondrij|Mitohondrij je|Mitohondrij je elektrarna)$/.test(heard), heard);
});
