import assert from "node:assert/strict";
import test from "node:test";

import {
  resolvePassageLanguage,
  resolveSpokenLanguage,
} from "../src/lib/tutor/spoken-language.ts";

// Long enough and marked enough for detectSourceLanguage to commit — a shorter interruption
// answers null, which is the safe outcome: the material's language stands and nobody guesses.
const SLOVENIAN =
  "Počakaj, oziroma lahko to razložiš še enkrat, tudi pri tistem delu, ki ga nisem razumel, " +
  "zato ker med predavanjem nisem sledil, vendar bi rad razumel svoj zapisek.";
const ENGLISH =
  "Hold on, could you explain the bit about the vesicles again, the one that comes from the " +
  "membrane, because there is something in this which I do not follow and that bothers me.";

test("the material decides while the learner has said nothing", () => {
  assert.equal(
    resolveSpokenLanguage("sl", { question: null, history: [] }),
    "sl",
  );
});

test("the learner's own voice outranks the material", () => {
  // A Slovenian question about an English lecture is answered in Slovenian, so it must be
  // CHECKED as Slovenian — a checker told "en" here would be asked to translate.
  assert.equal(
    resolveSpokenLanguage("en", { question: SLOVENIAN, history: [] }),
    "sl",
  );
});

test("a learner who switches languages is followed, not remembered", () => {
  const history = [
    { role: "learner", content: ENGLISH },
    { role: "tutor", content: "Sure — think of it like a mailbox." },
    { role: "learner", content: SLOVENIAN },
  ];

  assert.equal(resolveSpokenLanguage("en", { question: null, history }), "sl");
});

test("the tutor's own words never decide the language", () => {
  // Otherwise the tutor keeps a language alive after the learner has left it.
  const history = [
    { role: "tutor", content: SLOVENIAN },
    { role: "learner", content: ENGLISH },
  ];

  assert.equal(resolveSpokenLanguage("sl", { question: null, history }), "en");
});

test("a reply too short to read falls through to the older turns", () => {
  const history = [
    { role: "learner", content: SLOVENIAN },
    { role: "tutor", content: "…" },
  ];

  assert.equal(resolveSpokenLanguage("de", { question: "ja", history }), "sl");
});

test("nothing readable in any language leaves the material's own", () => {
  assert.equal(
    resolveSpokenLanguage("de", { question: "ok", history: [{ role: "learner", content: "hm" }] }),
    "de",
  );
});

/* --- the language of what the tutor actually said -------------------------- */

test("a unit long enough to read decides its own language", () => {
  // The case resolveSpokenLanguage cannot see: a short Slovenian interruption on an English
  // lecture resolves to "en", and "en" is the one language the checker skips. The tutor's own
  // words are long enough to tell, and they are the text being repaired.
  assert.equal(resolvePassageLanguage("en", SLOVENIAN), "sl");
});

test("a unit too short to read keeps the turn's language", () => {
  assert.equal(resolvePassageLanguage("sl", "Točno tako."), "sl");
  assert.equal(resolvePassageLanguage("en", "Exactly right."), "en");
});

test("English prose is recognised as English and left alone", () => {
  assert.equal(resolvePassageLanguage("sl", ENGLISH), "en");
});
