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

/*
 * Keywords are stems that match where a word starts, not anywhere in the title. Matching anywhere
 * gave "Article", "Heart" and "Start-ups" the art palette, "Strategija" and "Separation of powers"
 * the history scroll, and every French Revolution note DNA, because "revolucija" contains
 * "evolucij". The subject a title is really about must still win in all five languages, including
 * the compound sciences that start a stem mid-word after a prefix.
 */
const SUBJECTS = [
  ["Zgodovina – francoska revolucija", "📜"],
  ["Povijest – Francuska revolucija", "📜"],
  ["Istorija – Francuska revolucija", "📜"],
  ["History – the French Revolution", "📜"],
  ["Drugi svjetski rat", "📜"],
  ["Uzroci rata", "📜"],
  ["O ratovima na Balkanu", "📜"],
  ["Ratni zločini", "📜"],
  ["Etnomuzikologija", "🎨"],
  ["Arts and crafts", "🎨"],
  ["Umetnost 20. stoletja", "🎨"],
  ["Microeconomics – supply and demand", "📈"],
  ["Mikroekonomija – ponuda i tražnja", "📈"],
  ["Biokemija", "⚗️"],
  ["Astrofizika", "⚛️"],
  ["Hidrogeologija", "🌍"],
  ["Neuroanatomija", "🧠"],
  ["Bioetika", "🤔"],
  ["Aritmetika", "➗"],
  ["Strateški menadžment", "🧭"],
  ["DNA replication", "🧬"],
  ["Law of contracts", "⚖️"],
  ["Romantika v literaturi", "📖"],
];

for (const [title, emoji] of SUBJECTS) {
  test(`"${title}" gets ${emoji}`, () => {
    assert.equal(emojiFor(title), emoji);
  });
}

const ACCIDENTS = [
  ["Article: ERP systems in practice", "🎨"],
  ["Part 2: Linear algebra", "🎨"],
  ["Heart physiology", "🎨"],
  ["Start-ups and venture capital", "🎨"],
  ["Strategija podjetja", "📜"],
  ["Separation of powers", "📜"],
  ["Ratio analysis", "📜"],
  ["Contest preparation", "📝"],
  ["Estetika in kozmetika", "🤔"],
  ["Excellent writing", "🧬"],
  ["Lawn care", "⚖️"],
  ["Dnevnik prakse", "🧬"],
];

for (const [title, wrong] of ACCIDENTS) {
  test(`"${title}" is not ${wrong}`, () => {
    assert.notEqual(emojiFor(title), wrong);
  });
}

test("the subject still wins when the title starts with something else", () => {
  assert.equal(emojiFor("Part 2: Linear algebra"), "➗");
  assert.equal(emojiFor("Uvod v biologijo celice"), "🧬");
});
