import assert from "node:assert/strict";
import test from "node:test";

import {
  DECK_IMPORTANCE_FLOOR,
  MAX_DECK_ITEMS,
  MIN_DECK_ITEMS,
  selectDeckWorthyItems,
} from "../src/lib/notes/study-item-mapping.ts";
import {
  generatedFlashcardSchema,
  generatedPracticeQuestionSchema,
} from "../src/lib/notes/study-prompts.ts";

const item = (importance, claim, kind = "fact") => ({ importance, claim, kind });

test("only must-know items reach the deck", () => {
  const items = [
    item(5, "a"),
    item(3, "b"),
    item(4, "c"),
    item(1, "d"),
    item(2, "e"),
    item(5, "f"),
  ];
  // Enough context items exist that the top-up floor never fires, so the rating alone decides.
  const selected = selectDeckWorthyItems(items, { minItems: 3 });

  assert.deepEqual(
    selected.map((entry) => entry.claim),
    ["a", "c", "f"],
  );
  assert.ok(selected.every((entry) => entry.importance >= DECK_IMPORTANCE_FLOOR));
});

test("source order survives the filter so a deck still walks the lecture", () => {
  const items = [item(5, "first"), item(2, "skipped"), item(4, "second"), item(5, "third")];

  assert.deepEqual(
    selectDeckWorthyItems(items, { minItems: 1 }).map((entry) => entry.claim),
    ["first", "second", "third"],
  );
});

test("a source with too few must-knows tops up with the next best", () => {
  const items = [item(5, "keep"), item(3, "good"), item(1, "weak"), item(3, "also good")];
  const selected = selectDeckWorthyItems(items, { minItems: 3 });

  // The 5 plus the two 3s: the lone 1 stays out, and the result is back in source order.
  assert.deepEqual(
    selected.map((entry) => entry.claim),
    ["keep", "good", "also good"],
  );
});

test("top-up never invents items that do not exist", () => {
  const items = [item(5, "only")];

  assert.deepEqual(
    selectDeckWorthyItems(items, { minItems: 10 }).map((entry) => entry.claim),
    ["only"],
  );
});

test("an oversized deck is trimmed across the whole source, not truncated to its start", () => {
  const items = Array.from({ length: 120 }, (_unused, index) => item(5, `claim-${index}`));
  const selected = selectDeckWorthyItems(items, { maxItems: 10 });

  assert.equal(selected.length, 10);
  assert.equal(selected[0].claim, "claim-0");
  // A prefix would end at claim-9; spreading has to reach the end of the source.
  assert.equal(selected.at(-1).claim, "claim-108");
  assert.equal(new Set(selected.map((entry) => entry.claim)).size, 10);
});

test("a real lecture is sized by its content, not by the ceiling", () => {
  // The 43-slide law PDF measured on 2026-08-23: 127 items, of which 30 are definitions and 52
  // more were rated must-know. The deck should be those 82 — the ceiling must not be what decides.
  const items = [
    ...Array.from({ length: 30 }, () => item(3, undefined, "definition")),
    ...Array.from({ length: 52 }, () => item(4)),
    ...Array.from({ length: 45 }, () => item(3)),
  ];
  const selected = selectDeckWorthyItems(items);

  assert.equal(selected.length, 82);
  assert.ok(selected.length < MAX_DECK_ITEMS, "the ceiling must not be binding on a normal source");
  assert.ok(selected.length >= MIN_DECK_ITEMS);
});

test("the ceiling still catches a runaway source", () => {
  const items = Array.from({ length: 400 }, () => item(5));

  assert.equal(selectDeckWorthyItems(items).length, MAX_DECK_ITEMS);
});

test("a definition the extractor underrated still reaches the deck", () => {
  // Measured on the 43-slide law deck: "a thing is an independent physical object a person can
  // control" was rated 3 and vanished from every deck while detail rated 4 stayed.
  const items = [
    item(3, "a thing is an independent physical object", "definition"),
    item(4, "a peripheral detail"),
    item(3, "a peripheral aside"),
    item(2, "the formula", "formula"),
  ];
  const selected = selectDeckWorthyItems(items, { minItems: 1 });

  assert.deepEqual(
    selected.map((entry) => entry.claim),
    ["a thing is an independent physical object", "a peripheral detail", "the formula"],
  );
});

test("a definition rated disposable stays out", () => {
  const items = [item(1, "trivial definition", "definition"), item(5, "real")];

  assert.deepEqual(
    selectDeckWorthyItems(items, { minItems: 1 }).map((entry) => entry.claim),
    ["real"],
  );
});

test("over the ceiling the rated margin gives way before the backbone", () => {
  const items = [
    ...Array.from({ length: 30 }, (_u, i) => item(3, `def-${i}`, "definition")),
    ...Array.from({ length: 90 }, (_u, i) => item(5, `rated-${i}`)),
  ];
  const selected = selectDeckWorthyItems(items, { maxItems: 40 });

  assert.equal(selected.length, 40);
  assert.equal(selected.filter((entry) => entry.kind === "definition").length, 30);
});

test("a maths answer of one character is valid", () => {
  // Three separate two-character floors rejected real production maths material: knowledge-item
  // terms (e, x, the base a), the flashcard back (e, 0, 1) and practice marking points. They were
  // prose assumptions, and this app is given a lot of mathematics.
  assert.doesNotThrow(() =>
    generatedFlashcardSchema.parse({
      itemId: 0,
      front: "Kateri je naravni logaritem osnove e?",
      back: "1",
      difficulty: "easy",
    }),
  );
  assert.doesNotThrow(() =>
    generatedPracticeQuestionSchema.parse({
      itemId: 0,
      question: "Izracunaj log osnove e od e.",
      expectedPoints: ["1"],
    }),
  );
});

test("the outline's selection is bounded mechanically", async () => {
  const { enforceOutlineRetentionBounds } = await import("../src/lib/notes/note-prompts.ts");
  const mk = (id, importance, kind = "fact") => ({ id, importance, kind, sectionTitle: "T" });
  const items = [
    ...Array.from({ length: 10 }, (_u, i) => mk(i, 3, "definition")),
    ...Array.from({ length: 90 }, (_u, i) => mk(10 + i, 3)),
  ];

  // Over-pruned: 5 kept of 100, every definition dropped. The backbone comes back.
  const pruned = enforceOutlineRetentionBounds(
    { topics: [{ title: "T", itemIds: [10, 11, 12, 13, 14] }], droppedItemIds: items.map((x) => x.id).filter((id) => ![10, 11, 12, 13, 14].includes(id)) },
    items,
  );
  const keptIds = new Set(pruned.topics.flatMap((topic) => topic.itemIds));

  for (let id = 0; id < 10; id += 1) {
    assert.ok(keptIds.has(id), `definition ${id} must be restored`);
  }

  // Kept-everything: 100 of 100 becomes at most 60%.
  const bloated = enforceOutlineRetentionBounds(
    { topics: [{ title: "T", itemIds: items.map((x) => x.id) }], droppedItemIds: [] },
    items,
  );

  assert.ok(
    bloated.topics.flatMap((topic) => topic.itemIds).length <= 60,
    "a note may never keep nearly everything again",
  );
});
