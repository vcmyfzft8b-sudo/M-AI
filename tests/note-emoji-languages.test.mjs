import assert from "node:assert/strict";
import test from "node:test";

import { noteEmoji } from "../src/lib/note-emoji.ts";

function emojiFor(title) {
  return noteEmoji({ title, source_type: "audio", processing_metadata: null });
}

/*
 * The emoji is matched against the note's own title, which is written in the language of the
 * learner's material — not the language the interface is set to. Expanding into Croatia, Bosnia
 * and Serbia means the same subject arrives spelled three more ways, and a title that matches
 * nothing falls through to a stable-but-arbitrary book cover. These are the pairs where the
 * spelling actually diverges.
 */
const EQUIVALENTS = [
  ["Zgodovina Balkana", ["Povijest Balkana", "Istorija Balkana"]],
  ["Kemija — organske reakcije", ["Hemija — organske reakcije"]],
  ["Verjetnost in statistika", ["Vjerojatnost i statistika", "Verovatnoća i statistika"]],
  ["Umetna inteligenca", ["Umjetna inteligencija", "Veštačka inteligencija"]],
  ["Podjetništvo", ["Poduzetništvo", "Preduzetništvo"]],
  ["Računalništvo", ["Računarstvo"]],
  ["Priprava na izpit", ["Priprema za ispit"]],
  ["Umetnost 20. stoletja", ["Umjetnost 20. stoljeća"]],
  ["Strojništvo", ["Mašinstvo"]],
  ["Družboslovje", ["Društvene nauke"]],
];

for (const [slovenian, others] of EQUIVALENTS) {
  for (const other of others) {
    test(`"${other}" gets the same emoji as "${slovenian}"`, () => {
      assert.equal(emojiFor(other), emojiFor(slovenian));
    });
  }
}

test("a subject with no keyword still gets a stable emoji", () => {
  const first = emojiFor("Nekaj čisto drugega");

  assert.equal(typeof first, "string");
  assert.ok(first.length > 0);
  assert.equal(emojiFor("Nekaj čisto drugega"), first);
});
