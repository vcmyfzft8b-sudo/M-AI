import assert from "node:assert/strict";
import test from "node:test";

import { stripDashPunctuation } from "../src/lib/ai/answer-punctuation.ts";

/*
 * The em dash is out of the chat by instruction and by construction. These are
 * the cases where "just delete the character" would have been wrong: a range
 * whose meaning inverts, a bullet that stops being a bullet, and a hyphen that
 * was never a dash in the first place.
 */

test("a dash used as punctuation becomes a comma", () => {
  assert.equal(
    stripDashPunctuation("MAC je fizični naslov — proizvajalec ga vpiše."),
    "MAC je fizični naslov, proizvajalec ga vpiše.",
  );
  // An en dash is what a model reaches for once it is told to stop using the em dash.
  assert.equal(stripDashPunctuation("TCP je zanesljiv – UDP ni."), "TCP je zanesljiv, UDP ni.");
});

test("a dash with no spaces around it is still punctuation", () => {
  assert.equal(stripDashPunctuation("hitro—in zanesljivo"), "hitro, in zanesljivo");
});

test("a range between numbers keeps its meaning", () => {
  // "1914, 1918" would be two years instead of four of them.
  assert.equal(stripDashPunctuation("Vojna je trajala 1914–1918."), "Vojna je trajala 1914-1918.");
  assert.equal(stripDashPunctuation("Traja 5 – 10 minut."), "Traja 5-10 minut.");
});

test("a hyphen inside a word is not a dash and is left alone", () => {
  const untouched = "Pošlji e-pošto; matter-of-fact stays as it is.";
  assert.equal(stripDashPunctuation(untouched), untouched);
});

test("a dash opening a line is a bullet, not punctuation", () => {
  assert.equal(
    stripDashPunctuation("Dve vrsti:\n— TCP preveri pakete\n— UDP ne preveri"),
    "Dve vrsti:\n- TCP preveri pakete\n- UDP ne preveri",
  );
  /*
   * A dash at the very start of the string is not treated as a bullet, because this also runs
   * on one chunk of a streaming answer and a chunk can begin mid-sentence. The rule needs a
   * real newline in the match; an answer never opens with a bullet, so nothing is lost.
   */
  assert.equal(stripDashPunctuation("— prva vrstica"), ", prva vrstica");
});

test("the substitution never leaves stray punctuation behind", () => {
  assert.equal(stripDashPunctuation("Tako je — ."), "Tako je.");
  assert.equal(stripDashPunctuation("Res — ?"), "Res?");
  assert.equal(stripDashPunctuation("Konec —"), "Konec");
  assert.equal(stripDashPunctuation("Prvi —\nDrugi"), "Prvi\nDrugi");
  assert.equal(stripDashPunctuation("A, — B"), "A, B");
});

test("text without a dash comes back byte for byte", () => {
  const answer = "Calvinov cikel poteka v stromi.\n\n1. **Fizična**\n2. **Povezavna**\n\nJe jasno?";
  assert.equal(stripDashPunctuation(answer), answer);
});

/*
 * Streaming: the answer arrives in pieces and each piece is cleaned on its own.
 * A dash is one character so it never straddles two of them, which is what makes
 * this safe to do per chunk at all.
 */
test("a dash split from its spaces across chunks still loses the dash", () => {
  const chunks = ["Zanesljiv ", "— preveri ", "vsak paket."];
  const painted = chunks.map(stripDashPunctuation).join("");

  assert.ok(!/[—–]/.test(painted), "no dash survives, whichever chunk it arrived in");
  // The known seam: the space came in the previous chunk, so the comma follows it. The
  // finished answer that replaces the painted text a moment later is clean.
  assert.equal(painted, "Zanesljiv , preveri vsak paket.");
  assert.equal(stripDashPunctuation(chunks.join("")), "Zanesljiv, preveri vsak paket.");
});
