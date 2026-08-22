import assert from "node:assert/strict";
import test from "node:test";

import {
  buildUnitExtractionWindows,
  resolvePrimaryUnitIdx,
  synthesizeItemPlans,
} from "../src/lib/notes/study-item-mapping.ts";

function makeUnit(unitIndex, text, wordCount) {
  return {
    lectureId: "l1",
    unitIndex,
    sectionIndex: 0,
    sectionTitle: "Section",
    sourceType: "document",
    locatorLabel: `Page ${unitIndex + 1}`,
    startMs: null,
    endMs: null,
    pageNumber: unitIndex + 1,
    text,
    wordCount: wordCount ?? text.split(/\s+/).length,
    importance: "medium",
    rawSourceRef: { segmentIndexes: [unitIndex], speakerLabel: null },
  };
}

test("extraction windows cover every unit exactly once per pass", () => {
  const units = [
    makeUnit(0, "alpha ".repeat(200), 200),
    makeUnit(1, "beta ".repeat(300), 300),
    makeUnit(2, "gamma ".repeat(250), 250),
  ];
  const windows = buildUnitExtractionWindows(units, [400, 260]);

  for (const passIndex of [0, 1]) {
    const covered = windows
      .filter((window) => window.passIndex === passIndex)
      .flatMap((window) => window.coveredUnitIndexes)
      .sort();

    // Every unit appears in exactly one window of each pass — a unit missing here is a unit no
    // card can ever cite, and a duplicate would double-extract it.
    assert.deepEqual(covered, [0, 1, 2]);
  }
});

test("a unit larger than the window is split for extraction but keeps its attribution", () => {
  // Real case: transcription returned one segment covering a whole 17-minute recording, which
  // became a single giant unit. Unsplit, "extract every claim" cannot fit any output budget.
  const sentence = "Dolga poved o snovi predavanja, ki nosi eno samo dejstvo. ";
  const units = [makeUnit(0, sentence.repeat(120), 1200), makeUnit(1, "short text here", 3)];
  const windows = buildUnitExtractionWindows(units, [400]);

  assert.ok(windows.length >= 3, `expected the big unit split, got ${windows.length} windows`);

  for (const window of windows.slice(0, -1)) {
    // Every piece of the split still cites the unit it came from.
    assert.deepEqual(window.coveredUnitIndexes, [0]);
    assert.ok(window.text.length <= 400 * 6.5);
  }

  assert.deepEqual(windows.at(-1).coveredUnitIndexes, [1]);
});

test("the primary unit is the one sharing vocabulary with the claim", () => {
  const units = [
    makeUnit(0, "The Laspeyres index uses base-period quantities as weights."),
    makeUnit(1, "Deflating a nominal series divides the nominal value by the price index."),
  ];
  const unitByIndex = new Map(units.map((unit) => [unit.unitIndex, unit]));

  assert.equal(
    resolvePrimaryUnitIdx("Laspeyres weights come from the base period", [0, 1], unitByIndex),
    0,
  );
  assert.equal(
    resolvePrimaryUnitIdx("Real value equals nominal value divided by the price index", [0, 1], unitByIndex),
    1,
  );
});

test("item plans map importance onto the quality gate the legacy machinery enforces", () => {
  const units = [makeUnit(0, "text"), makeUnit(1, "more text")];
  const items = [
    { id: 0, claim: "An essential claim about the topic", kind: "definition", importance: 5, terms: [], sectionTitle: "S", coveredUnitIndexes: [0], primaryUnitIdx: 0 },
    { id: 1, claim: "A disposable aside about the topic", kind: "fact", importance: 2, terms: [], sectionTitle: "S", coveredUnitIndexes: [1], primaryUnitIdx: 1 },
  ];
  const plans = synthesizeItemPlans(items, units);

  assert.equal(plans.length, 2);
  // importance 5 -> qualityScore 10, importance 2 -> 4: the 6-point acceptance floor keeps
  // essentials and lets trivia be dropped, same as the legacy planner's contract.
  assert.equal(plans[0].concepts[0].qualityScore, 10);
  assert.equal(plans[0].concepts[0].recommendedCardCount, 1);
  assert.equal(plans[0].importance, "high");
  assert.equal(plans[1].concepts[0].qualityScore, 4);
  assert.equal(plans[1].importance, "low");
  // Every concept key round-trips: it is how cards are matched back to their plan.
  assert.equal(plans[0].concepts[0].conceptKey, "item-0");
});

test("a unit with no items still gets a plan so coverage validation sees it", () => {
  const units = [makeUnit(0, "text"), makeUnit(1, "filler unit")];
  const items = [
    { id: 0, claim: "The only claim", kind: "fact", importance: 3, terms: [], sectionTitle: "S", coveredUnitIndexes: [0], primaryUnitIdx: 0 },
  ];
  const plans = synthesizeItemPlans(items, units);

  assert.equal(plans.length, 2);
  // An empty concepts array is the existing "nothing to cover here" signal validateCoverage skips.
  assert.deepEqual(plans[1].concepts, []);
});

test("an oversized text splits at sentence boundaries and loses nothing", async () => {
  const { splitTextForExtraction } = await import("../src/lib/notes/note-prompts.ts");
  const sentence = "To je poved o snovi, ki nosi eno dejstvo. ";
  const text = sentence.repeat(120); // ~5000 chars — one whole-recording transcript segment
  const pieces = splitTextForExtraction(text, 2600);

  assert.ok(pieces.length >= 2);
  // Nothing dropped: joined pieces contain every sentence.
  assert.equal(pieces.join(" ").split("poved").length, text.split("poved").length);
  for (const piece of pieces) {
    assert.ok(piece.length <= 2600, `piece too long: ${piece.length}`);
    // Sentence-boundary cuts: every piece ends where a sentence ends.
    assert.ok(piece.endsWith("."), piece.slice(-20));
  }
});

test("short text passes through the splitter untouched", async () => {
  const { splitTextForExtraction } = await import("../src/lib/notes/note-prompts.ts");

  assert.deepEqual(splitTextForExtraction("Kratek zapis.", 2600), ["Kratek zapis."]);
  assert.deepEqual(splitTextForExtraction("   ", 2600), []);
});

test("duplicate links collapse via union-find, keeping peak importance per group", async () => {
  const { collapseDuplicateItems } = await import("../src/lib/notes/note-prompts.ts");
  const items = [
    { id: 0, claim: "EPSP povzroči depolarizacijo", kind: "fact", importance: 3, terms: [], sectionTitle: "S" },
    { id: 1, claim: "IPSP povzroči hiperpolarizacijo", kind: "fact", importance: 4, terms: [], sectionTitle: "S" },
    { id: 2, claim: "Ekscitacijski postsynaptični potencial depolarizira membrano", kind: "fact", importance: 5, terms: [], sectionTitle: "S" },
  ];
  // Symmetric links, as the judge actually returns them.
  const links = [
    { index: 0, duplicateOf: 2 },
    { index: 2, duplicateOf: 0 },
    { index: 1, duplicateOf: null },
  ];
  const collapsed = collapseDuplicateItems(items, links);

  assert.equal(collapsed.length, 2);
  const epsp = collapsed.find((item) => item.claim.includes("depolar"));
  assert.equal(epsp.importance, 5);
});

test("an over-eager judge is ignored rather than obeyed", async () => {
  const { collapseDuplicateItems } = await import("../src/lib/notes/note-prompts.ts");
  const items = Array.from({ length: 10 }, (_v, id) => ({
    id, claim: `Distinct fact number ${id} about the topic`, kind: "fact", importance: 3, terms: [], sectionTitle: "S",
  }));
  // Judge claims everything duplicates item 0 — collapsing 90% is not credible.
  const links = items.slice(1).map((item) => ({ index: item.id, duplicateOf: 0 }));

  assert.equal(collapseDuplicateItems(items, links).length, 10);
});
