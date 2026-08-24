import assert from "node:assert/strict";
import test from "node:test";

import {
  dedupeCardDraftsByContent,
  dedupePracticeDraftsByContent,
  dedupeQuizDraftsByContent,
} from "../src/lib/notes/study-dedupe.ts";
import { dedupeKnowledgeItems } from "../src/lib/notes/note-prompts.ts";

test("the duplicate observed in a real deck collapses across concept keys", () => {
  // Verbatim from the scan-lecture deck: same front, same fact, two concept keys.
  const cards = [
    { front: "Kaj sproži eksocitozo veziklov v sinapsi?", back: "Kalcij.", conceptKey: "item-1" },
    { front: "Kaj sproži eksocitozo veziklov v sinapsi?", back: "Prisotnost kalcija.", conceptKey: "item-19" },
    { front: "Kaj je sinapsa?", back: "Stik med dvema nevronoma.", conceptKey: "item-0" },
  ];

  const deduped = dedupeCardDraftsByContent(cards);

  assert.equal(deduped.length, 2);
  assert.equal(deduped[0].conceptKey, "item-1");
});

test("cards sharing a question shape but testing different facts both survive", () => {
  const cards = [
    { front: "Kaj je Laspeyresov indeks?", back: "Indeks s količinami baznega obdobja." },
    { front: "Kaj je Paaschejev indeks?", back: "Indeks s količinami tekočega obdobja." },
  ];

  assert.equal(dedupeCardDraftsByContent(cards).length, 2);
});

test("inflected wordings of one claim merge at the item level", () => {
  // "kalcij" vs "kalcija" and re-worded claims defeated equality-based token matching.
  const items = [
    { id: 0, claim: "Kalcij sproži eksocitozo veziklov", kind: "causal", importance: 5, terms: [], sectionTitle: "S" },
    { id: 1, claim: "Prisotnost kalcija sproži eksocitozo iz veziklov", kind: "causal", importance: 4, terms: [], sectionTitle: "S" },
  ];

  assert.equal(dedupeKnowledgeItems(items).length, 1);
});

test("quiz questions merge only when both the prompt and the correct answer match", () => {
  const questions = [
    { prompt: "Kateri element sproži eksocitozo veziklov?", options: ["Kalij", "Kalcij", "Natrij", "Klor"], correctOptionIndex: 1 },
    { prompt: "Kateri element sproži eksocitozo veziklov v sinapsi?", options: ["Kalcij", "Magnezij", "Kalij", "Železo"], correctOptionIndex: 0 },
    { prompt: "Kateri element prevladuje v zunajcelični tekočini?", options: ["Natrij", "Kalcij", "Kalij", "Klor"], correctOptionIndex: 0 },
  ];

  const deduped = dedupeQuizDraftsByContent(questions);

  assert.equal(deduped.length, 2);
});

test("practice prompts converging on the same task collapse", () => {
  const questions = [
    { prompt: "Pojasnite, kako kalcij sproži eksocitozo veziklov." },
    { prompt: "Pojasnite, kako prisotnost kalcija sproži eksocitozo veziklov v sinapsi." },
    { prompt: "Primerjajte ionotropne in metabotropne receptorje." },
  ];

  assert.equal(dedupePracticeDraftsByContent(questions).length, 2);
});
